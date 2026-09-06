/**
 * Text Splitter
 *
 * Recursively splits document text into overlapping chunks based on paragraph,
 * sentence, and character boundaries while honoring target chunkSize and chunkOverlap.
 */

import { RAG_CONFIG } from "./config.js";

/**
 * Splits text into chunks using separators: \n\n, \n, . , space, empty string.
 *
 * @param {string} text
 * @param {object} [options]
 * @param {number} [options.chunkSize]
 * @param {number} [options.chunkOverlap]
 * @returns {Array<string>} Array of chunk text strings
 */
export function splitTextIntoChunks(text, options = {}) {
  const chunkSize = options.chunkSize || RAG_CONFIG.chunkSize;
  const chunkOverlap = options.chunkOverlap || RAG_CONFIG.chunkOverlap;

  if (!text || text.trim().length === 0) return [];
  if (text.length <= chunkSize) return [text.trim()];

  const separators = ["\n\n", "\n", ". ", "? ", "! ", " ", ""];

  function _split(currentText, sepIndex) {
    if (sepIndex >= separators.length) {
      // Hard split fallback by characters
      const chunks = [];
      for (let i = 0; i < currentText.length; i += chunkSize - chunkOverlap) {
        chunks.push(currentText.slice(i, i + chunkSize));
      }
      return chunks;
    }

    const separator = separators[sepIndex];
    const splits = separator ? currentText.split(separator) : currentText.split("");

    const result = [];
    let currentChunk = "";

    for (const piece of splits) {
      const candidate = currentChunk
        ? currentChunk + (separator || "") + piece
        : piece;

      if (candidate.length <= chunkSize) {
        currentChunk = candidate;
      } else {
        if (currentChunk) {
          result.push(currentChunk.trim());
        }
        // If single piece is itself larger than chunkSize, recurse with finer separator
        if (piece.length > chunkSize) {
          const subSplits = _split(piece, sepIndex + 1);
          result.push(...subSplits);
          currentChunk = "";
        } else {
          currentChunk = piece;
        }
      }
    }

    if (currentChunk.trim()) {
      result.push(currentChunk.trim());
    }

    return result;
  }

  const rawChunks = _split(text, 0);

  // Apply overlap pass to merge small adjacent chunks up to chunkSize
  const finalChunks = [];
  let i = 0;

  while (i < rawChunks.length) {
    let chunkStr = rawChunks[i];
    let j = i + 1;

    while (
      j < rawChunks.length &&
      chunkStr.length + rawChunks[j].length + 1 <= chunkSize
    ) {
      chunkStr += "\n" + rawChunks[j];
      j++;
    }

    if (chunkStr.trim()) {
      finalChunks.push(chunkStr.trim());
    }

    // Step forward ensuring overlap
    i = Math.max(i + 1, j - Math.floor(chunkOverlap / 100));
  }

  return finalChunks.filter((c) => c.length > 0);
}

/**
 * Processes a document object and returns chunk objects.
 *
 * @param {{id: string, filename: string, content: string, metadata: object}} document
 * @param {object} [options]
 * @returns {Array<{id: string, documentId: string, filename: string, chunkIndex: number, text: string, metadata: object}>}
 */
export function chunkDocument(document, options = {}) {
  const textChunks = splitTextIntoChunks(document.content, options);

  return textChunks.map((chunkText, index) => ({
    id: `${document.id}_chunk_${index}`,
    documentId: document.id,
    filename: document.filename,
    chunkIndex: index,
    totalChunks: textChunks.length,
    text: chunkText,
    metadata: {
      ...document.metadata,
      charCount: chunkText.length,
    },
  }));
}
