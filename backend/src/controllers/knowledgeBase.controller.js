/**
 * Knowledge Base Controller
 *
 * REST API handlers for Knowledge Base document management:
 * - GET    /api/knowledge-base/documents
 * - POST   /api/knowledge-base/documents
 * - DELETE /api/knowledge-base/documents/:documentId
 */

import path from "path";
import KnowledgeBaseDocument from "../models/KnowledgeBaseDocument.js";
import {
  indexKnowledgeBaseDocument,
  deleteKnowledgeBaseDocument,
  listKnowledgeBaseDocuments,
} from "../services/knowledgeBase.service.js";

/**
 * GET /api/knowledge-base/documents
 * List all documents in the workspace Knowledge Base.
 */
export async function getDocuments(req, res) {
  try {
    const workspaceId = req.headers["x-workspace-id"] || req.workspaceId || "default";
    const docs = await listKnowledgeBaseDocuments(workspaceId);

    return res.json({
      success: true,
      documents: docs,
    });
  } catch (err) {
    console.error("[kb.controller] getDocuments error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to fetch Knowledge Base documents.",
    });
  }
}

/**
 * POST /api/knowledge-base/documents
 * Upload a PDF document to the Knowledge Base and trigger background indexing.
 */
export async function uploadDocument(req, res) {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: "No file uploaded. Please provide a PDF document.",
      });
    }

    const { originalname, mimetype, size, path: filePath } = req.file;
    const ext = path.extname(originalname).toLowerCase();

    // Validate MIME type and extension
    if (mimetype !== "application/pdf" && ext !== ".pdf") {
      return res.status(400).json({
        success: false,
        error: "Only PDF documents are supported for the Knowledge Base.",
      });
    }

    const workspaceId = req.headers["x-workspace-id"] || req.workspaceId || "default";
    const userId = req.userId || null;

    // Create MongoDB metadata entry
    const kbDoc = await KnowledgeBaseDocument.create({
      filename: originalname,
      originalFileReference: filePath,
      mimeType: mimetype,
      size,
      scope: "knowledge_base",
      workspaceId,
      userId,
      status: "uploaded",
      documentVersion: 1,
    });

    console.log(`[kb.controller] Created Knowledge Base record for "${originalname}" (${kbDoc._id})`);

    // Trigger background indexing without blocking the response
    indexKnowledgeBaseDocument(kbDoc).catch((e) => {
      console.error(`[kb.controller] Asynchronous indexing failed for ${kbDoc._id}:`, e.message);
    });

    return res.status(201).json({
      success: true,
      message: "Document uploaded successfully and queued for indexing.",
      document: {
        id: kbDoc._id,
        filename: kbDoc.filename,
        size: kbDoc.size,
        mimeType: kbDoc.mimeType,
        status: kbDoc.status,
        chunkCount: kbDoc.chunkCount,
        documentVersion: kbDoc.documentVersion,
        createdAt: kbDoc.createdAt,
      },
    });
  } catch (err) {
    console.error("[kb.controller] uploadDocument error:", err);
    return res.status(500).json({
      success: false,
      error: err.message || "Failed to upload document.",
    });
  }
}

/**
 * DELETE /api/knowledge-base/documents/:documentId
 * Delete a document from MongoDB, Qdrant vectors, and local disk.
 */
export async function deleteDocument(req, res) {
  try {
    const { documentId } = req.params;
    const workspaceId = req.headers["x-workspace-id"] || req.workspaceId || "default";

    if (!documentId) {
      return res.status(400).json({
        success: false,
        error: "Document ID is required.",
      });
    }

    const success = await deleteKnowledgeBaseDocument(documentId, workspaceId);

    if (!success) {
      return res.status(404).json({
        success: false,
        error: "Document not found or already deleted.",
      });
    }

    return res.json({
      success: true,
      message: "Document and associated vectors deleted successfully.",
    });
  } catch (err) {
    console.error("[kb.controller] deleteDocument error:", err);
    return res.status(500).json({
      success: false,
      error: "Failed to delete Knowledge Base document.",
    });
  }
}

export default {
  getDocuments,
  uploadDocument,
  deleteDocument,
};
