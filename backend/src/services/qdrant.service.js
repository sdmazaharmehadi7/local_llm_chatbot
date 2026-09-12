/**
 * Qdrant Service
 *
 * Handles HTTP communication with the local Qdrant instance.
 *
 * ARCHITECTURE RULES:
 * - Uses ONE collection: local_chat_documents
 * - Payload-based isolation: every vector point contains chatId, userId, scope: "chat"
 * - Retrieval strictly filters by scope = "chat" and chatId = currentChatId
 * - Chat A cannot retrieve documents from Chat B at the database query layer
 */

const QDRANT_URL = process.env.QDRANT_URL || "http://localhost:6333";
const COLLECTION_NAME = process.env.QDRANT_COLLECTION || "local_chat_documents";
const VECTOR_SIZE = 768; // Dimension for nomic-embed-text
const DISTANCE_METRIC = "Cosine";

/**
 * Check whether Qdrant instance is reachable.
 * @returns {Promise<boolean>}
 */
export async function isQdrantReachable() {
  try {
    const res = await fetch(`${QDRANT_URL}/collections`, {
      signal: AbortSignal.timeout(3000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Ensures the Qdrant RAG collection exists with proper schema and payload indices.
 * @returns {Promise<boolean>}
 */
export async function ensureCollection() {
  try {
    const checkRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      signal: AbortSignal.timeout(5000),
    });

    if (checkRes.ok) {
      return true;
    }

    // Create collection if it doesn't exist
    const createRes = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        vectors: {
          size: VECTOR_SIZE,
          distance: DISTANCE_METRIC,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!createRes.ok) {
      const errText = await createRes.text().catch(() => "");
      console.error(`[qdrant.service] Failed to create collection ${COLLECTION_NAME}:`, errText);
      return false;
    }

    console.log(`[qdrant.service] Collection "${COLLECTION_NAME}" initialized successfully.`);

    // Create payload indexes for fast filtered search
    await _createPayloadIndex("chatId", "keyword");
    await _createPayloadIndex("scope", "keyword");
    await _createPayloadIndex("userId", "keyword");
    await _createPayloadIndex("documentId", "keyword");
    await _createPayloadIndex("workspaceId", "keyword");

    return true;
  } catch (err) {
    console.error("[qdrant.service] Error ensuring collection:", err.message);
    return false;
  }
}

/**
 * Create a payload field index in Qdrant.
 */
async function _createPayloadIndex(fieldName, schema = "keyword") {
  try {
    await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/index`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        field_name: fieldName,
        field_schema: schema,
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch (err) {
    console.warn(`[qdrant.service] Index creation warning for ${fieldName}:`, err.message);
  }
}

/**
 * Upsert points into Qdrant collection.
 *
 * @param {Array<{id: string, vector: number[], payload: object}>} points
 * @returns {Promise<boolean>}
 */
export async function upsertPoints(points) {
  if (!Array.isArray(points) || points.length === 0) {
    return true;
  }

  await ensureCollection();

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points?wait=true`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      throw new Error(`Qdrant upsert error (${res.status}): ${errText}`);
    }

    return true;
  } catch (err) {
    console.error("[qdrant.service] Upsert failed:", err.message);
    throw err;
  }
}

/**
 * Scroll and retrieve points belonging to a specific chat.
 * Used for full-document context retrieval (e.g. summaries, small PDFs).
 *
 * @param {object} params
 * @param {string} params.chatId - Current chat ID
 * @param {string} [params.userId] - User ID if available
 * @param {string} [params.scope="chat"] - Scope identifier
 * @param {number} [params.limit=50] - Max points to retrieve
 * @returns {Promise<Array<{id: string, payload: object}>>}
 */
export async function getChatPoints({
  chatId,
  userId = null,
  scope = "chat",
  limit = 50,
}) {
  if (!chatId) return [];

  const mustFilters = [
    { key: "scope", match: { value: scope } },
    { key: "chatId", match: { value: String(chatId) } },
  ];

  if (userId) {
    mustFilters.push({ key: "userId", match: { value: String(userId) } });
  }

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/scroll`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: { must: mustFilters },
        limit,
        with_payload: true,
        with_vector: false,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[qdrant.service] Scroll request failed (${res.status}):`, errText);
      return [];
    }

    const data = await res.json();
    return data?.result?.points || [];
  } catch (err) {
    console.error("[qdrant.service] Scroll error:", err.message);
    return [];
  }
}

/**
 * Perform chat-scoped similarity search.
 *
 * STRICT SECURITY:
 * Must filter by scope = "chat" and chatId = currentChatId.
 * If userId is provided, filters by userId.
 *
 * @param {object} params
 * @param {number[]} params.vector - Query embedding vector
 * @param {string} params.chatId - Chat ID to isolate retrieval
 * @param {string} [params.userId] - User ID if authenticated
 * @param {string} [params.scope="chat"] - Scope identifier
 * @param {number} [params.limit=15] - Number of chunks to retrieve
 * @param {number} [params.scoreThreshold=0.15] - Minimum similarity threshold
 * @returns {Promise<Array<{id: string, score: number, payload: object}>>}
 */
export async function searchChatPoints({
  vector,
  chatId,
  userId = null,
  scope = "chat",
  limit = 15,
  scoreThreshold = 0.15,
}) {
  if (!chatId) {
    console.warn("[qdrant.service] Search aborted: missing chatId.");
    return [];
  }

  if (!Array.isArray(vector) || vector.length === 0) {
    console.warn("[qdrant.service] Search aborted: empty query vector.");
    return [];
  }

  const mustFilters = [
    { key: "scope", match: { value: scope } },
    { key: "chatId", match: { value: String(chatId) } },
  ];

  if (userId) {
    mustFilters.push({ key: "userId", match: { value: String(userId) } });
  }

  const searchPayload = {
    vector,
    limit,
    filter: {
      must: mustFilters,
    },
    with_payload: true,
    score_threshold: scoreThreshold,
  };

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchPayload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[qdrant.service] Search request failed (${res.status}):`, errText);
      return [];
    }

    const data = await res.json();
    return data?.result || [];
  } catch (err) {
    console.error("[qdrant.service] Search error:", err.message);
    return [];
  }
}

/**
 * Delete all points belonging to a specific chat (e.g. when chat is deleted).
 * @param {string} chatId
 * @returns {Promise<boolean>}
 */
export async function deletePointsByChatId(chatId) {
  if (!chatId) return false;

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: {
          must: [
            { key: "scope", match: { value: "chat" } },
            { key: "chatId", match: { value: String(chatId) } },
          ],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    return res.ok;
  } catch (err) {
    console.error(`[qdrant.service] Delete points for chat ${chatId} failed:`, err.message);
    return false;
  }
}

/**
 * Delete all points belonging to a specific document.
 * @param {string} documentId
 * @returns {Promise<boolean>}
 */
export async function deletePointsByDocumentId(documentId) {
  if (!documentId) return false;

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: {
          must: [{ key: "documentId", match: { value: String(documentId) } }],
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    return res.ok;
  } catch (err) {
    console.error(`[qdrant.service] Delete points for doc ${documentId} failed:`, err.message);
    return false;
  }
}

/**
 * Count documents/chunks for a given chat ID.
 * @param {string} chatId
 * @returns {Promise<number>}
 */
export async function countPointsForChat(chatId) {
  if (!chatId) return 0;

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: {
          must: [
            { key: "scope", match: { value: "chat" } },
            { key: "chatId", match: { value: String(chatId) } },
          ],
        },
        exact: true,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return 0;
    const data = await res.json();
    return data?.result?.count || 0;
  } catch {
    return 0;
  }
}

/**
 * Perform Knowledge Base similarity search.
 *
 * STRICT SECURITY & ISOLATION:
 * - Must filter by scope = "knowledge_base"
 * - Filters by workspaceId (default "default")
 * - If userId is provided, applies user constraint
 * - CANNOT retrieve chat-scoped documents (scope = "chat")
 *
 * @param {object} params
 * @param {number[]} params.vector - Query embedding vector
 * @param {string} [params.workspaceId="default"] - Workspace ID
 * @param {string} [params.documentId=null] - Optional specific document ID filter
 * @param {string} [params.workspaceId="default"] - Workspace ID
 * @param {string} [params.userId=null] - User ID if authenticated
 * @param {number} [params.limit=10] - Number of chunks to retrieve
 * @param {number} [params.scoreThreshold=0.35] - Minimum cosine similarity threshold
 * @returns {Promise<Array<{id: string, score: number, payload: object}>>}
 */
export async function searchKnowledgeBasePoints({
  vector,
  documentId = null,
  workspaceId = "default",
  userId = null,
  limit = 10,
  scoreThreshold = 0.35,
}) {
  if (!Array.isArray(vector) || vector.length === 0) {
    console.warn("[qdrant.service] KB search aborted: empty query vector.");
    return [];
  }

  const mustFilters = [{ key: "scope", match: { value: "knowledge_base" } }];

  if (documentId) {
    mustFilters.push({ key: "documentId", match: { value: String(documentId) } });
  }

  if (workspaceId) {
    mustFilters.push({ key: "workspaceId", match: { value: String(workspaceId) } });
  }

  const searchPayload = {
    vector,
    limit,
    filter: {
      must: mustFilters,
    },
    with_payload: true,
    score_threshold: scoreThreshold,
  };

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(searchPayload),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      console.error(`[qdrant.service] KB search request failed (${res.status}):`, errText);
      return [];
    }

    const data = await res.json();
    return data?.result || [];
  } catch (err) {
    console.error("[qdrant.service] KB search error:", err.message);
    return [];
  }
}

/**
 * Delete all points belonging to a Knowledge Base document.
 *
 * STRICT ISOLATION:
 * Only deletes points with scope = "knowledge_base" AND documentId = targetId.
 * Never touches chat points (scope = "chat").
 *
 * @param {string} documentId
 * @param {string} [workspaceId="default"]
 * @returns {Promise<boolean>}
 */
export async function deleteKnowledgeBasePoints(documentId, workspaceId = "default") {
  if (!documentId) return false;

  const mustFilters = [
    { key: "scope", match: { value: "knowledge_base" } },
    { key: "documentId", match: { value: String(documentId) } },
  ];

  if (workspaceId) {
    mustFilters.push({ key: "workspaceId", match: { value: String(workspaceId) } });
  }

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/delete`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: {
          must: mustFilters,
        },
      }),
      signal: AbortSignal.timeout(10000),
    });

    return res.ok;
  } catch (err) {
    console.error(`[qdrant.service] Delete KB points for doc ${documentId} failed:`, err.message);
    return false;
  }
}

/**
 * Count points for Knowledge Base in a given workspace.
 * @param {string} [workspaceId="default"]
 * @returns {Promise<number>}
 */
export async function countPointsForKnowledgeBase(workspaceId = "default") {
  const mustFilters = [{ key: "scope", match: { value: "knowledge_base" } }];
  if (workspaceId) {
    mustFilters.push({ key: "workspaceId", match: { value: String(workspaceId) } });
  }

  try {
    const res = await fetch(`${QDRANT_URL}/collections/${COLLECTION_NAME}/points/count`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        filter: {
          must: mustFilters,
        },
        exact: true,
      }),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) return 0;
    const data = await res.json();
    return data?.result?.count || 0;
  } catch {
    return 0;
  }
}
