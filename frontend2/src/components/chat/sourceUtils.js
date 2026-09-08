export const TOOL_ERROR_MESSAGES = {
  RATE_LIMITED: "Search provider rate limited. Try again in a moment.",
  AUTH_FAILED: "Search API key is invalid or expired. Contact your admin.",
  PROVIDER_ERROR: "Search provider returned an error. Try again.",
  FETCH_FAILED: "Could not fetch the requested URL.",
  SSRF_BLOCKED: "URL blocked for security reasons.",
};

/**
 * Extract and deduplicate source citations.
 *
 * Core Guarantee:
 * Each unique document resource appears EXACTLY ONCE in the sources list.
 * If multiple chunks/pages are cited from the same document, they are combined
 * into a single resource entry with all cited pages aggregated.
 */
export function extractSources(parts, metadata = null) {
  const docMap = new Map();
  const webSources = [];
  const seenWebUrls = new Set();

  const addDocumentSource = (s) => {
    if (!s) return;
    const filename = s.filename || s.source?.filename || "document";
    const documentId = s.documentId || s.source?.documentId || null;

    // Resource identity: documentId if available, else normalized filename
    const resourceKey = documentId ? String(documentId) : filename.toLowerCase().trim();

    if (!docMap.has(resourceKey)) {
      docMap.set(resourceKey, {
        documentId,
        filename,
        pages: new Set(),
        url: documentId ? `/api/files/${documentId}/content` : "#",
        isDocument: true,
      });
    }

    const doc = docMap.get(resourceKey);
    if (!doc.documentId && documentId) {
      doc.documentId = documentId;
      doc.url = `/api/files/${documentId}/content`;
    }

    // Collect pages from array or single property
    if (Array.isArray(s.pages)) {
      for (const p of s.pages) {
        if (p !== undefined && p !== null && !isNaN(Number(p))) {
          doc.pages.add(Number(p));
        }
      }
    }
    const singlePage = s.page !== undefined ? s.page : s.source?.page;
    if (singlePage !== undefined && singlePage !== null && !isNaN(Number(singlePage))) {
      doc.pages.add(Number(singlePage));
    }
  };

  // 1. Process metadata.ragSources if present
  if (Array.isArray(metadata?.ragSources)) {
    for (const s of metadata.ragSources) {
      addDocumentSource(s);
    }
  }

  // 2. Process message parts
  if (Array.isArray(parts)) {
    for (const part of parts) {
      // Document RAG sources from data-rag-sources event
      if (part.type === "data-rag-sources" && Array.isArray(part.data?.sources)) {
        for (const s of part.data.sources) {
          addDocumentSource(s);
        }
        continue;
      }

      // Individual source parts
      if (
        (part.type === "source" || part.type === "rag-source") &&
        (part.isDocument || part.filename || part.source?.filename)
      ) {
        addDocumentSource(part);
        continue;
      }

      // Web search tool results
      if (part.type === "tool-invocation" && part.state === "result") {
        if (part.toolName === "webSearch" && part.result?.results) {
          for (const r of part.result.results) {
            if (!seenWebUrls.has(r.url)) {
              seenWebUrls.add(r.url);
              webSources.push({
                key: r.url,
                title: r.title,
                url: r.url,
                snippet: r.snippet,
                domain: r.domain,
                isDocument: false,
              });
            }
          }
        }
        if (part.toolName === "fetchUrl" && part.result?.url && !part.result?.error) {
          if (!seenWebUrls.has(part.result.url)) {
            seenWebUrls.add(part.result.url);
            webSources.push({
              key: part.result.url,
              title: part.result.title,
              url: part.result.url,
              domain: new URL(part.result.url).hostname,
              isDocument: false,
            });
          }
        }
      }
    }
  }

  // 3. Assemble single-resource list for documents
  const sources = [];
  for (const [key, doc] of docMap.entries()) {
    const pagesArray = Array.from(doc.pages).sort((a, b) => a - b);
    let pageText = "";
    let pageBadge = null;

    if (pagesArray.length === 1) {
      pageText = `Page ${pagesArray[0]}`;
      pageBadge = `p. ${pagesArray[0]}`;
    } else if (pagesArray.length > 1) {
      pageText = `Pages ${pagesArray.join(", ")}`;
      pageBadge = `pp. ${pagesArray.join(", ")}`;
    }

    const title = pageText ? `${doc.filename} — ${pageText}` : doc.filename;

    sources.push({
      key,
      documentId: doc.documentId,
      filename: doc.filename,
      pages: pagesArray,
      pageBadge,
      pageText,
      title,
      url: doc.url,
      isDocument: true,
      snippet: `Reference from ${doc.filename}${pageText ? ` (${pageText})` : ""}`,
    });
  }

  return [...sources, ...webSources];
}

export default {
  extractSources,
  TOOL_ERROR_MESSAGES,
};
