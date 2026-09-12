/**
 * Context Builder Service
 *
 * Single source of truth that transforms retrieved Qdrant chunks into a structured,
 * deduplicated, and bounded context block for Qwen3 prompting, and produces
 * strictly attributed, deduplicated source metadata.
 *
 * Performance Rules (M2 16GB):
 * - Bounds maximum context length (default: 4000 chars)
 * - Bounds maximum candidate chunks (default: 6)
 * - Strict score threshold filtering
 * - Strict documentId enforcement for document-specific queries
 * - Deduplicates overlapping text chunks
 * - Deduplicates UI sources to documentId + page
 */

const MAX_KB_CONTEXT_CHARS =
  parseInt(process.env.MAX_KB_CONTEXT_CHARS, 10) || 4000;
const KB_MAX_CONTEXT_CHUNKS =
  parseInt(process.env.KB_MAX_CONTEXT_CHUNKS, 10) || 6;
const KB_SCORE_THRESHOLD =
  parseFloat(process.env.KB_SCORE_THRESHOLD) || 0.35;

/**
 * Extract meaningful search terms from a query string, filtering out punctuation
 * and standard conversational/stop words.
 *
 * @param {string} query
 * @returns {Array<string>}
 */
export function extractSignificantTerms(query = "") {
  if (!query || typeof query !== "string") return [];

  const stopWords = new Set([
    "what", "is", "are", "the", "for", "with", "and", "or", "in", "on", "at",
    "to", "from", "by", "about", "into", "through", "during", "before", "after",
    "above", "below", "between", "under", "again", "further", "then", "once",
    "here", "there", "when", "where", "why", "how", "all", "any", "both",
    "each", "few", "more", "most", "other", "some", "such", "no", "nor",
    "not", "only", "own", "same", "so", "than", "too", "very", "can", "will",
    "just", "should", "now", "using", "use", "does", "did", "doing", "this",
    "that", "these", "those", "have", "has", "had", "having", "please", "tell",
    "find", "show", "give", "list", "document", "documents", "knowledgebase"
  ]);

  return query
    .toLowerCase()
    .replace(/[^\w\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !stopWords.has(w));
}

/**
 * Build a structured Knowledge Base context block from retrieved Qdrant points.
 *
 * @param {Array<{score: number, payload: object}>} points - Raw Qdrant matches
 * @param {object} [options]
 * @param {string} [options.query=""] - User query string for term relevance assessment
 * @param {string} [options.targetDocumentId] - If document-specific, strictly filter to this ID
 * @param {number} [options.scoreThreshold=KB_SCORE_THRESHOLD] - Minimum similarity score
 * @param {number} [options.maxChunks=KB_MAX_CONTEXT_CHUNKS] - Maximum total chunks in final context
 * @param {number} [options.maxChars=MAX_KB_CONTEXT_CHARS] - Maximum total characters of text context
 * @returns {{
 *   hasContext: boolean,
 *   contextText: string,
 *   sources: Array<{documentId: string, filename: string, page?: number, section?: string, chunkIndex: number, score?: number}>,
 *   contextChunksCount: number
 * }}
 */
export function buildKnowledgeBaseContext(points = [], options = {}) {
  const maxChars = options.maxChars || MAX_KB_CONTEXT_CHARS;
  const maxChunks = options.maxChunks || KB_MAX_CONTEXT_CHUNKS;
  const scoreThreshold =
    options.scoreThreshold !== undefined ? options.scoreThreshold : KB_SCORE_THRESHOLD;
  const targetDocumentId = options.targetDocumentId ? String(options.targetDocumentId) : null;
  const query = options.query || "";

  if (!Array.isArray(points) || points.length === 0) {
    return {
      hasContext: false,
      contextText: "",
      sources: [],
      contextChunksCount: 0,
    };
  }

  // 1. Initial Filtering:
  // - text presence
  // - scope check: scope === "knowledge_base"
  // - targetDocumentId: if document-specific, discard ANY chunk not matching targetId
  // - scoreThreshold: remove chunks below absolute minimum threshold
  const initialPoints = points.filter((pt) => {
    const p = pt.payload || {};
    const text = (p.text || "").trim();
    if (!text) return false;

    // Strict scope check
    if (p.scope && p.scope !== "knowledge_base") return false;

    // Strict document-specific check
    if (targetDocumentId && String(p.documentId) !== targetDocumentId) {
      return false;
    }

    // Basic threshold check
    if (typeof pt.score === "number" && pt.score < scoreThreshold) {
      return false;
    }

    return true;
  });

  if (initialPoints.length === 0) {
    return {
      hasContext: false,
      contextText: "",
      sources: [],
      contextChunksCount: 0,
    };
  }

  // 2. Relative Relevance & Topic Filtering:
  // Separate retrieved candidates from actual relevant context and cited sources.
  // Prevent unrelated KB documents from sneaking in due to dense embedding floor similarities (~0.55 - 0.65).
  const queryTerms = extractSignificantTerms(query);
  const topScore = Math.max(
    ...initialPoints.map((pt) => (typeof pt.score === "number" ? pt.score : 0))
  );

  // Group candidate points by document to assess document-level relevance and term matching
  const docCandMap = new Map();
  for (const pt of initialPoints) {
    const p = pt.payload || {};
    const docKey = String(p.documentId || p.filename || "unknown");
    if (!docCandMap.has(docKey)) {
      docCandMap.set(docKey, {
        docKey,
        documentId: p.documentId || null,
        filename: p.filename || "Document.pdf",
        bestScore: typeof pt.score === "number" ? pt.score : 0,
        points: [],
        combinedText: "",
      });
    }
    const cand = docCandMap.get(docKey);
    const score = typeof pt.score === "number" ? pt.score : 0;
    if (score > cand.bestScore) cand.bestScore = score;
    cand.points.push(pt);
    cand.combinedText += " " + (p.filename || "") + " " + (p.text || "");
  }

  // Determine which documents qualify based on top score gap and term matching
  const qualifyingDocKeys = new Set();
  for (const [docKey, cand] of docCandMap.entries()) {
    // If targetDocumentId is explicitly set, the doc matches by definition
    if (targetDocumentId && String(cand.documentId) === targetDocumentId) {
      qualifyingDocKeys.add(docKey);
      continue;
    }

    const docTextLower = cand.combinedText.toLowerCase();
    const docTermMatches = queryTerms.reduce((count, term) => {
      return count + (docTextLower.includes(term) ? 1 : 0);
    }, 0);

    const scoreGap = topScore - cand.bestScore;

    let qualifies = false;
    if (topScore >= 0.70) {
      // Strong semantic match exists (e.g. 0.75 - 0.95)
      // Chunks within 0.08 of topScore qualify
      // Or chunks within 0.12 with at least 2 distinct query term matches qualify
      if (scoreGap <= 0.08) {
        qualifies = true;
      } else if (scoreGap <= 0.12 && docTermMatches >= 2) {
        qualifies = true;
      }
    } else {
      // Moderate semantic match (e.g. 0.55 - 0.70)
      if (queryTerms.length === 0) {
        qualifies = scoreGap <= 0.15;
      } else if (docTermMatches >= 2) {
        qualifies = scoreGap <= 0.06;
      } else if (docTermMatches >= 1) {
        qualifies = scoreGap <= 0.04;
      } else {
        qualifies = scoreGap <= 0.015;
      }
    }

    if (qualifies) {
      qualifyingDocKeys.add(docKey);
    }
  }

  // Filter points to only those from qualifying documents and with sufficient chunk score
  const qualifiedPoints = initialPoints.filter((pt) => {
    const p = pt.payload || {};
    const docKey = String(p.documentId || p.filename || "unknown");
    if (!qualifyingDocKeys.has(docKey)) return false;

    // Discard chunks with extreme drop from the document's or global top score
    const ptScore = typeof pt.score === "number" ? pt.score : 0;
    if (topScore >= 0.70 && topScore - ptScore > 0.15) {
      return false;
    }
    return true;
  });

  if (qualifiedPoints.length === 0) {
    return {
      hasContext: false,
      contextText: "",
      sources: [],
      contextChunksCount: 0,
    };
  }

  // Sort qualified points by score descending so the most relevant chunks are chosen first
  qualifiedPoints.sort((a, b) => {
    const scoreA = typeof a.score === "number" ? a.score : 0;
    const scoreB = typeof b.score === "number" ? b.score : 0;
    return scoreB - scoreA;
  });

  // 3. Stable Chunk Deduplication & maxChunks cap
  // Stable identity: documentId + page + chunkIndex
  const seenChunkKeys = new Set();
  const deduplicatedChunks = [];

  for (const pt of qualifiedPoints) {
    const p = pt.payload || {};
    const text = (p.text || "").trim();
    const docId = String(p.documentId || p.filename || "");
    const page = p.page || 1;
    const chunkIdx = p.chunkIndex !== undefined ? p.chunkIndex : 0;

    const chunkKey = `${docId}:::p${page}:::idx${chunkIdx}`;
    if (seenChunkKeys.has(chunkKey)) continue;
    seenChunkKeys.add(chunkKey);

    deduplicatedChunks.push({
      documentId: docId,
      filename: p.filename || "Document.pdf",
      page,
      section: p.section || null,
      chunkIndex: chunkIdx,
      score: pt.score || 0,
      text,
    });

    if (deduplicatedChunks.length >= maxChunks) {
      break;
    }
  }

  if (deduplicatedChunks.length === 0) {
    return {
      hasContext: false,
      contextText: "",
      sources: [],
      contextChunksCount: 0,
    };
  }

  // 4. Group chunks by Document -> Section/Page order
  const docGroups = new Map();
  for (const chunk of deduplicatedChunks) {
    const docKey = chunk.documentId || chunk.filename;
    if (!docGroups.has(docKey)) {
      docGroups.set(docKey, []);
    }
    docGroups.get(docKey).push(chunk);
  }

  // Sort chunks inside each document by page and chunkIndex
  for (const [, chunks] of docGroups.entries()) {
    chunks.sort((a, b) => {
      if (a.page !== b.page) return a.page - b.page;
      return a.chunkIndex - b.chunkIndex;
    });
  }

  // 5. Assemble structured context respecting maxChars budget
  let totalChars = 0;
  const sectionsOutput = [];
  const finalContextChunks = [];

  for (const [, chunks] of docGroups.entries()) {
    if (totalChars >= maxChars) break;

    const filename = chunks[0]?.filename || "Document.pdf";
    const docHeader = `DOCUMENT: ${filename}`;
    const docContentBlocks = [];

    for (const chunk of chunks) {
      if (totalChars >= maxChars) break;

      const pageText = chunk.page ? `Page: ${chunk.page}` : "";
      const sectionText = chunk.section ? `Section: ${chunk.section}` : "";
      const headerLine = [pageText, sectionText].filter(Boolean).join(" | ");

      // Truncate chunk text if it exceeds remaining budget
      const remainingBudget = maxChars - totalChars;
      let textToAdd = chunk.text;
      if (textToAdd.length > remainingBudget) {
        textToAdd = textToAdd.slice(0, Math.max(100, remainingBudget)) + "...";
      }

      const block = `${headerLine ? headerLine + "\n" : ""}${textToAdd}`;
      docContentBlocks.push(block);
      totalChars += block.length + 10;

      // Track that this chunk was actually included in the context
      finalContextChunks.push(chunk);
    }

    if (docContentBlocks.length > 0) {
      sectionsOutput.push(`${docHeader}\n\n${docContentBlocks.join("\n\n")}`);
    }
  }

  const contextText = sectionsOutput.join("\n\n---\n\n");

  // 6. Source Attribution and Deduplication
  // Each unique document resource produces exactly ONE source entry, aggregating all cited pages and best score.
  const docSourcesMap = new Map();

  for (const chunk of finalContextChunks) {
    const docKey = String(chunk.documentId || chunk.filename);
    if (!docSourcesMap.has(docKey)) {
      docSourcesMap.set(docKey, {
        documentId: chunk.documentId,
        filename: chunk.filename,
        pages: new Set(),
        section: chunk.section || undefined,
        chunkIndex: chunk.chunkIndex,
        score: chunk.score || 0,
      });
    }
    const entry = docSourcesMap.get(docKey);
    if (chunk.page !== undefined && chunk.page !== null) {
      entry.pages.add(Number(chunk.page));
    }
    if (typeof chunk.score === "number" && chunk.score > entry.score) {
      entry.score = chunk.score;
    }
  }

  const recordedSources = [];
  for (const doc of docSourcesMap.values()) {
    const pagesArray = Array.from(doc.pages).sort((a, b) => a - b);
    const pageText =
      pagesArray.length === 1
        ? `Page ${pagesArray[0]}`
        : pagesArray.length > 1
        ? `Pages ${pagesArray.join(", ")}`
        : undefined;

    recordedSources.push({
      documentId: doc.documentId,
      filename: doc.filename,
      page: pagesArray.length > 0 ? pagesArray[0] : undefined,
      pages: pagesArray,
      pageText,
      section: doc.section,
      chunkIndex: doc.chunkIndex,
      score: doc.score,
    });
  }

  return {
    hasContext: contextText.trim().length > 0,
    contextText,
    sources: recordedSources,
    contextChunksCount: finalContextChunks.length,
  };
}

/**
 * Augment conversation messages with structured Knowledge Base context and instructions.
 *
 * @param {Array<object>} messages - Existing chat history
 * @param {string} contextText - Formatted KB document context
 * @param {Array<object>} sources - Deduplicated sources list
 * @returns {Array<object>} - Augmented conversation context
 */
export function buildAugmentedKnowledgeBaseMessages(messages, contextText, sources = []) {
  if (!contextText || !Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  const sourcesList = sources
    .map((s) => {
      const pageStr = s.pageText ? ` — ${s.pageText}` : s.page ? ` — Page ${s.page}` : "";
      return `- ${s.filename}${pageStr}${s.section ? ` (${s.section})` : ""}`;
    })
    .join("\n");

  const systemInstructions = `You are a verified Knowledge Base assistant. You have access to authorized organizational documents.

KNOWLEDGE BASE CONTEXT:
---
${contextText}
---

INSTRUCTIONS:
1. Answer the user's question using the provided Knowledge Base context.
2. Rely strictly on the facts in the context. Do not fabricate, extrapolate, or invent information not present in the documents.
3. Keep answers concise, factual, and clear unless the user requests in-depth detail.
4. At the end of your response, list the sources used in this exact format:
Sources:
${sourcesList || "- Knowledge Base"}`;

  // Clone messages
  const augmented = messages.map((m) => ({ ...m }));

  // Find or insert system prompt
  const existingSystemIndex = augmented.findIndex((m) => m.role === "system");
  if (existingSystemIndex !== -1) {
    augmented[existingSystemIndex] = {
      ...augmented[existingSystemIndex],
      content: `${augmented[existingSystemIndex].content}\n\n${systemInstructions}`,
    };
  } else {
    augmented.unshift({
      role: "system",
      content: systemInstructions,
    });
  }

  return augmented;
}

export default {
  buildKnowledgeBaseContext,
  buildAugmentedKnowledgeBaseMessages,
};
