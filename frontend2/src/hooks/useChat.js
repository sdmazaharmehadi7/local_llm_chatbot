import { extractTextContent } from "@/lib/messageUtils";
import { useState } from "react";
import { toast } from "sonner";
import { apiFetch, API_BASE } from "@/lib/api";
import { useChatPersistence } from "./useChatPersistence";
import { useChatStream } from "./useChatStream";

function formatControlledErrorMessage(err) {
  const msg = (err?.message || "").toLowerCase();
  const status = err?.status;

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
  let stepsList = [];

  return (evt) => {
    let currentText = "Planning...";
    const statusType = evt.status;

    if (statusType === "planning") {
      currentText = "Planning...";
      stepsList = [{ label: "Planning...", status: "running" }];
    } else if (statusType === "tool") {
      const toolLabel = evt.tool ? `Using tool: ${evt.tool}` : "Executing tool...";
      currentText = toolLabel;
      stepsList = stepsList.map((s) => ({ ...s, status: "completed" }));
      stepsList.push({ label: toolLabel, status: "running" });
    } else if (statusType === "analyzing") {
      currentText = "Analyzing result...";
      stepsList = stepsList.map((s) => ({ ...s, status: "completed" }));
      stepsList.push({ label: "Analyzing result...", status: "running" });
    } else if (statusType === "preparing_answer") {
      currentText = "Preparing final answer...";
      stepsList = stepsList.map((s) => ({ ...s, status: "completed" }));
      stepsList.push({ label: "Preparing final answer...", status: "running" });
    } else if (statusType === "completed") {
      currentText = "Completed";
      stepsList = stepsList.map((s) => ({ ...s, status: "completed" }));
    }

    setAgentStatus({
      status: statusType,
      text: currentText,
      tool: evt.tool || null,
      steps: [...stepsList],
    });
  };
}

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
        const updateStatus = createStepUpdater(setAgentStatus);
        updateStatus({ status: "planning" });

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
            body: JSON.stringify({
              message: agentTask,
              chatId,
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

            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buffer += decoder.decode(value, { stream: true });
              const lines = buffer.split("\n");
              buffer = lines.pop();

              for (const line of lines) {
                const trimmed = line.trim();
                if (trimmed.startsWith("data: ")) {
                  try {
                    const evt = JSON.parse(trimmed.slice(6));
                    if (evt.type === "agent_status") {
                      updateStatus(evt);
                      if (evt.status === "error") {
                        throw new Error(evt.error || "Agent execution failed");
                      }
                    } else if (evt.type === "agent_result") {
                      agentResult = evt;
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

        const assistantMessageId = crypto.randomUUID();
        const responseText =
          agentResult?.response ||
          (agentResult?.success ? "Task completed." : (agentResult?.error || "Agent task completed."));

        await saveAssistantMessage(
          {
            id: assistantMessageId,
            content: responseText,
            model: "agent",
            metadata:
              agentResult?.steps?.length > 0
                ? { steps: agentResult.steps, taskId: agentResult.taskId }
                : null,
            createdAt: Date.now(),
          },
          chatId
        );
      } catch (err) {
        console.error("[useChat] Agent execution error:", err);
        const controlledMessage = formatControlledErrorMessage(err);
        const assistantMessageId = crypto.randomUUID();
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
