import { getMessageTimestamp } from "./messageUtils.js";

export function toCanonicalMessage(msg) {
  const parts = Array.isArray(msg.parts) && msg.parts.length > 0
    ? msg.parts
    : [{ type: "text", text: msg.content ?? "" }];

  if (msg.metadata?.toolParts && !parts.some((p) => p.type === "tool-invocation")) {
    parts.push(...msg.metadata.toolParts);
  }

  // Normalize fileIds whether stored as array of strings, array of file objects, or under files property
  let normalizedFileIds = [];
  if (Array.isArray(msg.fileIds) && msg.fileIds.length > 0) {
    normalizedFileIds = msg.fileIds.map((f) => (typeof f === "object" && f !== null ? f.id || f._id : f)).filter(Boolean);
  } else if (Array.isArray(msg.files) && msg.files.length > 0) {
    normalizedFileIds = msg.files.map((f) => (typeof f === "object" && f !== null ? f.id || f._id : f)).filter(Boolean);
  }

  return {
    id: msg.id || msg._id,
    role: msg.role,
    content: msg.content ?? "",
    parts,
    fileIds: normalizedFileIds,
    model: msg.model || null,
    createdAt: getMessageTimestamp(msg),
  };
}
