import { useRef, useEffect, useState } from "react";
import { UI_CONSTANTS, ATTACHMENT_INPUT_ACCEPT, ATTACHMENT_TITLE_TEXT } from "@/shared";
import { Paperclip, Image, Globe, Send, Mic, MicOff, Square, BookOpen, Sparkles } from "lucide-react";
import ChatMemoryButton from "./ChatMemoryButton";
import { useFileUploader } from "@/hooks/useFileUploader";
import { useFileDragDrop } from "@/hooks/useFileDragDrop";
import { FilePreviewList } from "./FilePreviewList";
import { useUiState } from "@/state/useUiState";

const FILE_INPUT_ID = "chat-input-file-upload";

const SLASH_COMMANDS = [
  {
    command: "/knowledgebase",
    label: "Knowledge Base",
    description: "Search documents, manuals, and knowledge base",
    icon: BookOpen,
    badge: "RAG",
  },
  {
    command: "/agent",
    label: "Custom Agent",
    description: "Custom Agent Foundation multi-step reasoning with tools",
    icon: Sparkles,
    badge: "Custom",
  },
  {
    command: "/framework-agent",
    label: "LangGraph Agent",
    description: "LangGraph state-machine multi-step reasoning with tools",
    icon: Sparkles,
    badge: "LangGraph",
  },
];


const InputArea = ({
  input,
  setInput,
  handleInputChange,
  handleSubmit,
  disabled,
  voiceControls,
  onImageSubmit,
  webSearchEnabled,
  onToggleWebSearch,
  modelSupportsTools,
  chatId,
  selectedFiles,
  onFilesUploaded,
  onRemoveFile,
  isLoading,
  isGenerating,
  isSwitching = false,
  onStop,
}) => {
  const textareaRef = useRef(null);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedInput, setDismissedInput] = useState(null);
  const { uploadFiles, uploading, currentFile } = useFileUploader({
    onFilesUploaded,
    chatId,
  });
  const { dragActive, handleDrag, handleDrop } = useFileDragDrop((files) => uploadFiles(files));
  const imageMode = useUiState((state) => state.imageMode);
  const toggleImageMode = useUiState((state) => state.toggleImageMode);
  const setImageMode = useUiState((state) => state.setImageMode);
  const setWebSearchEnabled = useUiState((state) => state.setWebSearchEnabled);

  // Window-level drop guard: prevent browser from opening files dropped outside the input
  useEffect(() => {
    const preventFileDrop = (e) => {
      if (e.dataTransfer?.types?.includes("Files")) {
        e.preventDefault();
      }
    };
    window.addEventListener("dragover", preventFileDrop);
    window.addEventListener("drop", preventFileDrop);
    return () => {
      window.removeEventListener("dragover", preventFileDrop);
      window.removeEventListener("drop", preventFileDrop);
    };
  }, []);

  const handleToggleImageMode = () => {
    if (webSearchEnabled) {
      setWebSearchEnabled(false);
    }
    toggleImageMode();
  };

  const handleToggleWebSearch = () => {
    if (imageMode) {
      setImageMode(false);
    }
    onToggleWebSearch();
  };

  const adjustHeight = (element) => {
    element.style.height = "auto";
    element.style.height = `${Math.min(element.scrollHeight, UI_CONSTANTS.INPUT_MAX_HEIGHT)}px`;
  };

  const handleChange = (e) => {
    adjustHeight(e.target);
    handleInputChange(e);
  };

  const hasContent = input.trim() || selectedFiles.length > 0;

  const query = input.startsWith("/") && !input.includes(" ") ? input.slice(1).toLowerCase() : "";
  const filteredCommands =
    input.startsWith("/") && !input.includes(" ")
      ? SLASH_COMMANDS.filter(
          (cmd) =>
            cmd.command.toLowerCase().includes(query) ||
            cmd.label.toLowerCase().includes(query)
        )
      : [];

  const isSlashMenuOpen =
    input.startsWith("/") &&
    !input.includes(" ") &&
    filteredCommands.length > 0 &&
    dismissedInput !== input;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelectCommand = (cmd) => {
    const nextVal = `${cmd.command} `;
    if (setInput) {
      setInput(nextVal);
    } else {
      handleInputChange({ target: { value: nextVal } });
    }
    setDismissedInput(nextVal);
    if (textareaRef.current) {
      textareaRef.current.focus();
      setTimeout(() => {
        if (textareaRef.current) {
          adjustHeight(textareaRef.current);
        }
      }, 0);
    }
  };

  const handleKeyDown = (e) => {
    if (isSlashMenuOpen) {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev + 1) % filteredCommands.length);
        return;
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((prev) => (prev - 1 + filteredCommands.length) % filteredCommands.length);
        return;
      }
      if (e.key === "Enter" || e.key === "Tab") {
        e.preventDefault();
        if (filteredCommands[selectedIndex]) {
          handleSelectCommand(filteredCommands[selectedIndex]);
        }
        return;
      }
      if (e.key === "Escape") {
        e.preventDefault();
        setDismissedInput(input);
        return;
      }
    }

    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!disabled && hasContent) {
        handleFormSubmit(e);
      }
    }
  };

  const handleFormSubmit = (e) => {
    e.preventDefault();
    if (disabled) {
      return;
    }

    // Image mode: call onImageSubmit instead of normal handleSubmit
    if (imageMode && onImageSubmit) {
      onImageSubmit(input.trim());
      setImageMode(false); // Auto-reset after send
      if (textareaRef.current) {
        textareaRef.current.style.height = "auto";
      }
      return;
    }

    handleSubmit(e);

    // Reset textarea height when clearing input
    if (textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  };

  const handleFileChange = (e) => {
    uploadFiles(e.target.files);
    e.target.value = "";
  };

  const isSubmitDisabled = !hasContent || disabled;
  const loadingBorder = isLoading || isGenerating;

  return (
    <div
      className={`bg-theme-surface relative rounded-2xl border p-2 shadow-lg transition-colors duration-150 ${
        dragActive
          ? "border-theme-primary bg-theme-primary/5"
          : loadingBorder
            ? "border-theme-primary/30"
            : "border-theme-border hover:border-theme-primary/50"
      }`}
      onDragEnter={handleDrag}
      onDragLeave={handleDrag}
      onDragOver={handleDrag}
      onDrop={disabled || uploading ? undefined : handleDrop}>
      {dragActive && (
        <div className="bg-theme-surface/80 pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-2xl backdrop-blur-sm">
          <div className="text-theme-primary flex items-center gap-2">
            <Paperclip size={20} />
            <span className="text-sm font-medium">Drop files to attach</span>
          </div>
        </div>
      )}

      {/* Slash Command Autocomplete Dropdown */}
      {isSlashMenuOpen && (
        <div
          role="listbox"
          aria-label="Slash commands"
          className="bg-theme-surface/95 border-theme-border text-theme-text absolute bottom-full left-0 mb-3 w-full max-w-sm rounded-xl border p-1.5 shadow-2xl backdrop-blur-xl z-30 transition-all">
          <div className="text-theme-muted flex items-center justify-between px-2.5 py-1.5 text-xs font-semibold uppercase tracking-wider">
            <span>Commands</span>
            <span className="text-[10px] font-normal normal-case opacity-70">Tab or ↵ to select</span>
          </div>
          <div className="space-y-1">
            {filteredCommands.map((cmd, idx) => {
              const Icon = cmd.icon;
              const isSelected = idx === selectedIndex;
              return (
                <button
                  key={cmd.command}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  onMouseEnter={() => setSelectedIndex(idx)}
                  onClick={() => handleSelectCommand(cmd)}
                  className={`flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors duration-150 ${
                    isSelected
                      ? "bg-theme-primary/10 text-theme-primary"
                      : "hover:bg-theme-surface-strong/60 text-theme-text"
                  }`}>
                  <div
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${
                      isSelected
                        ? "bg-theme-primary/20 text-theme-primary"
                        : "bg-theme-surface-strong text-theme-muted"
                    }`}>
                    <Icon size={16} />
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col">
                    <div className="flex items-center gap-2">
                      <span className="font-mono text-sm font-semibold">{cmd.command}</span>
                      {cmd.badge && (
                        <span className="bg-theme-surface-strong text-theme-muted rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide">
                          {cmd.badge}
                        </span>
                      )}
                    </div>
                    <span className="text-theme-muted truncate text-xs">{cmd.description}</span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      <div className="flex w-full flex-col">
        <input
          id={FILE_INPUT_ID}
          type="file"
          multiple
          onChange={handleFileChange}
          disabled={disabled || uploading}
          className="sr-only"
          accept={ATTACHMENT_INPUT_ACCEPT}
        />

        {uploading && currentFile && (
          <div className="text-theme-text-muted mb-2 text-xs">Uploading {currentFile}...</div>
        )}

        {!imageMode && <FilePreviewList files={selectedFiles} onRemove={onRemoveFile} />}

        {/* Textarea - Top */}
        <textarea
          ref={textareaRef}
          value={input}
          onChange={handleChange}
          onKeyDown={handleKeyDown}
          placeholder={
            imageMode
              ? "Describe the image you want to generate..."
              : "Ask anything..."
          }
          aria-label="Message input"
          disabled={disabled}
          rows={1}
          className="text-theme-text placeholder-theme-muted max-h-[200px] w-full resize-none border-none bg-transparent px-4 py-3 text-base focus:ring-0 focus:outline-none"
        />

        {/* Bottom Row - Tool Buttons + Send */}
        <div className="flex items-center justify-between px-2 pb-1">
          {/* Tool Buttons - Left */}
          <div className="flex items-center gap-1">
            <label
              htmlFor={FILE_INPUT_ID}
              className={`rounded-lg p-2 transition-colors ${
                disabled || uploading
                  ? "text-theme-muted/40 cursor-not-allowed opacity-50"
                  : "text-theme-muted hover:text-theme-text hover:bg-theme-surface-strong/50 cursor-pointer"
              }`}
              title={ATTACHMENT_TITLE_TEXT}
              aria-label="Add attachment">
              <Paperclip size={18} />
            </label>
            <button
              type="button"
              onClick={handleToggleImageMode}
              className={`rounded-lg p-2 transition-colors ${
                imageMode
                  ? "bg-theme-pink/20 text-theme-pink"
                  : "text-theme-muted hover:bg-theme-pink/10 hover:text-theme-pink"
              }`}
              title={imageMode ? "Exit Image Mode" : "Generate Image"}
              aria-label={imageMode ? "Exit image mode" : "Generate image"}
              disabled={disabled}>
              <Image size={18} />
            </button>
            <button
              type="button"
              onClick={modelSupportsTools ? handleToggleWebSearch : undefined}
              className={`rounded-lg p-2 transition-colors ${
                !modelSupportsTools
                  ? "text-theme-muted/40 cursor-not-allowed opacity-50"
                  : webSearchEnabled
                    ? "bg-theme-green/20 text-theme-green"
                    : "text-theme-muted hover:bg-theme-green/10 hover:text-theme-green"
              }`}
              title={
                !modelSupportsTools
                  ? "This model doesn't support web search"
                  : webSearchEnabled
                    ? "Disable Web Search"
                    : "Search Web"
              }
              aria-label={
                !modelSupportsTools
                  ? "This model doesn't support web search"
                  : webSearchEnabled
                    ? "Disable web search"
                    : "Search web"
              }
              aria-pressed={webSearchEnabled}
              disabled={disabled || !modelSupportsTools}>
              <Globe size={18} />
            </button>
            <ChatMemoryButton chatId={chatId} disabled={disabled} />

            {/* Voice Control Button */}
            {voiceControls && (
              <button
                type="button"
                onClick={voiceControls.isSupported ? voiceControls.toggleConversation : undefined}
                className={`rounded-lg p-2 transition-colors ${
                  !voiceControls.isSupported
                    ? "text-theme-muted/40 cursor-not-allowed opacity-50"
                    : voiceControls.isActive
                      ? "bg-theme-red/20 text-theme-red hover:bg-theme-red/30 animate-pulse"
                      : "text-theme-muted hover:bg-theme-blue/10 hover:text-theme-blue"
                }`}
                title={
                  !voiceControls.isSupported
                    ? "Voice not supported in this browser"
                    : voiceControls.isActive
                      ? "Voice Active - Click to Stop"
                      : "Click to Start Voice Chat"
                }
                aria-label={
                  !voiceControls.isSupported
                    ? "Voice not supported in this browser"
                    : voiceControls.isActive
                      ? "Voice Active - Click to Stop"
                      : "Click to Start Voice Chat"
                }
                disabled={disabled || !voiceControls.isSupported}>
                {voiceControls.isActive ? <MicOff size={18} /> : <Mic size={18} />}
              </button>
            )}
          </div>

          {/* Action Button - Right: Stop button while busy, Send button otherwise */}
          {(isLoading || isGenerating) && onStop ? (
            <button
              onClick={onStop}
              type="button"
              aria-label="Stop generating"
              title="Stop generating"
              className="border-theme-red/40 bg-theme-red/15 text-theme-red hover:bg-theme-red hover:text-white rounded-xl border p-2 shadow-sm transition-all duration-200 hover:scale-105 active:scale-95">
              <Square size={18} className="fill-current" />
            </button>
          ) : (
            <button
              onClick={handleFormSubmit}
              disabled={isSubmitDisabled}
              type="button"
              aria-label="Send message"
              title="Send message"
              className={`rounded-xl p-2 transition-all duration-200 ${
                isSubmitDisabled
                  ? "bg-theme-surface-strong text-theme-muted cursor-not-allowed"
                  : "bg-theme-primary hover:bg-theme-accent text-white shadow-sm hover:scale-105 active:scale-95"
              }`}>
              <Send size={18} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
};

export default InputArea;
