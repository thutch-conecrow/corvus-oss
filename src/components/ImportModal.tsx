"use client";

import { useState, useCallback, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { LedgerExport } from "./ExportModal";
import { EXPORT_VERSION } from "./ExportModal";

type ImportMode = "replace" | "copy";

interface ImportModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImport: (data: LedgerExport, mode: ImportMode) => void;
  currentLedgerName: string | null;
}

interface ParseResult {
  success: boolean;
  data?: LedgerExport;
  error?: string;
}

function parseImportData(text: string): ParseResult {
  try {
    const data = JSON.parse(text);

    // Validate structure - support both v1 (venture) and v2+ (ledger) formats
    const hasLedger = data.ledger && typeof data.ledger === "object";
    const hasVenture = data.venture && typeof data.venture === "object";

    if (!data.version || (!hasLedger && !hasVenture) || !data.state) {
      return { success: false, error: "Invalid export format: missing required fields" };
    }

    // Check version compatibility
    if (data.version > EXPORT_VERSION) {
      return {
        success: false,
        error: `Export version ${data.version} is newer than supported version ${EXPORT_VERSION}. Please update the app.`,
      };
    }

    // Validate state structure (facts is optional for backward compat)
    if (!Array.isArray(data.state.entries)) {
      return { success: false, error: "Invalid export format: missing or invalid entries array" };
    }
    if (data.state.decisions !== undefined && !Array.isArray(data.state.decisions)) {
      return { success: false, error: "Invalid export format: decisions must be an array" };
    }
    // Ensure decisions is always an array for downstream code
    if (!data.state.decisions) {
      data.state.decisions = [];
    }

    // Migrate v1 format to v2 format
    if (data.version === 1 && hasVenture && !hasLedger) {
      data.ledger = data.venture;
      delete data.venture;
      data.version = 2;
    }

    // Migrate mode to persona (backward compatibility)
    if (data.ledger && data.ledger.mode !== undefined && data.ledger.persona === undefined) {
      // All modes map to thinking-partner (Interviewer persona added in Phase 3)
      data.ledger.persona = "thinking-partner";
      delete data.ledger.mode;
    }

    // Migrate v2 format to v3 format (messages → conversations)
    if (data.version === 2 && data.state.messages !== undefined && !data.state.conversations) {
      const now = Date.now();
      const defaultConversationId = `imported-${now}`;
      data.state.conversations = [
        {
          id: defaultConversationId,
          createdAt: data.state.messages[0]?.recordedAt ?? now,
          updatedAt: data.state.messages[data.state.messages.length - 1]?.recordedAt ?? now,
          messages: data.state.messages,
          currentChatPath: data.state.currentChatPath ?? [],
          type: "live",
        },
      ];
      data.state.currentConversationId = defaultConversationId;
      // Add conversationId to decisions that don't have it
      data.state.decisions = data.state.decisions.map((d: { conversationId?: string }) => ({
        ...d,
        conversationId: d.conversationId ?? defaultConversationId,
      }));
      delete data.state.messages;
      delete data.state.currentChatPath;
      data.version = 3;
    }

    return { success: true, data: data as LedgerExport };
  } catch {
    return { success: false, error: "Invalid JSON format" };
  }
}

export function ImportModal({ isOpen, onClose, onImport, currentLedgerName }: ImportModalProps) {
  const [inputText, setInputText] = useState("");
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [mode, setMode] = useState<ImportMode>("copy");
  const [isDragging, setIsDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleTextChange = useCallback((text: string) => {
    setInputText(text);
    if (text.trim()) {
      setParseResult(parseImportData(text));
    } else {
      setParseResult(null);
    }
  }, []);

  const handleFileRead = useCallback((file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setInputText(text);
      setParseResult(parseImportData(text));
    };
    reader.onerror = () => {
      setParseResult({ success: false, error: "Failed to read file" });
    };
    reader.readAsText(file);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);

      const file = e.dataTransfer.files[0];
      if (file) {
        handleFileRead(file);
      }
    },
    [handleFileRead]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) {
        handleFileRead(file);
      }
    },
    [handleFileRead]
  );

  const handleImport = useCallback(() => {
    if (parseResult?.success && parseResult.data) {
      onImport(parseResult.data, mode);
      // Reset state
      setInputText("");
      setParseResult(null);
      onClose();
    }
  }, [parseResult, mode, onImport, onClose]);

  const handleClose = useCallback(() => {
    setInputText("");
    setParseResult(null);
    onClose();
  }, [onClose]);

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={handleClose}
            className="fixed inset-0 bg-black/60 z-40"
          />

          {/* Modal */}
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            className="fixed inset-4 md:inset-12 lg:inset-24 bg-corvus-surface border border-corvus-border rounded-lg z-50 flex flex-col overflow-hidden"
          >
            {/* Header */}
            <div className="flex items-center justify-between p-4 border-b border-corvus-border">
              <h2 className="text-lg font-semibold text-corvus-text">Import Ledger</h2>
              <button
                onClick={handleClose}
                className="p-2 text-corvus-muted hover:text-corvus-text transition-colors"
              >
                <svg
                  width="20"
                  height="20"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                >
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
              {/* Drop zone / Text input */}
              <div
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                className={`
                  relative border-2 border-dashed rounded-lg transition-colors
                  ${
                    isDragging
                      ? "border-corvus-accent bg-corvus-accent/10"
                      : "border-corvus-border hover:border-corvus-muted"
                  }
                `}
              >
                <textarea
                  value={inputText}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder="Paste exported JSON here, or drag and drop a file..."
                  className="w-full h-48 p-4 bg-transparent text-sm text-corvus-text font-mono placeholder-corvus-muted resize-none focus:outline-none"
                />

                {/* File input overlay */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept=".json"
                  onChange={handleFileSelect}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="absolute bottom-2 right-2 px-3 py-1.5 text-xs font-medium bg-corvus-border/50 text-corvus-muted hover:text-corvus-text rounded transition-colors"
                >
                  Browse Files
                </button>
              </div>

              {/* Parse result */}
              {parseResult && (
                <div
                  className={`p-4 rounded-lg ${parseResult.success ? "bg-green-500/10" : "bg-red-500/10"}`}
                >
                  {parseResult.success && parseResult.data ? (
                    <div className="space-y-2">
                      <div className="flex items-center gap-2 text-green-400">
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                        >
                          <polyline points="20 6 9 17 4 12" />
                        </svg>
                        <span className="text-sm font-medium">Valid export file</span>
                      </div>
                      <div className="text-sm text-corvus-text space-y-1">
                        <p>
                          <strong>Ledger:</strong> {parseResult.data.ledger.name}
                        </p>
                        <p>
                          <strong>Exported:</strong>{" "}
                          {new Date(parseResult.data.exportedAt).toLocaleString()}
                        </p>
                        <p>
                          <strong>Conversations:</strong>{" "}
                          {parseResult.data.state.conversations?.length ?? 1}
                        </p>
                        <p>
                          <strong>Messages:</strong>{" "}
                          {parseResult.data.state.conversations?.reduce(
                            (sum, c) => sum + c.messages.length,
                            0
                          ) ?? 0}
                        </p>
                        <p>
                          <strong>Decisions:</strong> {parseResult.data.state.decisions.length}
                        </p>
                        <p>
                          <strong>Entries:</strong> {parseResult.data.state.entries.length}
                        </p>
                      </div>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 text-red-400">
                      <svg
                        width="16"
                        height="16"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <circle cx="12" cy="12" r="10" />
                        <line x1="15" y1="9" x2="9" y2="15" />
                        <line x1="9" y1="9" x2="15" y2="15" />
                      </svg>
                      <span className="text-sm">{parseResult.error}</span>
                    </div>
                  )}
                </div>
              )}

              {/* Import mode selection */}
              {parseResult?.success && (
                <div className="space-y-3">
                  <label className="text-sm font-medium text-corvus-text">Import Mode</label>
                  <div className="space-y-2">
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-corvus-border hover:border-corvus-muted cursor-pointer transition-colors">
                      <input
                        type="radio"
                        name="mode"
                        value="copy"
                        checked={mode === "copy"}
                        onChange={() => setMode("copy")}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-medium text-corvus-text">Copy as new ledger</p>
                        <p className="text-xs text-corvus-muted">
                          Import as a new ledger named &ldquo;{parseResult.data?.ledger.name}&rdquo;
                          {currentLedgerName === parseResult.data?.ledger.name &&
                            " (will add suffix to avoid conflict)"}
                        </p>
                      </div>
                    </label>
                    <label className="flex items-start gap-3 p-3 rounded-lg border border-corvus-border hover:border-corvus-muted cursor-pointer transition-colors">
                      <input
                        type="radio"
                        name="mode"
                        value="replace"
                        checked={mode === "replace"}
                        onChange={() => setMode("replace")}
                        className="mt-1"
                      />
                      <div>
                        <p className="text-sm font-medium text-corvus-text">
                          Replace current ledger
                        </p>
                        <p className="text-xs text-corvus-muted">
                          Replace &ldquo;{currentLedgerName ?? "current ledger"}&rdquo; with the
                          imported data.
                          <span className="text-amber-400"> This cannot be undone.</span>
                        </p>
                      </div>
                    </label>
                  </div>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-end gap-2 p-4 border-t border-corvus-border">
              <button
                onClick={handleClose}
                className="px-4 py-2 text-sm font-medium text-corvus-muted hover:text-corvus-text transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleImport}
                disabled={!parseResult?.success}
                className={`
                  px-4 py-2 rounded-md text-sm font-medium transition-colors
                  ${
                    parseResult?.success
                      ? "bg-corvus-accent text-white hover:bg-corvus-accent-dim"
                      : "bg-corvus-border/50 text-corvus-muted cursor-not-allowed"
                  }
                `}
              >
                {mode === "replace" ? "Replace & Import" : "Import as New"}
              </button>
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
