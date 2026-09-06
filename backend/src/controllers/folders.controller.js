/**
 * Folders Controller
 *
 * Provides REST endpoints for folder organization backed by PostgreSQL.
 */

import { query } from "../db/index.js";

/**
 * GET /api/folders
 */
export async function getFolders(req, res) {
  try {
    const result = await query(
      "SELECT * FROM folders ORDER BY position ASC, created_at ASC"
    );
    return res.json({ folders: result.rows });
  } catch (err) {
    console.error("[folders.controller] getFolders error:", err.message);
    return res.status(500).json({ error: "Failed to fetch folders." });
  }
}

/**
 * GET /api/folders/:id
 */
export async function getFolder(req, res) {
  const { id } = req.params;
  try {
    const result = await query("SELECT * FROM folders WHERE id = $1", [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Folder not found." });
    }
    return res.json({ folder: result.rows[0] });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * POST /api/folders
 */
export async function createFolder(req, res) {
  const { name, color, position, id, user_id } = req.body;
  const folderId = id || `folder-${Date.now()}`;
  const folderName = name || "New Folder";
  const folderColor = color || "#6B7280";
  const folderPos = position || 0;
  const userId = user_id || "user-local-admin";

  try {
    const result = await query(
      `INSERT INTO folders (id, user_id, name, color, position, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
       RETURNING *`,
      [folderId, userId, folderName, folderColor, folderPos]
    );

    return res.status(201).json({ folder: result.rows[0] });
  } catch (err) {
    console.error("[folders.controller] createFolder error:", err.message);
    return res.status(500).json({ error: "Failed to create folder." });
  }
}

/**
 * PUT /api/folders/:id
 */
export async function updateFolder(req, res) {
  const { id } = req.params;
  const { name, color, position, is_collapsed } = req.body;

  try {
    const current = await query("SELECT * FROM folders WHERE id = $1", [id]);
    if (current.rows.length === 0) {
      return res.status(404).json({ error: "Folder not found." });
    }

    const updatedName = name !== undefined ? name : current.rows[0].name;
    const updatedColor = color !== undefined ? color : current.rows[0].color;
    const updatedPosition = position !== undefined ? position : current.rows[0].position;
    const updatedCollapsed = is_collapsed !== undefined ? is_collapsed : current.rows[0].is_collapsed;

    const result = await query(
      `UPDATE folders
       SET name = $1, color = $2, position = $3, is_collapsed = $4, updated_at = NOW()
       WHERE id = $5
       RETURNING *`,
      [updatedName, updatedColor, updatedPosition, updatedCollapsed, id]
    );

    return res.json({ folder: result.rows[0] });
  } catch (err) {
    console.error("[folders.controller] updateFolder error:", err.message);
    return res.status(500).json({ error: "Failed to update folder." });
  }
}

/**
 * DELETE /api/folders/:id
 */
export async function deleteFolder(req, res) {
  const { id } = req.params;
  try {
    await query("DELETE FROM folders WHERE id = $1", [id]);
    return res.json({ success: true, id });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * PUT /api/folders/:folderId/chats/:chatId
 */
export async function moveChatToFolder(req, res) {
  const { folderId, chatId } = req.params;
  const actualFolderId = folderId === "none" ? null : folderId;

  try {
    const result = await query(
      "UPDATE chats SET folder_id = $1, updated_at = NOW() WHERE id = $2 RETURNING *",
      [actualFolderId, chatId]
    );
    return res.json(result.rows[0] || { success: true });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}

/**
 * GET /api/folders/:folderId/chats
 */
export async function getFolderChats(req, res) {
  const { folderId } = req.params;
  try {
    const result = await query(
      "SELECT * FROM chats WHERE folder_id = $1 ORDER BY updated_at DESC",
      [folderId]
    );
    return res.json({ chats: result.rows });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
