"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Conversation } from "@/types";

interface ConversationPickerProps {
  conversations: Conversation[];
  currentConversation: Conversation | null;
  onSelect: (conversationId: string) => void;
  onCreate: (name?: string) => void;
  onRename: (conversationId: string, newName: string) => void;
  onDelete: (conversationId: string) => void;
  onBranch: (name?: string) => void;
}

export function ConversationPicker({
  conversations,
  currentConversation,
  onSelect,
  onCreate,
  onRename,
  onDelete,
  onBranch,
}: ConversationPickerProps) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");
  const editInputRef = useRef<HTMLInputElement>(null);

  // Focus input when editing starts
  useEffect(() => {
    if (editingId && editInputRef.current) {
      editInputRef.current.focus();
      editInputRef.current.select();
    }
  }, [editingId]);

  const handleStartRename = useCallback(
    (conversation: Conversation, e: React.MouseEvent) => {
      e.stopPropagation();
      setEditingId(conversation.id);
      setEditingName(conversation.name ?? getDefaultName(conversations, conversation));
    },
    [conversations]
  );

  const handleConfirmRename = useCallback(() => {
    if (editingId && editingName.trim()) {
      onRename(editingId, editingName.trim());
    }
    setEditingId(null);
    setEditingName("");
  }, [editingId, editingName, onRename]);

  const handleCancelRename = useCallback(() => {
    setEditingId(null);
    setEditingName("");
  }, []);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Enter") {
        e.preventDefault();
        handleConfirmRename();
      } else if (e.key === "Escape") {
        e.preventDefault();
        handleCancelRename();
      }
    },
    [handleConfirmRename, handleCancelRename]
  );

  const handleDelete = useCallback(
    (conversationId: string, e: React.MouseEvent) => {
      e.stopPropagation();
      if (conversations.length <= 1) {
        return; // Don't delete the last conversation
      }
      onDelete(conversationId);
    },
    [conversations.length, onDelete]
  );

  const handleCreate = useCallback(() => {
    onCreate();
  }, [onCreate]);

  const handleBranch = useCallback(() => {
    onBranch();
  }, [onBranch]);

  return (
    <div className="flex items-center border-b border-corvus-border bg-corvus-bg/50">
      {/* Tabs */}
      <div className="flex-1 flex items-center overflow-x-auto scrollbar-hide">
        <AnimatePresence mode="popLayout">
          {conversations.map((conversation) => {
            const isActive = currentConversation?.id === conversation.id;
            const isEditing = editingId === conversation.id;
            const isBranch = conversation.type === "isolated";
            const displayName = conversation.name ?? getDefaultName(conversations, conversation);

            return (
              <motion.div
                key={conversation.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="relative group flex-shrink-0 flex items-center"
              >
                <button
                  onClick={() => onSelect(conversation.id)}
                  className={`
                    px-3 py-2 text-sm font-medium transition-colors relative flex items-center gap-1.5
                    ${isActive ? "text-corvus-text" : "text-corvus-muted hover:text-corvus-text"}
                  `}
                >
                  {/* Branch indicator */}
                  {isBranch && (
                    <span className="text-amber-400" title="Isolated branch (what-if)">
                      <BranchIcon />
                    </span>
                  )}

                  {isEditing ? (
                    <input
                      ref={editInputRef}
                      type="text"
                      value={editingName}
                      onChange={(e) => setEditingName(e.target.value)}
                      onKeyDown={handleKeyDown}
                      onBlur={handleConfirmRename}
                      onClick={(e) => e.stopPropagation()}
                      className="w-24 bg-corvus-surface border border-corvus-accent rounded px-1 py-0.5 text-sm text-corvus-text focus:outline-none"
                    />
                  ) : (
                    <span className="truncate max-w-32 inline-block align-middle">
                      {displayName}
                    </span>
                  )}

                  {/* Active indicator */}
                  {isActive && (
                    <motion.div
                      layoutId="activeConversation"
                      className={`absolute bottom-0 left-0 right-0 h-0.5 ${isBranch ? "bg-amber-400" : "bg-corvus-accent"}`}
                    />
                  )}
                </button>

                {/* Action buttons (visible on hover, inline after the tab) */}
                {!isEditing && (
                  <div className="hidden group-hover:flex items-center gap-0.5 -ml-2 pr-1">
                    <button
                      onClick={(e) => handleStartRename(conversation, e)}
                      className="p-1 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-corvus-surface"
                      title="Rename"
                    >
                      <EditIcon />
                    </button>
                    {conversations.length > 1 && (
                      <button
                        onClick={(e) => handleDelete(conversation.id, e)}
                        className="p-1 text-corvus-muted hover:text-red-400 transition-colors rounded hover:bg-corvus-surface"
                        title="Delete"
                      >
                        <DeleteIcon />
                      </button>
                    )}
                  </div>
                )}
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>

      {/* Action buttons */}
      <div className="flex-shrink-0 flex items-center border-l border-corvus-border/50">
        {/* Branch button */}
        <button
          onClick={handleBranch}
          className="p-2 text-corvus-muted hover:text-amber-400 transition-colors"
          title="Create what-if branch"
        >
          <BranchIcon />
        </button>

        {/* Add button */}
        <button
          onClick={handleCreate}
          className="p-2 text-corvus-muted hover:text-corvus-text transition-colors"
          title="New conversation"
        >
          <PlusIcon />
        </button>
      </div>
    </div>
  );
}

// Helper to generate default conversation name
function getDefaultName(conversations: Conversation[], conversation: Conversation): string {
  const index = conversations.findIndex((c) => c.id === conversation.id);
  if (conversation.type === "isolated") {
    return `What-if ${index + 1}`;
  }
  return `Conversation ${index + 1}`;
}

// Icons
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

function EditIcon() {
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
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function DeleteIcon() {
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
      <polyline points="3 6 5 6 21 6" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  );
}

function PlusIcon() {
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
    >
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}
