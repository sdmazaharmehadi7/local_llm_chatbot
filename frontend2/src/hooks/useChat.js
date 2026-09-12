import { extractTextContent } from "@/lib/messageUtils";
import { useState, useRef, useCallback } from "react";
import { toast } from "sonner";
import { apiFetch, API_BASE } from "@/lib/api";
import { useChatPersistence } from "./useChatPersistence";
import { useChatStream } from "./useChatStream";

function formatControlledErrorMessage(err) {
  const msg = (err?.message || "").toLowerCase();
  const status = err?.status;

  if (
    msg.includes("ollama is not running") ||
    msg.includes("start ollama manually") ||
    msg.includes("failed to communicate with qwen3")
  ) {
    return "Agent brain is unavailable. Please ensure Ollama is running (`ollama serve`).";
  }
  if (
    status === 503 ||
    status === 502 ||
    msg.includes("unreachable") ||
    msg.includes("failed to fetch") ||
    msg.includes("econnrefused")
  ) {
    return "Agent service is currently unavailable. Please ensure the backend server is running.";
  }
  if (
    msg.includes("maximum allowed steps") ||
    msg.includes("maximum steps reached") ||
    msg.includes("step limit exceeded")
  ) {
    return "Agent reached the maximum execution step limit and stopped safely.";
  }
  if (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("time limit exceeded")
  ) {
    return "Agent task timed out. The operation exceeded the execution time limit.";
  }
  if (
    msg.includes("tool") &&
    (msg.includes("fail") ||
      msg.includes("error in tool") ||
      msg.includes("execution failure"))
  ) {
    return `Agent stopped: a tool execution failed during the workflow (${err.message}).`;
  }
  if (
    status === 400 ||
    msg.includes("invalid agent request") ||
    msg.includes("task message is required")
  ) {
    return "Invalid agent request. Please provide a clear task description.";
  }
  return `Agent task could not be completed: ${err.message || "Unknown error"}`;
}

function createStepUpdater(setAgentStatus) {
  let eventsList = [];
  let stepsList = [];

  return (evt) => {
    const statusType = evt.status || evt.type;
    const reason = evt.reason || null;
    const messageText =
      evt.message ||
      (statusType === "planning" || statusType === "agent_start"
        ? "Analysing the question..."
        : statusType === "tool" || statusType === "tool_start"
        ? (evt.tool === "retrieve_information"
            ? "🔧 Searching knowledge base..."
            : evt.tool === "calculator"
            ? "🔧 Calling calculator..."
            : evt.tool === "text_transform"
            ? "🔧 Transforming text..."
            : `🔧 Using ${evt.tool || "tool"}...`)
        : statusType === "tool_complete" || statusType === "tool_result"
        ? "✓ Tool completed"
        : statusType === "analyzing"
        ? "Analysing result..."
        : statusType === "preparing_answer"
        ? "Generating the response..."
        : statusType === "completed"
        ? "Response ready"
        : "Working...");

    const isTool = statusType === "tool" || statusType === "tool_start";
    const isComplete = statusType === "tool_complete" || statusType === "tool_result";

    const trimmedMsg = messageText.trim().toLowerCase();
    const lastEvent = eventsList[eventsList.length - 1];
    const isDuplicate =
      lastEvent &&
      (lastEvent.message.trim().toLowerCase() === trimmedMsg ||
       (trimmedMsg.startsWith("analys") && lastEvent.message.trim().toLowerCase().startsWith("analys")));

    if (isDuplicate) {
      lastEvent.status = statusType;
      lastEvent.message = messageText;
      if (evt.tool) lastEvent.tool = evt.tool;
      if (reason) lastEvent.reason = reason;
    } else {
      eventsList.push({
        id: `${Date.now()}-${Math.random()}`,
        status: statusType,
        message: messageText,
        tool: evt.tool || null,
        isTool,
        isComplete,
        reason,
      });
    }

    if (statusType === "planning" || statusType === "agent_start") {
      stepsList = [{ label: "Planning...", reason, status: "running" }];
    } else if (isTool) {
      stepsList = stepsList.map((s) => ({ ...s, status: "completed" }));
      stepsList.push({ label: messageText, tool: evt.tool, reason, status: "running" });
    } else if (isComplete) {
      if (stepsList.length > 0) {
        stepsList[stepsList.length - 1].status = "completed";
      }
    } else if (statusType === "preparing_answer") {
      stepsList = stepsList.map((s) => ({ ...s, status: "completed" }));
    }

    setAgentStatus({
      status: statusType,
      text: messageText,
      currentMessage: messageText,
      tool: evt.tool || null,
      reason: reason,
      events: [...eventsList],
      steps: [...stepsList],
    });
  };
}

export function useChat({ id: chatId, model, webSearchEnabled, memoryEnabled }) {
  const [input, setInput] = useState("");
  const [inputFiles, setInputFiles] = useState([]);
  const [isAgentWorking, setIsAgentWorking] = useState(false);
  const [agentStatus, setAgentStatus] = useState(null);
  const [streamingAgentMessage, setStreamingAgentMessage] = useState(null);
  const agentAbortControllerRef = useRef(null);

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

    // Check for explicit /agent or /framework-agent / /langgraph trigger
    const isAgentTrigger = /^\/(?:agent|framework-agent|agent-framework|langgraph)(?:\s+|$)/i.test(trimmedContent);

    if (isAgentTrigger) {
      const agentTask = trimmedContent.replace(/^\/(?:agent|framework-agent|agent-framework|langgraph)\s*/i, "").trim();

      if (!agentTask) {
        toast.error("Please provide a task for the agent. Example: /agent Calculate 25 * 40");
        return;
      }

      const messageId = crypto.randomUUID();
      const createdAt = Date.now();
      setInput("");
      setInputFiles([]);
      stream.clearError();

      const assistantMessageId = crypto.randomUUID();
      let accumulatedAnswer = "";
      const abortController = new AbortController();
      agentAbortControllerRef.current = abortController;

      try {
        // Save user message immediately
        await saveUserMessage(
          { id: messageId, content: trimmedContent, fileIds, createdAt, model: "agent" },
          chatId
        );

        setStreamingAgentMessage({
          id: assistantMessageId,
          role: "assistant",
          model: "agent",
          content: "",
          createdAt: Date.now(),
        });
        setIsAgentWorking(true);
        const updateStatus = createStepUpdater(setAgentStatus);
        updateStatus({
          status: "planning",
          message: "Analysing your question...",
        });

        let agentResult = null;
        const targetUrl = API_BASE ? `${API_BASE}/api/agent/tasks` : "/api/agent/tasks";


        try {
          const response = await fetch(targetUrl, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "text/event-stream, application/json",
            },
            credentials: "include",
            signal: abortController.signal,
            body: JSON.stringify({
              message: agentTask,
              chatId,
              fileIds,
              stream: true,
            }),
          });

          if (!response.ok) {
            const errData = await response.json().catch(() => null);
            const error = new Error(errData?.error || `Agent service error (${response.status})`);
            error.status = response.status;
            throw error;
          }

          const contentType = response.headers.get("content-type") || "";
          if (contentType.includes("text/event-stream") && response.body) {
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let buffer = "";
            let currentEventName = "message";

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop() ?? "";

              for (const line of lines) {
                const trimmed = line.trim();
                if (!trimmed) {
                  currentEventName = "message";
                  continue;
                }
                if (trimmed.startsWith("event: ")) {
                  currentEventName = trimmed.slice(7).trim();
                  continue;
                }
                if (trimmed.startsWith("data: ")) {
                  try {
                    const evt = JSON.parse(trimmed.slice(6));
                    const eventType = evt.type || currentEventName;

                    if (
                      eventType === "agent_start" ||
                      eventType === "reasoning" ||
                      eventType === "agent_status"
                    ) {
                      updateStatus(evt);
                      if (evt.status === "error") {
                        throw new Error(evt.error || "Agent execution failed");
                      }
                    } else if (eventType === "tool_start" || eventType === "tool") {
                      updateStatus({ ...evt, status: "tool" });
                    } else if (eventType === "tool_result" || eventType === "tool_complete") {
                      updateStatus({ ...evt, status: "tool_complete" });
                    } else if (eventType === "answer_chunk") {
                      const textChunk = evt.text || "";
                      if (textChunk) {
                        accumulatedAnswer += textChunk;
                        setStreamingAgentMessage({
                          id: assistantMessageId,
                          role: "assistant",
                          model: "agent",
                          content: accumulatedAnswer,
                          createdAt: Date.now(),
                        });
                      }
                    } else if (eventType === "agent_complete" || eventType === "agent_result") {
                      agentResult = evt;
                    } else if (eventType === "error") {
                      throw new Error(evt.message || evt.error || "Agent execution failed");
                    }
                  } catch (pErr) {
                    if (pErr.message && !pErr.message.includes("JSON")) {
                      throw pErr;
                    }
                  }
                }
              }
            }
          } else {
            agentResult = await response.json();
          }
        } catch (fetchErr) {
          throw fetchErr;
        }

        if (agentResult && agentResult.success === false && agentResult.error) {
          throw new Error(agentResult.error);
        }

        const responseText =
          accumulatedAnswer.trim() ||
          agentResult?.response ||
          (agentResult?.success ? "Task completed." : (agentResult?.error || "Agent task completed."));

        await saveAssistantMessage(
          {
            id: assistantMessageId,
            content: responseText,
            model: "agent",
            metadata:
              agentResult?.steps?.length > 0 || agentResult?.sources?.length > 0
                ? {
                    steps: agentResult?.steps || [],
                    taskId: agentResult?.taskId,
                    ragSources: agentResult?.sources || agentResult?.ragSources || [],
                    sources: agentResult?.sources || agentResult?.ragSources || [],
                  }
                : null,
            createdAt: Date.now(),
          },
          chatId
        );
      } catch (err) {
        if (err.name === "AbortError" || abortController.signal.aborted) {
          console.log("[useChat] Agent execution stopped by user.");
          const responseText = accumulatedAnswer.trim()
            ? `${accumulatedAnswer.trim()}\n\n*(Stopped by user)*`
            : "Agent task stopped.";
          await saveAssistantMessage(
            {
              id: assistantMessageId,
              content: responseText,
              model: "agent",
              createdAt: Date.now(),
            },
            chatId
          );
          return;
        }

        console.error("[useChat] Agent execution error:", err);
        const controlledMessage = formatControlledErrorMessage(err);
        await saveAssistantMessage(
          {
            id: assistantMessageId,
            content: controlledMessage,
            model: "agent",
            createdAt: Date.now(),
          },
          chatId
        );
        toast.error(controlledMessage);
      } finally {
        agentAbortControllerRef.current = null;
        setIsAgentWorking(false);
        setStreamingAgentMessage(null);
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

  const handleStop = useCallback(() => {
    if (agentAbortControllerRef.current) {
      agentAbortControllerRef.current.abort();
      agentAbortControllerRef.current = null;
    }
    if (stream.isStreaming) {
      stream.stop();
    }
    setIsAgentWorking(false);
    setStreamingAgentMessage(null);
    setAgentStatus(null);
  }, [stream]);

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
    streamingAgentMessage,
    isChatError,
    error: stream.error,
    clearError: stream.clearError,
    currentChat: chat,
    stop: handleStop,
    regenerate: stream.isStreaming ? undefined : stream.regenerate,
    status: stream.status,
  };
}
