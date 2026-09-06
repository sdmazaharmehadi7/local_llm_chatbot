/**
 * Document Loader
 *
 * Reads knowledge files (.txt, .md, .pdf) from the specified documents directory.
 * Cleans and normalizes text for chunking and embedding.
 */

import fs from "fs/promises";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const pdfParse = require("pdf-parse");
import { RAG_CONFIG } from "./config.js";

/**
 * Normalizes text content by trimming extra whitespace and weird line endings.
 * @param {string} text
 * @returns {string}
 */
export function cleanText(text) {
  if (!text || typeof text !== "string") return "";
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+/g, " ")
    .trim();
}

/**
 * Reads a single document file and extracts text.
 * @param {string} filePath
 * @returns {Promise<{id: string, filename: string, content: string, metadata: object}|null>}
 */
export async function loadDocumentFromFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const filename = path.basename(filePath);

  if (![".txt", ".md", ".pdf"].includes(ext)) {
    return null; // Skip unsupported extensions
  }

  try {
    const stats = await fs.stat(filePath);
    let rawText = "";

    if (ext === ".pdf") {
      const dataBuffer = await fs.readFile(filePath);
      const pdfData = await pdfParse(dataBuffer);
      rawText = pdfData.text || "";
    } else {
      // .txt or .md
      rawText = await fs.readFile(filePath, "utf-8");
    }

    const cleanedText = cleanText(rawText);

    if (!cleanedText) {
      return null;
    }

    return {
      id: filename,
      filename,
      content: cleanedText,
      metadata: {
        extension: ext,
        sizeBytes: stats.size,
        charCount: cleanedText.length,
        modifiedTime: stats.mtime.toISOString(),
      },
    };
  } catch (err) {
    console.error(`[RAG DocumentLoader] Error loading file "${filename}":`, err.message);
    return null;
  }
}

/**
 * Loads all supported documents from the documents directory.
 * @param {string} [dirPath] - Optional directory override
 * @returns {Promise<Array<{id: string, filename: string, content: string, metadata: object}>>}
 */
export async function loadAllDocuments(dirPath = RAG_CONFIG.documentsPath) {
  try {
    // Ensure directory exists
    await fs.mkdir(dirPath, { recursive: true });

    const files = await fs.readdir(dirPath);
    const documents = [];

    for (const file of files) {
      const fullPath = path.join(dirPath, file);
      const stat = await fs.stat(fullPath);

      if (stat.isFile()) {
        const doc = await loadDocumentFromFile(fullPath);
        if (doc) {
          documents.push(doc);
        }
      }
    }

    return documents;
  } catch (err) {
    console.error("[RAG DocumentLoader] Error reading documents directory:", err.message);
    return [];
  }
}
