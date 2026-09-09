import { extractTextContent } from "@/lib/messageUtils";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch } from "@/lib/api";
import { useChatPersistence } from "./useChatPersistence";
import { useChatStream } from "./useChatStream";

export function useChat({ id: chatId, model, webSearchEnabled, memoryEnabled }) {
  const [input, setInput] = useState("");
  const [inputFiles, setInputFiles] = useState([]);
  const [isAgentWorking, setIsAgentWorking] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);

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

    // Check for explicit /agent trigger
    if (/^\/agent(?:\s+|$)/i.test(trimmedContent)) {
      const agentTask = trimmedContent.replace(/^\/agent\s*/i, "").trim();
      if (!agentTask) {
        toast.error("Please provide a task for the agent. Example: /agent Calculate 25 * 0.17");
        return;
      }

      const messageId = crypto.randomUUID();
      const createdAt = Date.now();
      setInput("");
      setInputFiles([]);
      stream.clearError();

      try {
        // Save user message immediately
        await saveUserMessage(
          { id: messageId, content: trimmedContent, fileIds, createdAt, model: "agent" },
          chatId
        );

        setIsAgentWorking(true);
        setAgentStatus("Planning → Executing tool → Preparing answer");

        const agentResult = await apiFetch("/api/agent/tasks", {
          method: "POST",
          body: JSON.stringify({
            message: agentTask,
            chatId,
          }),
        });

        const assistantMessageId = crypto.randomUUID();
        const responseText =
          agentResult.response ||
          (agentResult.success ? "Task completed." : (agentResult.error || "Agent task failed."));

        await saveAssistantMessage(
          {
            id: assistantMessageId,
            content: responseText,
            model: "agent",
            metadata:
              agentResult.steps?.length > 0
                ? { steps: agentResult.steps, taskId: agentResult.taskId }
                : null,
            createdAt: Date.now(),
          },
          chatId
        );
      } catch (err) {
        console.error("[useChat] Agent execution error:", err);
        const assistantMessageId = crypto.randomUUID();
        await saveAssistantMessage(
          {
            id: assistantMessageId,
            content: `Agent task could not be completed: ${err.message || "Unknown error"}`,
            model: "agent",
            createdAt: Date.now(),
          },
          chatId
        );
        toast.error(err.message || "Agent task failed");
      } finally {
        setIsAgentWorking(false);
        setAgentStatus(null);
      }
      return;
    }

    // Normal chat message flow
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

  const isLoading = (chatId && isChatLoading) || stream.isStreaming || isAgentWorking;

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
    isAgentWorking,
    agentStatus,
    isChatError,
    error: stream.error,
    clearError: stream.clearError,
    currentChat: chat,
    stop: stream.stop,
    regenerate: stream.isStreaming ? undefined : stream.regenerate,
    status: stream.status,
  };
}
