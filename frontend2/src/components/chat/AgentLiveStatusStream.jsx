import React, { useEffect, useRef } from "react";

/**
 * Lightweight scrolling text stream for live agent execution.
 * Displays sequential status messages with subtle typing/blinking effect
 * and auto-scrolls upward as new events arrive.
 */
export default function AgentLiveStatusStream({ events = [], currentMessage }) {
  const scrollRef = useRef(null);

  // Automatically scroll upward as new events arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, currentMessage]);

  const filteredEvents = [];
  for (const evt of (Array.isArray(events) ? events : [])) {
    const last = filteredEvents[filteredEvents.length - 1];
    if (last && last.message?.trim().toLowerCase() === evt.message?.trim().toLowerCase()) {
      continue;
    }
    filteredEvents.push(evt);
  }

  const displayEvents =
    filteredEvents.length > 0
      ? filteredEvents
      : [
          {
            id: "init",
            message: currentMessage || "Analysing the question...",
            isTool: false,
          },
        ];

  return (
    <div className="w-full max-w-lg">
      <div
        ref={scrollRef}
        className="max-h-32 overflow-y-auto pr-2 space-y-1 font-mono text-xs scroll-smooth transition-all duration-150">
        {displayEvents.map((evt, idx) => {
          const isLatest = idx === displayEvents.length - 1;
          const isTool = evt.isTool || evt.status === "tool" || (evt.message && evt.message.startsWith("🔧"));
          const isComplete = evt.isComplete || evt.status === "tool_complete" || (evt.message && evt.message.startsWith("✓"));

          return (
            <div
              key={evt.id || idx}
              className={`flex items-center gap-1.5 leading-relaxed transition-opacity duration-200 ${
                isComplete
                  ? "text-theme-green"
                  : isTool
                  ? "text-theme-mauve font-medium"
                  : isLatest
                  ? "text-theme-text"
                  : "text-theme-text-muted opacity-75"
              }`}>
              <span>{evt.message}</span>
              {isLatest && (
                <span className="inline-block h-2.5 w-1 bg-theme-mauve animate-pulse ml-0.5 align-middle" />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
