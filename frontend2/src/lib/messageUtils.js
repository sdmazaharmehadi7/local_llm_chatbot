import { MESSAGE_CONSTANTS } from "@/shared";

export function getMessageTimestamp(message, defaultValue = Date.now()) {
  const raw = message?.createdAt ?? message?.created_at ?? defaultValue;
  if (typeof raw === "number" && !isNaN(raw)) return raw;
  if (raw instanceof Date) return raw.getTime();
  if (typeof raw === "string") {
    const parsed = new Date(raw).getTime();
    if (!isNaN(parsed)) return parsed;
  }
  return typeof defaultValue === "number" ? defaultValue : Date.now();
}

export function ensureTimestamp(message, timestampsRef) {
  const existing = getMessageTimestamp(message, null);
  if (existing) {
    if (message.id && timestampsRef?.current) {
      timestampsRef.current.set(message.id, existing);
    }
    return { ...message, createdAt: existing };
  }

  if (message.id && timestampsRef?.current?.has(message.id)) {
    return { ...message, createdAt: timestampsRef.current.get(message.id) };
  }

  const now = Date.now();
  if (message.id && timestampsRef?.current) {
    timestampsRef.current.set(message.id, now);
  }
  return { ...message, createdAt: now };
}

export function extractTextContent(message) {
  if (!message) return "";

  // Check parts array first
  if (Array.isArray(message.parts) && message.parts.length > 0) {
    const textParts = message.parts
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("");
    if (textParts) return textParts;
  }

  // Fallback to content string if parts is empty or absent
  if (typeof message.content === "string") {
    return message.content;
  }

  return "";
}

export function hasTextContent(message) {
  return extractTextContent(message).trim().length > 0;
}

export function deduplicateMessages(messages) {
  const seenIds = new Set();
  const seenContentWindow = new Map();

  return messages.filter((msg) => {
    // 1. Primary deduplication by unique message ID
    if (msg.id) {
      if (seenIds.has(msg.id)) {
        return false;
      }
      seenIds.add(msg.id);
    }

    // 2. Secondary deduplication within a short time window for identical content
    const content = extractTextContent(msg).trim();
    if (content) {
      const timestamp = getMessageTimestamp(msg);
      const bucket = Math.floor(timestamp / MESSAGE_CONSTANTS.DEDUPLICATION_WINDOW_MS);
      const contentKey = `${msg.role}:${content}:${bucket}`;

      if (seenContentWindow.has(contentKey)) {
        return false;
      }
      seenContentWindow.set(contentKey, true);
    }

    return true;
  });
}
