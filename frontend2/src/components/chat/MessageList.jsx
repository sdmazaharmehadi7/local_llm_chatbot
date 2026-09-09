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
        <div className="flex gap-4 py-2">
          <div className="bg-theme-mauve/20 text-theme-mauve flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-xl text-base shadow-sm md:h-10 md:w-10">
            🤖
          </div>
          <div className="bg-theme-surface/90 border-theme-border/60 max-w-md flex-1 rounded-xl border p-3.5 shadow-sm">
            <div className="flex items-center gap-2 text-sm font-semibold text-theme-text">
              <span className="relative flex h-2 w-2">
                <span className="bg-theme-mauve absolute inline-flex h-full w-full animate-ping rounded-full opacity-75"></span>
                <span className="bg-theme-mauve relative inline-flex h-2 w-2 rounded-full"></span>
              </span>
              <span>Agent working...</span>
            </div>
            <div className="mt-1.5 flex items-center gap-1.5 text-xs text-theme-text-muted">
              <span>Planning</span>
              <span>→</span>
              <span>Executing tool</span>
              <span>→</span>
              <span>Preparing answer</span>
            </div>
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
