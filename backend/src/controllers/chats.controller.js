/**
 * Chats Controller
 *
 * Provides REST persistence for chats and messages backed by PostgreSQL (Neon).
 */

import { query } from "../db/index.js";

/**
 * GET /api/chats
 */
export async function getChats(req, res) {
  try {
    const result = await query(
      `SELECT 
        id, 
        user_id, 
        folder_id, 
        title, 
        pinned_at, 
        archived_at, 
        created_at, 
        updated_at 
       FROM chats 
       ORDER BY pinned_at DESC NULLS LAST, updated_at DESC`
    );

    return res.json({ chats: result.rows });
  } catch (err) {
    console.error("[chats.controller] getChats error:", err.message);
    return res.status(500).json({ error: "Failed to fetch chats from database." });
  }
}

/**
 * GET /api/chats/:id
 */
export async function getChat(req, res) {
  const { id } = req.params;
  try {
    const result = await query("SELECT * FROM chats WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found." });
    }
    return res.json(result.rows[0]);
  } catch (err) {
    console.error("[chats.controller] getChat error:", err.message);
    return res.status(500).json({ error: "Failed to fetch chat." });
  }
}

/**
 * POST /api/chats
 */
export async function createChat(req, res) {
  const { id, title, folder_id, user_id } = req.body;
  const chatId = id || `chat-${Date.now()}`;
  const chatTitle = title || "New Chat";
  const userId = user_id || "user-local-admin";
  const folderId = folder_id || null;

  try {
    const result = await query(
      `INSERT INTO chats (id, user_id, folder_id, title, created_at, updated_at)
       VALUES ($1, $2, $3, $4, NOW(), NOW())
       ON CONFLICT (id) DO UPDATE 
       SET title = EXCLUDED.title, updated_at = NOW()
       RETURNING *`,
      [chatId, userId, folderId, chatTitle]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[chats.controller] createChat error:", err.message);
    return res.status(500).json({ error: "Failed to create chat." });
  }
}

/**
 * PATCH /api/chats/:id
 */
export async function updateChat(req, res) {
  const { id } = req.params;
  const { title, folder_id, pinned_at, archived_at } = req.body;

  try {
    const current = await query("SELECT * FROM chats WHERE id = $1", [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Chat not found." });
    }

    const updatedTitle = title !== undefined ? title : current.rows[0].title;
    const updatedFolderId = folder_id !== undefined ? folder_id : current.rows[0].folder_id;
    const updatedPinnedAt = pinned_at !== undefined ? pinned_at : current.rows[0].pinned_at;
    const updatedArchivedAt = archived_at !== undefined ? archived_at : current.rows[0].archived_at;

    const result = await query(
      `UPDATE chats 
       SET title = $1, folder_id = $2, pinned_at = $3, archived_at = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [updatedTitle, updatedFolderId, updatedPinnedAt, updatedArchivedAt, id]
    );

    return res.json(result.rows[0]);
  } catch (err) {
    console.error("[chats.controller] updateChat error:", err.message);
    return res.status(500).json({ error: "Failed to update chat." });
  }
}

/**
 * DELETE /api/chats/:id
 */
export async function deleteChat(req, res) {
  const { id } = req.params;
  try {
    await query("DELETE FROM chats WHERE id = $1", [id]);
    return res.json({ success: true, id });
  } catch (err) {
    console.error("[chats.controller] deleteChat error:", err.message);
    return res.status(500).json({ error: "Failed to delete chat." });
  }
}

/**
 * GET /api/chats/:id/messages
 */
export async function getMessages(req, res) {
  const { id: chatId } = req.params;
  try {
    const result = await query(
      `SELECT id, chat_id, role, content, parts, created_at 
       FROM messages 
       WHERE chat_id = $1 
       ORDER BY created_at ASC`,
      [chatId]
    );

    return res.json({ messages: result.rows });
  } catch (err) {
    console.error("[chats.controller] getMessages error:", err.message);
    return res.status(500).json({ error: "Failed to fetch messages." });
  }
}

/**
 * POST /api/chats/:id/messages
 */
export async function createMessage(req, res) {
  const { id: chatId } = req.params;
  const { id, role, content, parts } = req.body;

  const msgId = id || `msg-${Date.now()}`;
  const msgRole = role || "user";
  const msgContent = content || "";
  const msgParts = parts || [{ type: "text", text: msgContent }];

  try {
    // Ensure parent chat exists
    await query(
      `INSERT INTO chats (id, user_id, title, created_at, updated_at)
       VALUES ($1, 'user-local-admin', 'New Chat', NOW(), NOW())
       ON CONFLICT (id) DO UPDATE SET updated_at = NOW()`,
      [chatId]
    );

    const result = await query(
      `INSERT INTO messages (id, chat_id, role, content, parts, created_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       RETURNING *`,
      [msgId, chatId, msgRole, msgContent, JSON.stringify(msgParts)]
    );

    return res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("[chats.controller] createMessage error:", err.message);
    return res.status(500).json({ error: "Failed to save message." });
  }
}

/**
 * DELETE /api/chats/:id/messages/:messageId
 */
export async function deleteMessage(req, res) {
  const { messageId } = req.params;
  try {
    await query("DELETE FROM messages WHERE id = $1", [messageId]);
    return res.json({ success: true, messageId });
  } catch (err) {
    console.error("[chats.controller] deleteMessage error:", err.message);
    return res.status(500).json({ error: "Failed to delete message." });
  }
}

/**
 * POST /api/chats/:id/pin
 */
export async function pinChat(req, res) {
  const { id } = req.params;
  try {
    const result = await query(
      "UPDATE chats SET pinned_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    return res.json(result.rows[0] || { success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/chats/:id/pin
 */
export async function unpinChat(req, res) {
  const { id } = req.params;
  try {
    const result = await query(
      "UPDATE chats SET pinned_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    return res.json(result.rows[0] || { success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/chats/:id/archive
 */
export async function archiveChat(req, res) {
  const { id } = req.params;
  try {
    const result = await query(
      "UPDATE chats SET archived_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    return res.json(result.rows[0] || { success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * DELETE /api/chats/:id/archive
 */
export async function unarchiveChat(req, res) {
  const { id } = req.params;
  try {
    const result = await query(
      "UPDATE chats SET archived_at = NULL, updated_at = NOW() WHERE id = $1 RETURNING *",
      [id]
    );
    return res.json(result.rows[0] || { success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
