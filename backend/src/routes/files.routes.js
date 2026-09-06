/**
 * Files Routes
 *
 * Handles file attachments:
 *   POST /api/files            - Upload a file (multipart/form-data)
 *   GET  /api/files/:id        - Get file metadata
 *   GET  /api/files/:id/content - Stream or send binary file content
 */

import { Router } from "express";
import multer from "multer";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import mongoose from "mongoose";
import File from "../models/File.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Uploads directory: SIH backend/uploads
const UPLOADS_DIR = path.resolve(__dirname, "../../uploads");
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// Allowed MIME types for images
const ALLOWED_MIME_TYPES = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
]);

const ALLOWED_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

const MAX_FILE_SIZE_BYTES = 10 * 1024 * 1024; // 10MB

function formatFileSize(bytes) {
  if (bytes === 0) return "0 Bytes";
  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

// Multer storage: save to disk with unique filename
const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    const uniqueId = new mongoose.Types.ObjectId().toString();
    cb(null, `${uniqueId}${ext}`);
  },
});

const fileFilter = (_req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  if (ALLOWED_MIME_TYPES.has(file.mimetype) || ALLOWED_EXTENSIONS.has(ext)) {
    cb(null, true);
  } else {
    cb(new Error("Unsupported file type. Only PNG, JPG/JPEG, and WEBP images are allowed."));
  }
};

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE_BYTES },
  fileFilter,
});

const router = Router();

/**
 * POST /api/files
 * Upload an image file attachment.
 */
router.post("/", (req, res) => {
  upload.single("file")(req, res, async (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(400).json({
          success: false,
          error: `File is too large. Maximum file size is ${formatFileSize(MAX_FILE_SIZE_BYTES)}.`,
        });
      }
      return res.status(400).json({ success: false, error: err.message });
    }

    if (!req.file) {
      return res.status(400).json({ success: false, error: "No file was uploaded." });
    }

    try {
      const fileId = path.parse(req.file.filename).name;
      const mimeType = req.file.mimetype || "application/octet-stream";
      const isImage = mimeType.startsWith("image/");

      const fileDoc = await File.create({
        _id: fileId,
        userId: req.userId,
        filename: req.file.originalname || "attachment",
        mimeType,
        size: req.file.size,
        category: isImage ? "image" : "file",
        path: req.file.path,
        createdAt: new Date(),
      });

      return res.status(201).json({
        id: fileDoc._id,
        filename: fileDoc.filename,
        mimeType: fileDoc.mimeType,
        size: fileDoc.size,
        sizeFormatted: formatFileSize(fileDoc.size),
        category: fileDoc.category,
        url: `/api/files/${fileDoc._id}/content`,
      });
    } catch (saveErr) {
      console.error("[files.routes] Failed to save file metadata:", saveErr);
      return res.status(500).json({ success: false, error: "Failed to process uploaded file." });
    }
  });
});

/**
 * GET /api/files/:id
 * Retrieve file metadata.
 */
router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const fileDoc = await File.findById(id);

    if (!fileDoc) {
      return res.status(404).json({ success: false, error: "File not found." });
    }

    return res.json({
      id: fileDoc._id,
      filename: fileDoc.filename,
      mimeType: fileDoc.mimeType,
      size: fileDoc.size,
      sizeFormatted: formatFileSize(fileDoc.size),
      category: fileDoc.category,
      url: `/api/files/${fileDoc._id}/content`,
      createdAt: fileDoc.createdAt,
    });
  } catch (err) {
    console.error("[files.routes] Error fetching file metadata:", err);
    return res.status(500).json({ success: false, error: "Failed to retrieve file metadata." });
  }
});

/**
 * GET /api/files/:id/content
 * Stream / send binary file content.
 */
router.get("/:id/content", async (req, res) => {
  try {
    const { id } = req.params;
    const fileDoc = await File.findById(id);

    if (!fileDoc || !fileDoc.path || !fs.existsSync(fileDoc.path)) {
      return res.status(404).json({ success: false, error: "File content not found." });
    }

    res.setHeader("Content-Type", fileDoc.mimeType || "application/octet-stream");
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.sendFile(path.resolve(fileDoc.path));
  } catch (err) {
    console.error("[files.routes] Error serving file content:", err);
    return res.status(500).json({ success: false, error: "Failed to serve file content." });
  }
});

export default router;
