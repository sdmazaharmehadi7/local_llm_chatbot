import { extractTextContent } from "@/lib/messageUtils";
import { useState } from "react";
import { useChatPersistence } from "./useChatPersistence";
import { useChatStream } from "./useChatStream";

export function useChat({ id: chatId, model, webSearchEnabled, memoryEnabled }) {
  const [input, setInput] = useState("");
  const [inputFiles, setInputFiles] = useState([]);

  const {
    chat,
    messages: persistedMessages,
    isChatLoading,
    isChatError,
    saveUserMessage,
    saveAssistantMessage,
  } = useChatPersistence(chatId);

  const hasDocAttached = inputFiles.some(
    (f) =>
      f.category === "pdf" ||
      f.category === "textLike" ||
      f.mimeType === "application/pdf" ||
      (f.filename && f.filename.toLowerCase().endsWith(".pdf"))
  );
  const hasImgAttached = inputFiles.some(
    (f) => f.category === "image" || f.mimeType?.startsWith("image/")
  );
  const effectiveModel = hasDocAttached
    ? "qwen3:8b"
    : hasImgAttached
      ? "qwen2.5vl:7b"
      : model;

  const stream = useChatStream({
    chatId,
    model: effectiveModel,
    webSearchEnabled,
    memoryEnabled,
    persistedMessages,
    onMessageComplete: async ({ id, content, metadata, createdAt }) => {
      if (chatId) {
        await saveAssistantMessage({ id, content, model: effectiveModel, metadata, createdAt }, chatId);
      }
    },
  });

  async function submitMessage({ content, fileIds = [] }) {
    const trimmedContent = content.trim();
    if (!trimmedContent && fileIds.length === 0) return;
    if (!chatId) return;

    const messageId = crypto.randomUUID();
    const createdAt = Date.now();
    setInput("");
    setInputFiles([]);
    stream.clearError();

    try {
      // Save user message immediately to local state/server
      saveUserMessage(
        { id: messageId, content: trimmedContent, fileIds, createdAt, model: effectiveModel },
        chatId
      ).catch((err) => console.error("Failed to save user message", err));

      await stream.send({ id: messageId, content: trimmedContent, fileIds, createdAt });
    } catch (err) {
      console.error("Failed to send message", err);
    }
  }

  function handleSubmit(e) {
    if (e?.preventDefault) {
      e.preventDefault();
    }
    submitMessage({ content: input, fileIds: inputFiles.map((f) => f.id) });
  }

  function handleInputChange(e) {
    setInput(e.target.value);
  }

  const isLoading = (chatId && isChatLoading) || stream.isStreaming;

  const appendFiles = (files) => setInputFiles((prev) => [...prev, ...files]);
  const removeFile = (fileId) => setInputFiles((prev) => prev.filter((f) => f.id !== fileId));

  return {
    messages: stream.messages,
    input,
    setInput,
    inputFiles,
    appendFiles,
    removeFile,
    handleInputChange,
    handleSubmit,
    submitMessage,
    isLoading,
    isChatError,
    error: stream.error,
    clearError: stream.clearError,
    currentChat: chat,
    stop: stream.stop,
    regenerate: stream.isStreaming ? undefined : stream.regenerate,
    status: stream.status,
  };
}
