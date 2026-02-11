"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { motion, AnimatePresence, useAnimate } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ChatMessage, Persona } from "@/types";
import { PERSONA_INFO } from "@/types";

const ALL_PERSONAS: Persona[] = ["thinking-partner", "interviewer", "synthesizer"];

// Format timestamp with smart date display
function formatMessageTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();

  const time = date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });

  // Check if same day
  const isToday = date.toDateString() === now.toDateString();
  if (isToday) {
    return time;
  }

  // Check if yesterday
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const isYesterday = date.toDateString() === yesterday.toDateString();
  if (isYesterday) {
    return `Yesterday, ${time}`;
  }

  // Check if same year
  const isSameYear = date.getFullYear() === now.getFullYear();
  if (isSameYear) {
    const dateStr = date.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    });
    return `${dateStr}, ${time}`;
  }

  // Different year - show full date
  const dateStr = date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
  return `${dateStr}, ${time}`;
}

interface ChatSidebarProps {
  messages: ChatMessage[];
  conversationId?: string;
  onSendMessage: (message: string) => void;
  onRetryMessage?: (userMessageId: string) => void;
  isLoading?: boolean;
  highlightedMessageId?: string | null;
  persona?: Persona;
  onChangePersona?: (persona: Persona) => void;
  // Branch-related props
  isBranch?: boolean;
  branchChangeCount?: number;
  isBranchMerged?: boolean;
  onMergeBranch?: () => void;
  // Time travel or sample mode
  readOnly?: boolean;
  // Distinguishes sample ledger from time travel
  isSampleLedger?: boolean;
  // Branch from message
  onBranchFromMessage?: (messageId: string) => void;
}

const springConfig = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
};

export function ChatSidebar({
  messages,
  conversationId,
  onSendMessage,
  onRetryMessage,
  isLoading,
  highlightedMessageId,
  persona = "thinking-partner",
  onChangePersona,
  isBranch = false,
  branchChangeCount = 0,
  isBranchMerged = false,
  onMergeBranch,
  readOnly = false,
  isSampleLedger = false,
  onBranchFromMessage,
}: ChatSidebarProps) {
  const [input, setInput] = useState("");
  const [showPersonaDropdown, setShowPersonaDropdown] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Detect conversation switches to suppress mount animations
  const prevConversationIdRef = useRef(conversationId);
  const isConversationSwitch = prevConversationIdRef.current !== conversationId;
  useEffect(() => {
    prevConversationIdRef.current = conversationId;
  });

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setShowPersonaDropdown(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const handleSelectPersona = useCallback(
    (newPersona: Persona) => {
      if (onChangePersona && newPersona !== persona) {
        onChangePersona(newPersona);
      }
      setShowPersonaDropdown(false);
    },
    [onChangePersona, persona]
  );

  // Auto-scroll to bottom on new messages (instant on conversation switch)
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView(
      isConversationSwitch ? { behavior: "instant" } : { behavior: "smooth" }
    );
  }, [messages, isConversationSwitch]);

  // Scroll to highlighted message when it changes
  useEffect(() => {
    if (highlightedMessageId) {
      // Use data attribute to find element directly instead of refs Map
      const element = document.querySelector(`[data-message-id="${highlightedMessageId}"]`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "center" });
      }
    }
  }, [highlightedMessageId]);

  // Auto-resize textarea
  useEffect(() => {
    if (inputRef.current) {
      inputRef.current.style.height = "auto";
      inputRef.current.style.height = `${Math.min(inputRef.current.scrollHeight, 120)}px`;
    }
  }, [input]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || isLoading) return;

    onSendMessage(input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  // Compute which user messages have error responses (for showing retry button)
  const failedMessageIds = useMemo(() => {
    const failed = new Set<string>();
    messages.forEach((msg) => {
      if (msg.isError && msg.parentId) {
        failed.add(msg.parentId);
      }
    });
    return failed;
  }, [messages]);

  return (
    <div className="flex-1 bg-corvus-surface flex flex-col min-h-0">
      {/* Header */}
      <div className="p-4 border-b border-corvus-border">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-corvus-text flex items-center gap-2">
            <span className="text-2xl">🐦‍⬛</span>
            Huginn
          </h2>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => onChangePersona && setShowPersonaDropdown(!showPersonaDropdown)}
              disabled={!onChangePersona}
              className={`
                px-2 py-0.5 text-xs font-medium bg-corvus-accent/20 text-corvus-accent rounded-full
                flex items-center gap-1
                ${onChangePersona ? "hover:bg-corvus-accent/30 cursor-pointer" : "cursor-default"}
                transition-colors
              `}
            >
              {PERSONA_INFO[persona].label}
              {onChangePersona && (
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              )}
            </button>
            <AnimatePresence>
              {showPersonaDropdown && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.15 }}
                  className="absolute right-0 top-full mt-1 w-56 bg-corvus-surface border border-corvus-border rounded-lg shadow-lg z-50 overflow-hidden"
                >
                  {ALL_PERSONAS.map((p) => (
                    <button
                      key={p}
                      onClick={() => handleSelectPersona(p)}
                      className={`
                        w-full px-3 py-2 text-left transition-colors
                        ${p === persona ? "bg-corvus-accent/20" : "hover:bg-corvus-border/50"}
                      `}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-corvus-text">
                          {PERSONA_INFO[p].label}
                        </span>
                        {p === persona && (
                          <svg
                            width="14"
                            height="14"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            className="text-corvus-accent"
                          >
                            <polyline points="20 6 9 17 4 12" />
                          </svg>
                        )}
                      </div>
                      <p className="text-xs text-corvus-muted mt-0.5">
                        {PERSONA_INFO[p].description}
                      </p>
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>
        <p className="text-xs text-corvus-muted mt-1">{PERSONA_INFO[persona].description}</p>

        {/* Branch merge badge */}
        {isBranch && (
          <div className="mt-2">
            {isBranchMerged ? (
              <div className="flex items-center gap-2 px-3 py-2 bg-corvus-border/30 rounded-lg">
                <MergeIcon className="text-green-400" />
                <span className="text-xs text-corvus-muted">
                  Branch merged — this conversation is read-only
                </span>
              </div>
            ) : (
              <button
                onClick={onMergeBranch}
                disabled={branchChangeCount === 0}
                className={`
                  flex items-center gap-2 px-3 py-2 rounded-lg transition-colors w-full
                  ${
                    branchChangeCount > 0
                      ? "bg-amber-500/20 hover:bg-amber-500/30 text-amber-400 cursor-pointer"
                      : "bg-corvus-border/30 text-corvus-muted cursor-not-allowed"
                  }
                `}
                title={branchChangeCount === 0 ? "No changes to merge" : "Merge changes to main"}
              >
                <MergeIcon
                  className={branchChangeCount > 0 ? "text-amber-400" : "text-corvus-muted"}
                />
                <div className="text-left">
                  <div className="text-xs font-medium">
                    {branchChangeCount > 0
                      ? `(${branchChangeCount}) change${branchChangeCount !== 1 ? "s" : ""}`
                      : "No changes"}
                  </div>
                  <div className="text-[10px] opacity-70">
                    {branchChangeCount > 0 ? "Merge to main" : "Make changes to enable merge"}
                  </div>
                </div>
              </button>
            )}
          </div>
        )}
      </div>

      {/* Messages */}
      <div key={conversationId} className="flex-1 overflow-y-auto p-4 space-y-4">
        <AnimatePresence mode="sync" initial={false}>
          {messages.map((message, index) => {
            // Context window is 25 messages - show divider at the boundary
            const contextCutoff = messages.length - 25;
            const isFirstInContext = index === contextCutoff && contextCutoff > 0;

            return (
              <div key={message.id}>
                {isFirstInContext && <ContextDivider />}
                <ChatBubble
                  message={message}
                  isHighlighted={message.id === highlightedMessageId}
                  hasErrorResponse={failedMessageIds.has(message.id)}
                  onRetry={onRetryMessage ? () => onRetryMessage(message.id) : undefined}
                  isRetrying={isLoading && failedMessageIds.has(message.id)}
                  skipEntryAnimation={isConversationSwitch}
                  onBranchFromMessage={
                    !readOnly && !isBranchMerged && onBranchFromMessage
                      ? () => onBranchFromMessage(message.id)
                      : undefined
                  }
                />
              </div>
            );
          })}
        </AnimatePresence>

        {isLoading && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="flex items-center gap-2 text-corvus-muted"
          >
            <LoadingDots />
            <span className="text-sm">Thinking...</span>
          </motion.div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="p-4 border-t border-corvus-border">
        {readOnly ? (
          <div className="px-4 py-3 bg-amber-950/30 border border-amber-700/30 rounded-lg text-center">
            <p className="text-sm text-amber-400/80">
              {isSampleLedger
                ? "Sample ledger — read-only. Create a new ledger to start your own."
                : "Viewing history — input disabled"}
            </p>
          </div>
        ) : isBranchMerged ? (
          <div className="px-4 py-3 bg-corvus-bg border border-corvus-border rounded-lg text-center">
            <p className="text-sm text-corvus-muted">
              This branch has been merged and cannot continue.
            </p>
          </div>
        ) : (
          <>
            <div className="relative">
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Describe your venture..."
                disabled={isLoading}
                rows={1}
                className="
                  w-full px-4 py-3 pr-12
                  bg-corvus-bg border border-corvus-border rounded-lg
                  text-corvus-text placeholder-corvus-muted
                  resize-none
                  focus:outline-none focus:border-corvus-accent/50 focus:ring-1 focus:ring-corvus-accent/50
                  disabled:opacity-50
                  transition-colors
                "
              />
              <button
                type="submit"
                disabled={!input.trim() || isLoading}
                className="
                  absolute right-2 bottom-2
                  p-2 rounded-md
                  bg-corvus-accent text-white
                  hover:bg-corvus-accent-dim
                  disabled:opacity-30 disabled:cursor-not-allowed
                  transition-colors
                "
              >
                <SendIcon />
              </button>
            </div>
            <p className="text-xs text-corvus-muted mt-2">
              Press Enter to send, Shift+Enter for new line
            </p>
          </>
        )}
      </form>
    </div>
  );
}

interface ChatBubbleProps {
  message: ChatMessage;
  isHighlighted?: boolean;
  hasErrorResponse?: boolean;
  onRetry?: () => void;
  isRetrying?: boolean;
  skipEntryAnimation?: boolean;
  onBranchFromMessage?: () => void;
}

// Threshold for collapsing long messages (in characters)
const COLLAPSE_THRESHOLD = 2000;

function ChatBubble({
  message,
  isHighlighted,
  hasErrorResponse,
  onRetry,
  isRetrying,
  skipEntryAnimation,
  onBranchFromMessage,
}: ChatBubbleProps) {
  const isUser = message.role === "user";
  const [scope, animate] = useAnimate();
  const [isExpanded, setIsExpanded] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [showModal, setShowModal] = useState(false);

  const timestamp = formatMessageTimestamp(message.recordedAt);
  const isLongMessage = !isUser && message.content.length > COLLAPSE_THRESHOLD;

  // Trigger blink animation when highlighted
  useEffect(() => {
    if (isHighlighted && scope.current) {
      // Pulse scale and box-shadow together
      animate(
        scope.current,
        {
          scale: [1, 1.03, 1, 1.03, 1, 1.03, 1],
          boxShadow: [
            "0 0 0 0 rgba(124, 58, 237, 0)",
            "0 0 0 4px rgba(124, 58, 237, 0.5)",
            "0 0 0 0 rgba(124, 58, 237, 0)",
            "0 0 0 4px rgba(124, 58, 237, 0.5)",
            "0 0 0 0 rgba(124, 58, 237, 0)",
            "0 0 0 4px rgba(124, 58, 237, 0.5)",
            "0 0 0 0 rgba(124, 58, 237, 0)",
          ],
        },
        { duration: 1.5, ease: "easeInOut" }
      );
    }
  }, [isHighlighted, animate, scope]);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  }, [message.content]);

  const handleDownload = useCallback(() => {
    const blob = new Blob([message.content], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `corvus-export-${new Date().toISOString().slice(0, 10)}.md`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  }, [message.content]);

  return (
    <motion.div
      data-message-id={message.id}
      layout
      initial={skipEntryAnimation ? false : { opacity: 0, y: 10, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, scale: 0.95 }}
      transition={springConfig}
      className={`flex ${isUser ? "justify-end" : "justify-start"}`}
    >
      <div
        ref={scope}
        className={`
            max-w-[85%] px-4 py-2.5 rounded-2xl
            ${
              isUser
                ? "bg-corvus-accent text-white rounded-br-sm"
                : "bg-corvus-border/50 text-corvus-text rounded-bl-sm"
            }
          `}
      >
        {isUser ? (
          <p className="text-sm whitespace-pre-wrap">{message.content}</p>
        ) : (
          <>
            <div
              className={`
                  text-sm prose-sm prose-invert prose-p:my-1 prose-ul:my-1 prose-ol:my-1 prose-li:my-0 prose-headings:my-2 prose-code:bg-black/20 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs prose-pre:bg-black/20 prose-pre:p-2 prose-pre:rounded prose-a:text-corvus-accent prose-a:no-underline hover:prose-a:underline
                  ${isLongMessage && !isExpanded ? "max-h-96 overflow-hidden relative" : ""}
                `}
            >
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
              {/* Fade gradient for collapsed content */}
              {isLongMessage && !isExpanded && (
                <div className="absolute bottom-0 left-0 right-0 h-16 bg-gradient-to-t from-corvus-border/50 to-transparent pointer-events-none" />
              )}
            </div>

            {/* Action bar for assistant messages */}
            {isLongMessage ? (
              /* Long messages: always show full action bar */
              <>
                <div className="flex items-center justify-between mt-2 pt-2 border-t border-white/10">
                  <div className="flex items-center gap-1">
                    <button
                      onClick={handleCopy}
                      className="p-1.5 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/5"
                      title="Copy markdown"
                    >
                      {copySuccess ? <CheckIcon /> : <CopyIcon />}
                    </button>
                    <button
                      onClick={handleDownload}
                      className="p-1.5 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/5"
                      title="Download as .md"
                    >
                      <DownloadIcon />
                    </button>
                    <button
                      onClick={() => setShowModal(true)}
                      className="p-1.5 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/5"
                      title="Open in modal"
                    >
                      <ExpandIcon />
                    </button>
                    {onBranchFromMessage && (
                      <button
                        onClick={onBranchFromMessage}
                        className="p-1.5 text-corvus-muted hover:text-amber-400 transition-colors rounded hover:bg-white/5"
                        title="Branch from here"
                      >
                        <BranchIcon />
                      </button>
                    )}
                  </div>
                  <button
                    onClick={() => setIsExpanded(!isExpanded)}
                    className="text-xs text-corvus-muted hover:text-corvus-text transition-colors flex items-center gap-1"
                  >
                    {isExpanded ? (
                      <>
                        Show less <ChevronUpIcon />
                      </>
                    ) : (
                      <>
                        Show more <ChevronDownIcon />
                      </>
                    )}
                  </button>
                </div>
                <p className="text-[10px] mt-1 text-corvus-muted">{timestamp}</p>
              </>
            ) : (
              /* Short messages: timestamp + ellipsis on same row, reveal buttons on hover */
              <div className="group/actions mt-1">
                {/* Timestamp row with ellipsis (ellipsis hidden on hover) */}
                <div className="flex items-center justify-between">
                  <p className="text-[10px] text-corvus-muted">{timestamp}</p>
                  <span className="text-corvus-muted/50 text-xs tracking-widest group-hover/actions:hidden">
                    •••
                  </span>
                </div>
                {/* Action buttons (shown on hover) */}
                <div className="hidden group-hover/actions:flex items-center gap-1 mt-1 pt-1 border-t border-white/10">
                  <button
                    onClick={handleCopy}
                    className="p-1.5 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/5"
                    title="Copy markdown"
                  >
                    {copySuccess ? <CheckIcon /> : <CopyIcon />}
                  </button>
                  <button
                    onClick={handleDownload}
                    className="p-1.5 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/5"
                    title="Download as .md"
                  >
                    <DownloadIcon />
                  </button>
                  <button
                    onClick={() => setShowModal(true)}
                    className="p-1.5 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/5"
                    title="Open in modal"
                  >
                    <ExpandIcon />
                  </button>
                  {onBranchFromMessage && (
                    <button
                      onClick={onBranchFromMessage}
                      className="p-1.5 text-corvus-muted hover:text-amber-400 transition-colors rounded hover:bg-white/5"
                      title="Branch from here"
                    >
                      <BranchIcon />
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Message modal */}
            <MessageModal
              isOpen={showModal}
              onClose={() => setShowModal(false)}
              content={message.content}
              timestamp={timestamp}
              onCopy={handleCopy}
              onDownload={handleDownload}
              copySuccess={copySuccess}
            />
          </>
        )}
        {/* Timestamp and retry/branch buttons for user messages */}
        {isUser && (
          <div className="group/user-actions flex items-center justify-between mt-1 gap-2">
            <p className="text-[10px] text-white/60">{timestamp}</p>
            <div className="flex items-center gap-1">
              {onBranchFromMessage && (
                <button
                  onClick={onBranchFromMessage}
                  className="hidden group-hover/user-actions:block p-1 text-white/40 hover:text-white/80 transition-colors rounded hover:bg-white/10"
                  title="Branch from here"
                >
                  <BranchIcon />
                </button>
              )}
              {hasErrorResponse && onRetry && (
                <button
                  onClick={onRetry}
                  disabled={isRetrying}
                  className="flex items-center gap-1 px-2 py-0.5 text-[10px] font-medium bg-white/10 hover:bg-white/20 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  title="Retry this message"
                >
                  <RetryIcon />
                  {isRetrying ? "Retrying..." : "Retry"}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </motion.div>
  );
}

function LoadingDots() {
  return (
    <div className="flex gap-1">
      {[0, 1, 2].map((i) => (
        <motion.div
          key={i}
          animate={{
            y: [0, -4, 0],
          }}
          transition={{
            duration: 0.5,
            repeat: Infinity,
            delay: i * 0.1,
          }}
          className="w-2 h-2 bg-corvus-muted rounded-full"
        />
      ))}
    </div>
  );
}

function ContextDivider() {
  return (
    <div className="flex items-center gap-2 py-2 mb-4">
      <div className="flex-1 h-px bg-corvus-border/50" />
      <span className="text-[10px] text-corvus-muted/60">context</span>
      <div className="flex-1 h-px bg-corvus-border/50" />
    </div>
  );
}

interface MessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  content: string;
  timestamp: string;
  onCopy: () => void;
  onDownload: () => void;
  copySuccess: boolean;
}

function MessageModal({
  isOpen,
  onClose,
  content,
  timestamp,
  onCopy,
  onDownload,
  copySuccess,
}: MessageModalProps) {
  // Close on escape key
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      return () => document.removeEventListener("keydown", handleKeyDown);
    }
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/70"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="bg-corvus-surface border border-corvus-border rounded-xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-corvus-border">
              <div className="flex items-center gap-3">
                <span className="text-lg">🐦‍⬛</span>
                <div>
                  <h3 className="font-semibold text-corvus-text">Corvus Response</h3>
                  <p className="text-xs text-corvus-muted">{timestamp}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={onCopy}
                  className="px-3 py-1.5 text-sm text-corvus-muted hover:text-corvus-text transition-colors rounded-md hover:bg-corvus-border/50 flex items-center gap-1.5"
                >
                  {copySuccess ? <CheckIcon /> : <CopyIcon />}
                  {copySuccess ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={onDownload}
                  className="px-3 py-1.5 text-sm text-corvus-muted hover:text-corvus-text transition-colors rounded-md hover:bg-corvus-border/50 flex items-center gap-1.5"
                >
                  <DownloadIcon />
                  Download
                </button>
                <button
                  onClick={onClose}
                  className="p-1.5 text-corvus-muted hover:text-corvus-text transition-colors rounded-md hover:bg-corvus-border/50 ml-2"
                  title="Close (Esc)"
                >
                  <CloseIcon />
                </button>
              </div>
            </div>

            {/* Modal content */}
            <div className="flex-1 overflow-y-auto px-6 py-4">
              <div className="prose prose-invert prose-sm max-w-none prose-p:my-2 prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5 prose-headings:my-3 prose-code:bg-black/30 prose-code:px-1.5 prose-code:py-0.5 prose-code:rounded prose-code:text-sm prose-pre:bg-black/30 prose-pre:p-3 prose-pre:rounded-lg prose-a:text-corvus-accent prose-a:no-underline hover:prose-a:underline">
                <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function SendIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function CopyIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

function DownloadIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="6 9 12 15 18 9" />
    </svg>
  );
}

function ChevronUpIcon() {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="18 15 12 9 6 15" />
    </svg>
  );
}

function ExpandIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="15 3 21 3 21 9" />
      <polyline points="9 21 3 21 3 15" />
      <line x1="21" y1="3" x2="14" y2="10" />
      <line x1="3" y1="21" x2="10" y2="14" />
    </svg>
  );
}

function CloseIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

function MergeIcon({ className }: { className?: string }) {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <circle cx="18" cy="18" r="3" />
      <circle cx="6" cy="6" r="3" />
      <path d="M6 21V9a9 9 0 0 0 9 9" />
    </svg>
  );
}

function BranchIcon() {
  return (
    <svg
      width="14"
      height="14"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <line x1="6" y1="3" x2="6" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  );
}

function RetryIcon() {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <polyline points="23 4 23 10 17 10" />
      <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
    </svg>
  );
}
