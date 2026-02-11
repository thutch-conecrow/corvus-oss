"use client";

import { useState, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";

const SETTINGS_KEY = "corvus-ledger-settings";

export interface CorvusSettings {
  apiKey: string;
  model: string;
}

const DEFAULT_SETTINGS: CorvusSettings = {
  apiKey: "",
  model: "claude-sonnet-4-5-20250929",
};

const AVAILABLE_MODELS = [
  { id: "claude-sonnet-4-5-20250929", label: "Claude Sonnet 4.5" },
  { id: "claude-opus-4-20250514", label: "Claude Opus 4" },
  { id: "claude-sonnet-4-20250514", label: "Claude Sonnet 4" },
  { id: "claude-haiku-4-20250414", label: "Claude Haiku 4" },
];

export function getSettings(): CorvusSettings {
  if (typeof window === "undefined") return DEFAULT_SETTINGS;
  try {
    const stored = localStorage.getItem(SETTINGS_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return { ...DEFAULT_SETTINGS, ...parsed };
    }
  } catch {
    // ignore parse errors
  }
  return DEFAULT_SETTINGS;
}

export function saveSettings(settings: CorvusSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export function hasApiKey(): boolean {
  return getSettings().apiKey.length > 0;
}

interface SettingsModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (settings: CorvusSettings) => void;
}

export function SettingsModal({ isOpen, onClose, onSave }: SettingsModalProps) {
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState(DEFAULT_SETTINGS.model);
  const [showKey, setShowKey] = useState(false);

  useEffect(() => {
    if (isOpen) {
      const current = getSettings();
      setApiKey(current.apiKey);
      setModel(current.model);
    }
  }, [isOpen]);

  const handleSave = useCallback(() => {
    const settings: CorvusSettings = { apiKey: apiKey.trim(), model };
    saveSettings(settings);
    onSave(settings);
    onClose();
  }, [apiKey, model, onSave, onClose]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Enter" && apiKey.trim()) handleSave();
    },
    [onClose, handleSave, apiKey]
  );

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onKeyDown={handleKeyDown}
        >
          {/* Backdrop */}
          <div className="absolute inset-0 bg-black/60" onClick={onClose} />

          {/* Modal */}
          <motion.div
            className="relative bg-corvus-surface border border-corvus-border rounded-lg shadow-2xl w-full max-w-md mx-4"
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.95, opacity: 0 }}
            transition={{ type: "spring", damping: 25, stiffness: 300 }}
          >
            <div className="p-6">
              <h2 className="text-lg font-bold text-corvus-text mb-1">Settings</h2>
              <p className="text-sm text-corvus-muted mb-6">
                Your API key is stored in your browser only. It is sent to the Next.js API route,
                which forwards it to Anthropic.
              </p>

              {/* API Key */}
              <label className="block mb-4">
                <span className="text-sm font-medium text-corvus-text">Anthropic API Key</span>
                <div className="relative mt-1.5">
                  <input
                    type={showKey ? "text" : "password"}
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                    placeholder="sk-ant-..."
                    className="w-full px-3 py-2 pr-16 bg-corvus-bg border border-corvus-border rounded-md text-corvus-text text-sm placeholder:text-corvus-muted/50 focus:outline-none focus:border-corvus-accent"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-corvus-muted hover:text-corvus-text transition-colors px-1.5 py-0.5"
                  >
                    {showKey ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              {/* Model Selection */}
              <label className="block mb-6">
                <span className="text-sm font-medium text-corvus-text">Model</span>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full mt-1.5 px-3 py-2 bg-corvus-bg border border-corvus-border rounded-md text-corvus-text text-sm focus:outline-none focus:border-corvus-accent"
                >
                  {AVAILABLE_MODELS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label}
                    </option>
                  ))}
                </select>
              </label>

              {/* Actions */}
              <div className="flex justify-end gap-3">
                <button
                  onClick={onClose}
                  className="px-4 py-2 text-sm font-medium rounded-md text-corvus-muted hover:text-corvus-text transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  className="px-4 py-2 text-sm font-medium rounded-md bg-corvus-accent text-white hover:bg-corvus-accent-dim transition-colors"
                >
                  Save
                </button>
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
