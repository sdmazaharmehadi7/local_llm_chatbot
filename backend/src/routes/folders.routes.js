/**
 * Folders Routes
 *
 * Handles /api/folders/* endpoints.
 */

import { Router } from "express";
import {
  getFolders,
  getFolder,
  createFolder,
  updateFolder,
  deleteFolder,
  moveChatToFolder,
  getFolderChats,
} from "../controllers/folders.controller.js";

const router = Router();

router.get("/", getFolders);
router.post("/", createFolder);
router.get("/:id", getFolder);
router.put("/:id", updateFolder);
router.delete("/:id", deleteFolder);
router.get("/:folderId/chats", getFolderChats);
router.put("/:folderId/chats/:chatId", moveChatToFolder);

export default router;
