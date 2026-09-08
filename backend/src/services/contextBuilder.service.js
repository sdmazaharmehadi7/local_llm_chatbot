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
 * Build a structured Knowledge Base context block from retrieved Qdrant points.
 *
 * @param {Array<{score: number, payload: object}>} points - Raw Qdrant matches
 * @param {object} [options]
 * @param {string} [options.targetDocumentId] - If document-specific, strictly filter to this ID
 * @param {number} [options.scoreThreshold=KB_SCORE_THRESHOLD] - Minimum similarity score
 * @param {number} [options.maxChunks=KB_MAX_CONTEXT_CHUNKS] - Maximum total chunks in final context
 * @param {number} [options.maxChars=MAX_KB_CONTEXT_CHARS] - Maximum total characters of text context
 * @returns {{
 *   hasContext: boolean,
 *   contextText: string,
 *   sources: Array<{documentId: string, filename: string, page?: number, section?: string, chunkIndex: number}>
 * }}
 */
export function buildKnowledgeBaseContext(points = [], options = {}) {
  const maxChars = options.maxChars || MAX_KB_CONTEXT_CHARS;
  const maxChunks = options.maxChunks || KB_MAX_CONTEXT_CHUNKS;
  const scoreThreshold =
    options.scoreThreshold !== undefined ? options.scoreThreshold : KB_SCORE_THRESHOLD;
  const targetDocumentId = options.targetDocumentId ? String(options.targetDocumentId) : null;

  if (!Array.isArray(points) || points.length === 0) {
    return {
      hasContext: false,
      contextText: "",
      sources: [],
    };
  }

  // 1. Strict Filtering:
  // - scoreThreshold: remove weak/irrelevant chunks (Part 7)
  // - targetDocumentId: if document-specific, discard ANY chunk not matching targetId (Part 6)
  // - scope: strictly ensure scope === "knowledge_base"
  const qualifiedPoints = points.filter((pt) => {
    const p = pt.payload || {};
    const text = (p.text || "").trim();
    if (!text) return false;

    // Strict scope check
    if (p.scope && p.scope !== "knowledge_base") return false;

    // Strict document-specific check
    if (targetDocumentId && String(p.documentId) !== targetDocumentId) {
      return false;
    }

    // Relevance threshold check
    if (typeof pt.score === "number" && pt.score < scoreThreshold) {
      return false;
    }

    return true;
  });

  if (qualifiedPoints.length === 0) {
    return {
      hasContext: false,
      contextText: "",
      sources: [],
    };
  }

  // 2. Stable Chunk Deduplication (Part 9)
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
    };
  }

  // 3. Group chunks by Document -> Section/Page order
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

  // 4. Assemble structured context respecting maxChars budget
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

  // 5. Source Attribution and Deduplication
  // Each unique document resource produces exactly ONE source entry, aggregating all cited pages.
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
      });
    }
    if (chunk.page !== undefined && chunk.page !== null) {
      docSourcesMap.get(docKey).pages.add(Number(chunk.page));
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
3. If the provided Knowledge Base context does not contain the answer, explicitly state:
"I couldn't find relevant information in the Knowledge Base."
4. Keep answers concise, factual, and clear unless the user requests in-depth detail.
5. At the end of your response, list the sources used in this exact format:
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
