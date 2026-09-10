import MessageItem from "./MessageItem";
import AgentLiveStatusStream from "./AgentLiveStatusStream";
import { MarkdownContent } from "@/components/markdown/MarkdownRenderer";
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
  streamingAgentMessage,
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
        <div className="flex gap-4 py-3 px-2 sm:px-4 animate-fadeIn">
          {/* Normal compact assistant avatar */}
          <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-theme-surface border border-theme-border/50 text-base shadow-xs">
            🤖
          </div>
          {/* Normal chat response area with lightweight scrolling text stream */}
          <div className="flex-1 min-w-0 pt-0.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-bold text-theme-text">Sovereign Agent</span>
              {onStop && (
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop agent execution"
                  title="Stop agent execution"
                  className="border-theme-border/60 text-theme-red hover:bg-theme-red/10 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors cursor-pointer">
                  Stop
                </button>
              )}
            </div>
            <AgentLiveStatusStream
              events={agentStatus?.events || []}
              currentMessage={agentStatus?.currentMessage || agentStatus?.text || "Analysing your question..."}
            />
            {streamingAgentMessage?.content ? (
              <div className="mt-3 text-theme-text leading-relaxed">
                <MarkdownContent content={streamingAgentMessage.content} />
                <span className="inline-block h-3.5 w-1.5 bg-theme-mauve animate-pulse ml-0.5 align-middle" />
              </div>
            ) : null}
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
