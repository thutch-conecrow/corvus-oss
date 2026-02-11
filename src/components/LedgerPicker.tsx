"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Ledger, Persona } from "@/types";
import { PERSONA_INFO } from "@/types";

interface LedgerPickerProps {
  ledgers: Ledger[];
  currentLedger: Ledger | null;
  onSelect: (ledgerId: string) => void;
  onCreate: (name: string, persona: Persona) => void;
  onRename: (ledgerId: string, newName: string) => void;
  onDelete: (ledgerId: string) => void;
}

export function LedgerPicker({
  ledgers,
  currentLedger,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: LedgerPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isCreating, setIsCreating] = useState(false);
  const [creatingPersona, setCreatingPersona] = useState<Persona>("thinking-partner");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        setIsCreating(false);
        setEditingId(null);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Focus input when creating or editing
  useEffect(() => {
    if ((isCreating || editingId) && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isCreating, editingId]);

  const handleCreate = () => {
    if (inputValue.trim()) {
      onCreate(inputValue.trim(), creatingPersona);
      setInputValue("");
      setIsCreating(false);
      setCreatingPersona("thinking-partner");
    }
  };

  const startCreating = (persona: Persona) => {
    setCreatingPersona(persona);
    setIsCreating(true);
  };

  const handleRename = (ledgerId: string) => {
    if (inputValue.trim()) {
      onRename(ledgerId, inputValue.trim());
      setInputValue("");
      setEditingId(null);
    }
  };

  const startEditing = (ledger: Ledger) => {
    setEditingId(ledger.id);
    setInputValue(ledger.name);
  };

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-md bg-corvus-border/30 hover:bg-corvus-border/50 transition-colors"
      >
        <span className="text-sm font-medium text-corvus-text truncate max-w-[200px]">
          {currentLedger?.name ?? "No ledger selected"}
        </span>
        <svg
          className={`w-4 h-4 text-corvus-muted transition-transform ${isOpen ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Dropdown */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.15 }}
            className="absolute top-full left-0 mt-1 w-72 bg-corvus-surface border border-corvus-border rounded-lg shadow-xl z-50 overflow-x-hidden"
          >
            {/* Ledger list */}
            <div className="max-h-64 overflow-y-auto rounded-t-lg">
              {ledgers.length === 0 && !isCreating && (
                <div className="px-3 py-4 text-center text-sm text-corvus-muted">
                  No ledgers yet. Create one to get started.
                </div>
              )}

              {ledgers.map((ledger) => (
                <div
                  key={ledger.id}
                  className={`
                    group flex items-center gap-2 px-3 py-2
                    ${ledger.id === currentLedger?.id ? "bg-corvus-accent/10" : "hover:bg-corvus-border/30"}
                  `}
                >
                  {editingId === ledger.id ? (
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleRename(ledger.id);
                        if (e.key === "Escape") {
                          setEditingId(null);
                          setInputValue("");
                        }
                      }}
                      className="flex-1 min-w-0 px-2 py-1 text-sm bg-corvus-bg border border-corvus-border rounded focus:outline-none focus:border-corvus-accent"
                    />
                  ) : (
                    <>
                      <button
                        onClick={() => {
                          onSelect(ledger.id);
                          setIsOpen(false);
                        }}
                        className="flex-1 text-left text-sm text-corvus-text truncate"
                      >
                        {ledger.name}
                      </button>

                      {/* Actions (visible on hover) */}
                      <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button
                          onClick={() => startEditing(ledger)}
                          className="p-1 text-corvus-muted hover:text-corvus-text rounded"
                          title="Rename"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                            />
                          </svg>
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${ledger.name}"? This cannot be undone.`)) {
                              onDelete(ledger.id);
                            }
                          }}
                          className="p-1 text-corvus-muted hover:text-red-400 rounded"
                          title="Delete"
                        >
                          <svg
                            className="w-3.5 h-3.5"
                            fill="none"
                            stroke="currentColor"
                            viewBox="0 0 24 24"
                          >
                            <path
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              strokeWidth={2}
                              d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                            />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>

            {/* Create new ledger */}
            <div className="border-t border-corvus-border p-2 rounded-b-lg">
              {isCreating ? (
                <div className="space-y-2">
                  <div className="text-xs font-medium px-1 text-corvus-muted">
                    {PERSONA_INFO[creatingPersona].label} -{" "}
                    {PERSONA_INFO[creatingPersona].description}
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={inputRef}
                      type="text"
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") handleCreate();
                        if (e.key === "Escape") {
                          setIsCreating(false);
                          setInputValue("");
                          setCreatingPersona("thinking-partner");
                        }
                      }}
                      placeholder="Ledger name..."
                      className="flex-1 min-w-0 px-2 py-1.5 text-sm bg-corvus-bg border border-corvus-border rounded focus:outline-none focus:border-corvus-accent"
                    />
                    <button
                      onClick={handleCreate}
                      disabled={!inputValue.trim()}
                      className="px-2 py-1.5 text-sm font-medium text-white rounded disabled:opacity-50 bg-corvus-accent hover:bg-corvus-accent/80"
                    >
                      Create
                    </button>
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <div className="text-xs font-medium px-2 py-1 text-corvus-muted">New Ledger</div>
                  {(Object.keys(PERSONA_INFO) as Array<keyof typeof PERSONA_INFO>).map(
                    (personaKey) => (
                      <button
                        key={personaKey}
                        onClick={() => startCreating(personaKey)}
                        className="w-full flex items-start gap-2 px-2 py-1.5 text-sm text-corvus-muted hover:text-corvus-text hover:bg-corvus-border/30 rounded transition-colors"
                      >
                        <svg
                          className="w-4 h-4 mt-0.5 flex-shrink-0"
                          fill="none"
                          stroke="currentColor"
                          viewBox="0 0 24 24"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 4v16m8-8H4"
                          />
                        </svg>
                        <div className="text-left">
                          <div className="font-medium text-corvus-text">
                            {PERSONA_INFO[personaKey].label}
                          </div>
                          <div className="text-xs text-corvus-muted">
                            {PERSONA_INFO[personaKey].description}
                          </div>
                        </div>
                      </button>
                    )
                  )}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
