/**
 * Knowledge Base Routes
 *
 * Exposes endpoints for managing Knowledge Base documents:
 *   GET    /api/knowledge-base/documents
 *   POST   /api/knowledge-base/documents
 *   DELETE /api/knowledge-base/documents/:documentId
 */

import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import {
  getDocuments,
  uploadDocument,
  deleteDocument,
} from "../controllers/knowledgeBase.controller.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Dedicated uploads directory for Knowledge Base
const KB_UPLOADS_DIR = path.resolve(__dirname, "../../uploads/knowledge-base");
if (!fs.existsSync(KB_UPLOADS_DIR)) {
  fs.mkdirSync(KB_UPLOADS_DIR, { recursive: true });
}

// Configurable maximum file size (default: 50MB)
const MAX_FILE_SIZE_MB = parseInt(process.env.MAX_KB_FILE_SIZE_MB, 10) || 50;

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, KB_UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    const uniqueName = `kb_${Date.now()}_${Math.random().toString(36).slice(2, 9)}${ext}`;
    cb(null, uniqueName);
  },
});

const upload = multer({
  storage,
  limits: {
    fileSize: MAX_FILE_SIZE_MB * 1024 * 1024,
  },
  fileFilter: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (file.mimetype === "application/pdf" || ext === ".pdf") {
      cb(null, true);
    } else {
      cb(new Error("Only PDF files are supported for Knowledge Base documents."));
    }
  },
});

const router = Router();

router.get("/documents", getDocuments);
router.post("/documents", upload.single("file"), uploadDocument);
router.delete("/documents/:documentId", deleteDocument);

export default router;
