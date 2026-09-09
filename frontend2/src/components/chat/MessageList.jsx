import MessageItem from "./MessageItem";
import { getMessageTimestamp } from "@/lib/messageUtils";
import { MESSAGE_CONSTANTS } from "@/shared";
import { ImageIcon } from "lucide-react";

function sortMessagesWithUserFirst(messages) {
  return [...messages].sort((a, b) => {
    const aTime = getMessageTimestamp(a, 0);
    const bTime = getMessageTimestamp(b, 0);

    if (aTime !== bTime) {
      return aTime - bTime;
    }

    // Stable tie-breaker: if identical timestamp, user question comes before assistant answer
    if (a.role === "user" && b.role === "assistant") return -1;
    if (a.role === "assistant" && b.role === "user") return 1;
    return 0;
  });
}

function getMessageActions(isActive, status, onStop, onRegenerate) {
  const isStreaming = status === "streaming" || status === "submitted";
  return {
    stop: isActive && isStreaming && onStop ? onStop : undefined,
    regenerate: isActive && !isStreaming && onRegenerate ? onRegenerate : undefined,
  };
}

const ImageGeneratingSkeleton = () => (
  <div className="flex gap-3">
    <div className="bg-theme-pink/20 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg">
      <ImageIcon className="text-theme-pink h-4 w-4" />
    </div>
    <div className="flex-1">
      <div className="bg-theme-surface-strong mb-2 h-4 w-32 animate-pulse rounded" />
      <div className="border-theme-surface-strong bg-theme-surface relative aspect-square w-64 overflow-hidden rounded-xl border">
        <div className="bg-theme-surface-strong/50 absolute inset-0 animate-pulse" />
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
          <div className="relative">
            <div className="bg-theme-pink/20 h-12 w-12 animate-pulse rounded-full" />
            <ImageIcon className="text-theme-pink/50 absolute inset-0 m-auto h-6 w-6" />
          </div>
          <div className="text-theme-text-muted text-sm">Generating image...</div>
          <div className="flex gap-1">
            <span className="bg-theme-pink h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.3s]" />
            <span className="bg-theme-pink h-1.5 w-1.5 animate-bounce rounded-full [animation-delay:-0.15s]" />
            <span className="bg-theme-pink h-1.5 w-1.5 animate-bounce rounded-full" />
          </div>
        </div>
      </div>
    </div>
  </div>
);

const EmptyState = () => (
  <div className="flex h-full items-center justify-center py-32">
    <p className="text-theme-text-muted text-lg">Start a conversation</p>
  </div>
);

const MessageList = ({
  messages,
  isLoading,
  isGeneratingImage,
  isAgentWorking,
  agentStatus,
  status,
  onStop,
  onRegenerate,
  activeModelName,
}) => {
  const sortedMessages = sortMessagesWithUserFirst(messages);
  const lastAssistantId = sortedMessages.findLast((msg) => msg.role === "assistant")?.id;
  const isEmpty = messages.length === 0 && !isLoading && !isGeneratingImage && !isAgentWorking;

  if (isEmpty) {
    return <EmptyState />;
  }

  return (
    <div className="space-y-4" aria-live="polite">
      {sortedMessages.map((message) => {
        const isActiveAssistant = message.id === lastAssistantId && message.role === "assistant";
        const actions = getMessageActions(isActiveAssistant, status, onStop, onRegenerate);

        return (
          <MessageItem
            key={message.id}
            message={message}
            onStop={actions.stop}
            onRegenerate={actions.regenerate}
            isStreaming={isActiveAssistant && (status === "streaming" || status === "submitted")}
          />
        );
      })}
      {isAgentWorking && (
        <div className="flex gap-3 py-2 animate-fadeIn">
          <div className="bg-theme-mauve/15 text-theme-mauve flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-base shadow-sm md:h-9 md:w-9">
            🤖
          </div>
          <div className="bg-theme-surface/90 border-theme-border/60 max-w-md flex-1 rounded-xl border p-3.5 shadow-sm">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2 text-sm font-semibold text-theme-text">
                <span className="relative flex h-2 w-2">
                  <span className="bg-theme-mauve absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"></span>
                  <span className="bg-theme-mauve relative inline-flex h-2 w-2 rounded-full"></span>
                </span>
                <span>🤖 Agent working</span>
              </div>
              <span className="text-[11px] font-medium text-theme-text-muted bg-theme-surface/80 border border-theme-border/40 rounded px-2 py-0.5">
                {typeof agentStatus === "object"
                  ? agentStatus?.text || "Working..."
                  : agentStatus || "Planning..."}
              </span>
            </div>

            {/* Completed / Current steps list if provided */}
            {typeof agentStatus === "object" && Array.isArray(agentStatus?.steps) && agentStatus.steps.length > 0 ? (
              <div className="mt-2.5 space-y-1 border-t border-theme-border/30 pt-2 text-xs">
                {agentStatus.steps.map((step, idx) => {
                  const isDone = step.status === "completed";
                  const isRunning = step.status === "running";
                  return (
                    <div
                      key={idx}
                      className={`flex items-center justify-between rounded px-2 py-1 transition-colors ${
                        isRunning ? "bg-theme-surface border border-theme-mauve/30 text-theme-text" : "text-theme-text-muted"
                      }`}>
                      <div className="flex items-center gap-2">
                        {isDone ? (
                          <span className="text-theme-green font-bold">✓</span>
                        ) : isRunning ? (
                          <span className="relative flex h-1.5 w-1.5">
                            <span className="bg-theme-mauve absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"></span>
                            <span className="bg-theme-mauve relative inline-flex h-1.5 w-1.5 rounded-full"></span>
                          </span>
                        ) : (
                          <span className="opacity-40">•</span>
                        )}
                        <span className={isRunning ? "font-medium text-theme-text" : ""}>
                          {step.label}
                        </span>
                      </div>
                      {isRunning && (
                        <span className="text-[10px] text-theme-mauve animate-pulse font-medium">
                          Active
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mt-2 flex items-center gap-1.5 text-xs text-theme-text-muted">
                <span>{typeof agentStatus === "string" ? agentStatus : "Planning → Executing tool → Preparing answer"}</span>
              </div>
            )}
          </div>
        </div>
      )}
      {isLoading && !isAgentWorking && (!lastAssistantId || sortedMessages[sortedMessages.length - 1]?.role === "user") && (
        <div className="flex items-center gap-2.5 py-2 px-1 text-sm text-theme-text-muted animate-pulse">
          <span className="relative flex h-2.5 w-2.5">
            <span className="bg-theme-primary absolute inline-flex h-full w-full transform-gpu animate-ping rounded-full opacity-75"></span>
            <span className="bg-theme-primary relative inline-flex h-2.5 w-2.5 rounded-full"></span>
          </span>
          <span>Loading {activeModelName || "model"}...</span>
        </div>
      )}
      {isGeneratingImage && <ImageGeneratingSkeleton />}
    </div>
  );
};

export default MessageList;
