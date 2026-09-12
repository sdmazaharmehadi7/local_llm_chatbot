/**
 * Knowledge Base Service
 *
 * Core service managing the lifecycle and retrieval for Knowledge Base documents.
 *
 * Performance Rules (M2 16GB):
 * - Bounded chunk sizes (default 700 chars, overlap 100)
 * - Deterministic Qdrant IDs prevent duplicate vector points on re-indexing
 * - Scanned PDF guard: detects image-only PDFs and marks them "processing_ocr_required"
 * - Retrieval strictly isolated to scope = "knowledge_base" and workspaceId
 * - Bounded retrieval candidates (topK <= 10)
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";
import KnowledgeBaseDocument from "../models/KnowledgeBaseDocument.js";
import { extractDocumentPages } from "./rag.service.js";
import { generateEmbedding, generateBatchEmbeddings } from "./embedding.service.js";
import {
  upsertPoints,
  searchKnowledgeBasePoints,
  deleteKnowledgeBasePoints,
} from "./qdrant.service.js";
import { buildKnowledgeBaseContext } from "./contextBuilder.service.js";

const CHUNK_SIZE = parseInt(process.env.KB_CHUNK_SIZE, 10) || 700;
const CHUNK_OVERLAP = parseInt(process.env.KB_CHUNK_OVERLAP, 10) || 100;
const KB_SCORE_THRESHOLD =
  parseFloat(process.env.KB_SCORE_THRESHOLD) || 0.35;
const KB_RETRIEVAL_LIMIT =
  parseInt(process.env.KB_RETRIEVAL_LIMIT, 10) || 10;

/**
 * Generate a deterministic UUID for a chunk to prevent duplicate vectors on retry.
 * @param {string} inputStr
 * @returns {string} - UUID formatted string
 */
function deterministicChunkId(inputStr) {
  const hash = crypto.createHash("md5").update(inputStr).digest("hex");
  return [
    hash.substring(0, 8),
    hash.substring(8, 12),
    `4${hash.substring(13, 16)}`,
    `a${hash.substring(17, 20)}`,
    hash.substring(20, 32),
  ].join("-");
}

/**
 * Detect section titles from page text (e.g. "Section 2.1 Inspection", "1. Overview", "CHAPTER 4").
 */
function extractSectionTitle(text = "") {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  for (const line of lines.slice(0, 5)) {
    if (
      /^(section\s*\d+|chapter\s*\d+|part\s*[a-z0-9]+|\d+\.\d*(\.\d+)*\s+[a-z]|appendix|[a-z\s]{3,40}:?$)/i.test(
        line
      ) &&
      line.length <= 60
    ) {
      return line.replace(/:$/, "");
    }
  }
  return null;
}

/**
 * Chunk extracted document pages with section awareness and overlap.
 *
 * @param {Array<{pageNumber: number, text: string}>} pages
 * @param {number} [maxChunkSize=CHUNK_SIZE]
 * @param {number} [overlap=CHUNK_OVERLAP]
 * @returns {Array<{chunkIndex: number, pageNumber: number, section?: string, text: string}>}
 */
export function chunkKnowledgeBasePages(pages, maxChunkSize = CHUNK_SIZE, overlap = CHUNK_OVERLAP) {
  const chunks = [];
  let globalChunkIndex = 0;
  let currentSection = null;

  for (const page of pages) {
    const { pageNumber, text } = page;
    if (!text || text.length < 15) continue;

    // Detect if this page begins a new section
    const pageSection = extractSectionTitle(text);
    if (pageSection) {
      currentSection = pageSection;
    }

    if (text.length <= maxChunkSize) {
      chunks.push({
        chunkIndex: globalChunkIndex++,
        pageNumber,
        section: currentSection || undefined,
        text,
      });
      continue;
    }

    const paragraphs = text.split(/\n\s*\n/);
    let currentChunk = "";

    for (const paragraph of paragraphs) {
      const cleanPara = paragraph.trim();
      if (!cleanPara) continue;

      // Check for paragraph-level section header
      if (
        /^(section\s*\d+|chapter\s*\d+|\d+\.\d+(\.\d+)*\s+[a-z])/i.test(cleanPara) &&
        cleanPara.length < 60
      ) {
        currentSection = cleanPara;
      }

      if ((currentChunk + "\n\n" + cleanPara).length <= maxChunkSize) {
        currentChunk = currentChunk ? `${currentChunk}\n\n${cleanPara}` : cleanPara;
      } else {
        if (currentChunk) {
          chunks.push({
            chunkIndex: globalChunkIndex++,
            pageNumber,
            section: currentSection || undefined,
            text: currentChunk,
          });
          const overlapText = currentChunk.slice(-overlap).trim();
          currentChunk = overlapText ? `${overlapText}\n\n${cleanPara}` : cleanPara;
        } else {
          let start = 0;
          while (start < cleanPara.length) {
            const end = Math.min(start + maxChunkSize, cleanPara.length);
            const slice = cleanPara.slice(start, end).trim();
            if (slice.length >= 15) {
              chunks.push({
                chunkIndex: globalChunkIndex++,
                pageNumber,
                section: currentSection || undefined,
                text: slice,
              });
            }
            start += maxChunkSize - overlap;
          }
          currentChunk = "";
        }
      }
    }

    if (currentChunk.trim().length >= 15) {
      chunks.push({
        chunkIndex: globalChunkIndex++,
        pageNumber,
        section: currentSection || undefined,
        text: currentChunk.trim(),
      });
    }
  }

  return chunks;
}

/**
 * Process and index a Knowledge Base document into Qdrant.
 *
 * @param {object} kbDoc - Mongoose KnowledgeBaseDocument instance
 * @returns {Promise<{success: boolean, status: string, chunkCount: number, error?: string}>}
 */
export async function indexKnowledgeBaseDocument(kbDoc) {
  if (!kbDoc) {
    return { success: false, status: "failed", chunkCount: 0, error: "Document is null" };
  }

  const docId = kbDoc._id.toString();
  const filePath = kbDoc.originalFileReference;
  const filename = kbDoc.filename;
  const mimeType = kbDoc.mimeType || "application/pdf";
  const workspaceId = kbDoc.workspaceId || "default";
  const userId = kbDoc.userId || null;
  const version = kbDoc.documentVersion || 1;

  try {
    // 1. Update status to processing
    await KnowledgeBaseDocument.updateOne(
      { _id: docId },
      { $set: { status: "processing", updatedAt: new Date() } }
    );

    console.log(`[kb.service] Ingesting Knowledge Base document "${filename}" (v${version})`);

    // 2. Extract pages preserving page boundaries
    const pages = await extractDocumentPages(filePath, mimeType, filename);

    // 3. Scanned PDF Check (Requirement 10)
    // Calculate total extracted text length across all pages
    const totalTextLength = pages.reduce((acc, p) => acc + (p.text ? p.text.trim().length : 0), 0);

    if (pages.length === 0 || totalTextLength < 30) {
      console.warn(
        `[kb.service] Document "${filename}" contains no extractable text (${totalTextLength} chars). Marking processing_ocr_required.`
      );
      await KnowledgeBaseDocument.updateOne(
        { _id: docId },
        {
          $set: {
            status: "processing_ocr_required",
            statusMessage: "Document contains scanned pages or unextractable text. OCR ingestion required.",
            chunkCount: 0,
            updatedAt: new Date(),
          },
        }
      );
      return {
        success: true,
        status: "processing_ocr_required",
        chunkCount: 0,
        error: "Scanned document requires OCR",
      };
    }

    // 4. Chunk text with section awareness
    const chunks = chunkKnowledgeBasePages(pages, CHUNK_SIZE, CHUNK_OVERLAP);
    console.log(
      `[kb.service] Extracted ${pages.length} pages from "${filename}", created ${chunks.length} chunks.`
    );

    if (chunks.length === 0) {
      await KnowledgeBaseDocument.updateOne(
        { _id: docId },
        {
          $set: {
            status: "failed",
            statusMessage: "Unable to generate chunks from document.",
            chunkCount: 0,
            updatedAt: new Date(),
          },
        }
      );
      return { success: false, status: "failed", chunkCount: 0 };
    }

    // 5. Generate embeddings using nomic-embed-text (batch)
    console.log(`[kb.service] Generating embeddings via nomic-embed-text for ${chunks.length} chunks...`);
    const texts = chunks.map((c) => c.text);
    const embeddings = await generateBatchEmbeddings(texts);

    // 6. Build Qdrant points with deterministic IDs and scope metadata
    const points = chunks.map((chunk, i) => {
      const pointId = deterministicChunkId(
        `kb:::${workspaceId}:::${docId}:::v${version}:::chunk_${chunk.chunkIndex}`
      );

      return {
        id: pointId,
        vector: embeddings[i],
        payload: {
          documentId: docId,
          workspaceId,
          userId,
          scope: "knowledge_base",
          filename,
          page: chunk.pageNumber,
          section: chunk.section || null,
          chunkIndex: chunk.chunkIndex,
          documentVersion: version,
          text: chunk.text,
        },
      };
    });

    // 7. Upsert vector points to Qdrant collection local_chat_documents
    await upsertPoints(points);

    // 8. Mark document as indexed in MongoDB
    await KnowledgeBaseDocument.updateOne(
      { _id: docId },
      {
        $set: {
          status: "indexed",
          statusMessage: null,
          chunkCount: points.length,
          updatedAt: new Date(),
        },
      }
    );

    console.log(
      `[kb.service] Successfully indexed Knowledge Base document "${filename}" with ${points.length} vectors.`
    );

    return { success: true, status: "indexed", chunkCount: points.length };
  } catch (err) {
    console.error(`[kb.service] Failed to index KB document ${docId} ("${filename}"):`, err.message);
    await KnowledgeBaseDocument.updateOne(
      { _id: docId },
      {
        $set: {
          status: "failed",
          statusMessage: err.message,
          updatedAt: new Date(),
        },
      }
    ).catch(() => {});

    return { success: false, status: "failed", chunkCount: 0, error: err.message };
  }
}

/**
 * Retrieve Knowledge Base context for a user query.
 *
 * @param {object} params
 * @param {string} params.query - User query text
 * @param {string} [params.documentId=null] - Optional specific document ID filter
 * @param {string} [params.workspaceId="default"] - Workspace identifier
 * @param {string} [params.userId=null] - User identifier
 * @param {number} [params.limit=KB_RETRIEVAL_LIMIT] - Candidate count
 * @param {number} [params.scoreThreshold=KB_SCORE_THRESHOLD] - Minimum similarity score
 * @returns {Promise<{
 *   hasContext: boolean,
 *   noRelevantChunks?: boolean,
 *   contextText: string,
 *   sources: Array<object>,
 *   qdrantUnavailable?: boolean,
 *   error?: string
 * }>}
 */
export async function retrieveKnowledgeBaseContext({
  query = "",
  documentId = null,
  workspaceId = "default",
  userId = null,
  limit = KB_RETRIEVAL_LIMIT,
  scoreThreshold = KB_SCORE_THRESHOLD,
}) {
  const cleanQuery = (query || "").trim();
  if (!cleanQuery) {
    return { hasContext: false, noRelevantChunks: true, contextText: "", sources: [] };
  }

  try {
    // 1. Generate query embedding with nomic-embed-text
    const queryVector = await generateEmbedding(cleanQuery);

    // 2. Perform Qdrant similarity search with scope="knowledge_base" filter and optional documentId
    const matches = await searchKnowledgeBasePoints({
      vector: queryVector,
      documentId: documentId ? String(documentId) : null,
      workspaceId,
      userId,
      limit,
      scoreThreshold,
    });

    if (!Array.isArray(matches) || matches.length === 0) {
      console.log(
        `[kb.service] No chunks exceeded threshold (${scoreThreshold}) for query in workspace ${workspaceId} (doc=${documentId || "ALL"}).`
      );
      return {
        hasContext: false,
        noRelevantChunks: true,
        contextText: "",
        sources: [],
      };
    }

    // 3. Assemble structured, deduplicated, and bounded context with adaptive relevance filtering
    const retrievedDocNames = Array.from(
      new Set(matches.map((m) => m.payload?.filename).filter(Boolean))
    );

    const contextResult = buildKnowledgeBaseContext(matches, {
      targetDocumentId: documentId,
      scoreThreshold,
      query: cleanQuery,
    });

    if (!contextResult.hasContext) {
      return {
        hasContext: false,
        noRelevantChunks: true,
        contextText: "",
        sources: [],
        candidatesCount: matches.length,
        retrievedDocNames,
        contextChunksCount: 0,
      };
    }

    return {
      hasContext: true,
      contextText: contextResult.contextText,
      sources: contextResult.sources,
      candidatesCount: matches.length,
      retrievedDocNames,
      contextChunksCount: contextResult.contextChunksCount || 0,
    };
  } catch (err) {
    console.error(`[kb.service] Retrieval error for workspace ${workspaceId}:`, err.message);
    return {
      hasContext: false,
      qdrantUnavailable: true,
      contextText: "",
      sources: [],
      error: err.message,
    };
  }
}

/**
 * Delete a Knowledge Base document:
 * 1. Removes all vector points from Qdrant where scope = "knowledge_base" AND documentId = targetId
 * 2. Deletes original physical file from disk
 * 3. Deletes document record in MongoDB
 *
 * @param {string} documentId
 * @param {string} [workspaceId="default"]
 * @returns {Promise<boolean>}
 */
export async function deleteKnowledgeBaseDocument(documentId, workspaceId = "default") {
  if (!documentId) return false;

  const doc = await KnowledgeBaseDocument.findOne({
    _id: documentId,
    workspaceId,
  });

  if (!doc) {
    return false;
  }

  // 1. Delete Qdrant vectors strictly scoped to knowledge_base
  await deleteKnowledgeBasePoints(documentId, workspaceId).catch((err) => {
    console.warn(`[kb.service] Warning deleting Qdrant points for doc ${documentId}:`, err.message);
  });

  // 2. Remove physical file from disk if present
  if (doc.originalFileReference && fs.existsSync(doc.originalFileReference)) {
    try {
      fs.unlinkSync(doc.originalFileReference);
    } catch (fsErr) {
      console.warn(`[kb.service] Warning removing disk file for doc ${documentId}:`, fsErr.message);
    }
  }

  // 3. Delete MongoDB metadata record
  await KnowledgeBaseDocument.deleteOne({ _id: documentId });

  console.log(`[kb.service] Deleted Knowledge Base document ${documentId} ("${doc.filename}").`);
  return true;
}

/**
 * List all Knowledge Base documents for a workspace.
 *
 * @param {string} [workspaceId="default"]
 * @returns {Promise<Array<object>>}
 */
export async function listKnowledgeBaseDocuments(workspaceId = "default") {
  const docs = await KnowledgeBaseDocument.find({
    scope: "knowledge_base",
    workspaceId,
  })
    .sort({ createdAt: -1 })
    .lean();

  return docs.map((d) => ({
    id: d._id,
    filename: d.filename,
    size: d.size,
    mimeType: d.mimeType,
    status: d.status,
    statusMessage: d.statusMessage,
    chunkCount: d.chunkCount,
    documentVersion: d.documentVersion,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  }));
}

/**
 * Get active indexed Knowledge Base documents with IDs and filenames for a workspace.
 *
 * @param {string} [workspaceId="default"]
 * @returns {Promise<Array<{id: string, filename: string, status: string}>>}
 */
export async function getKnowledgeBaseDocuments(workspaceId = "default") {
  try {
    const docs = await KnowledgeBaseDocument.find(
      { scope: "knowledge_base", workspaceId, status: "indexed" },
      { _id: 1, filename: 1, status: 1 }
    ).lean();

    return docs.map((d) => ({
      id: d._id.toString(),
      filename: d.filename,
      status: d.status,
    }));
  } catch {
    return [];
  }
}

/**
 * Get active filenames in the Knowledge Base for a workspace (for RAG Router matching).
 *
 * @param {string} [workspaceId="default"]
 * @returns {Promise<Array<string>>}
 */
export async function getKnowledgeBaseDocumentNames(workspaceId = "default") {
  try {
    const docs = await KnowledgeBaseDocument.find(
      { scope: "knowledge_base", workspaceId, status: "indexed" },
      { filename: 1 }
    ).lean();

    return docs.map((d) => d.filename);
  } catch {
    return [];
  }
}

export default {
  indexKnowledgeBaseDocument,
  retrieveKnowledgeBaseContext,
  deleteKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
  getKnowledgeBaseDocuments,
  getKnowledgeBaseDocumentNames,
  chunkKnowledgeBasePages,
};
