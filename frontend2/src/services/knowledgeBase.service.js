/**
 * Knowledge Base Frontend API Service
 *
 * Handles HTTP requests to the backend for Knowledge Base documents:
 * - GET    /api/knowledge-base/documents
 * - POST   /api/knowledge-base/documents (multipart upload)
 * - DELETE /api/knowledge-base/documents/:id
 */

import { apiFetch, API_BASE } from "./api";

/**
 * Fetch all Knowledge Base documents.
 * @returns {Promise<Array<object>>}
 */
export async function getKnowledgeBaseDocuments() {
  const data = await apiFetch("/api/knowledge-base/documents");
  return data?.documents || [];
}

/**
 * Upload a PDF file to the Knowledge Base.
 * @param {File} file
 * @returns {Promise<object>}
 */
export async function uploadKnowledgeBaseDocument(file) {
  const formData = new FormData();
  formData.append("file", file);

  const url = `${API_BASE}/api/knowledge-base/documents`;
  const response = await fetch(url, {
    method: "POST",
    credentials: "include",
    body: formData,
  });

  if (!response.ok) {
    const errorData = await response.json().catch(() => null);
    throw new Error(errorData?.error || `Upload failed (${response.status})`);
  }

  return response.json();
}

/**
 * Delete a Knowledge Base document.
 * @param {string} documentId
 * @returns {Promise<boolean>}
 */
export async function deleteKnowledgeBaseDocument(documentId) {
  const data = await apiFetch(`/api/knowledge-base/documents/${documentId}`, {
    method: "DELETE",
  });
  return data?.success || false;
}

export default {
  getKnowledgeBaseDocuments,
  uploadKnowledgeBaseDocument,
  deleteKnowledgeBaseDocument,
};
