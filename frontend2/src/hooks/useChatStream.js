import { DefaultChatTransport } from "ai";
import { useChat as useAIChat } from "@ai-sdk/react";
import { useEffect, useMemo, useRef } from "react";
import {
  deduplicateMessages,
  ensureTimestamp,
  extractTextContent,
  getMessageTimestamp,
} from "@/lib/messageUtils";
import { MESSAGE_CONSTANTS } from "@/shared";

function trimMessageHistory(messages) {
  return messages.slice(-MESSAGE_CONSTANTS.MAX_HISTORY).filter((message) => {
    if (message.role !== "assistant") return true;
    const text = extractTextContent(message);
    return text.trim().length > 0;
  });
}

function formatMessagesForTransport(messages) {
  const pruned = trimMessageHistory(messages);
  return pruned.map((message) => ({
    id: message.id ?? crypto.randomUUID(),
    role: message.role,
    content: extractTextContent(message),
    fileIds: message.fileIds || [],
  }));
}

export function useChatStream({
  chatId,
  model,
  webSearchEnabled,
  memoryEnabled,
  persistedMessages,
  onMessageComplete,
}) {
  const modelRef = useRef(model);
  modelRef.current = model;

  const webSearchRef = useRef(webSearchEnabled);
  webSearchRef.current = webSearchEnabled;

  const memoryEnabledRef = useRef(memoryEnabled);
  memoryEnabledRef.current = memoryEnabled;

  const persistedMessagesRef = useRef(persistedMessages);
  persistedMessagesRef.current = persistedMessages;

  const messageTimestampsRef = useRef(new Map());

  const formattedMessages = (persistedMessages ?? []).map((msg) =>
    ensureTimestamp(msg, messageTimestampsRef)
  );

  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: `/api/chats/${chatId}/completion`,
        prepareSendMessagesRequest: ({ messages: outgoingMessages }) => {
          const persistedForTransport = (persistedMessagesRef.current ?? []).map((msg) => ({
            id: msg.id,
            role: msg.role,
            parts: [{ type: "text", text: msg.content ?? "" }],
            fileIds: msg.fileIds || [],
          }));

          const persistedIds = new Set(persistedForTransport.map((m) => m.id));
          const newMessages = (outgoingMessages ?? []).filter((m) => !persistedIds.has(m.id));
          const normalized = formatMessagesForTransport([...persistedForTransport, ...newMessages]);

          return {
            body: {
              model: modelRef.current,
              systemPromptId: "default",
              messages: normalized,
              webSearch: webSearchRef.current,
              memoryEnabled: memoryEnabledRef.current,
            },
          };
        },
      }),
    [chatId]
  );

  const {
    messages: streamingMessages,
    setMessages,
    sendMessage,
    regenerate,
    status,
    error,
    stop,
    clearError,
  } = useAIChat({
    id: chatId,
    messages: [],
    transport,
    onFinish: async ({ message }) => {
      const content = extractTextContent(message);

      const toolParts =
        message.parts?.filter((p) => p.type === "tool-invocation" && p.state === "result") || [];
      const metadata = toolParts.length > 0 ? { toolParts } : null;

      if (onMessageComplete && content.trim()) {
        await onMessageComplete({
          id: message.id,
          content,
          metadata,
          createdAt: getMessageTimestamp(message),
        });
      }

      // Reset AI SDK's temporary streaming messages buffer once saved to MongoDB
      setMessages([]);
    },
  });

  // Clear AI SDK's temporary streaming messages when chat changes
  useEffect(() => {
    setMessages([]);
  }, [chatId, setMessages]);

  const isStreaming = status === "streaming" || status === "submitted";

  // While streaming, take only the active streaming assistant message from useAIChat
  // (avoiding re-injecting all old accumulated streaming messages)
  const activeStreamingMessages = isStreaming
    ? streamingMessages.map((msg) => ({
        ...ensureTimestamp(msg, messageTimestampsRef),
        model: msg.role === "assistant" ? modelRef.current : msg.model,
      }))
    : [];

  const messages = isStreaming
    ? deduplicateMessages([...formattedMessages, ...activeStreamingMessages])
    : formattedMessages;

  async function send({ id, content, fileIds = [], createdAt }) {
    const message = {
      id: id || crypto.randomUUID(),
      role: "user",
      parts: [{ type: "text", text: content }],
      createdAt: createdAt ?? Date.now(),
    };
    if (fileIds.length > 0) message.fileIds = fileIds;
    messageTimestampsRef.current.set(message.id, message.createdAt);
    await sendMessage(message);
  }

  return {
    messages,
    send,
    regenerate,
    stop,
    status,
    error,
    clearError,
    isStreaming,
  };
}
