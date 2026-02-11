"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type {
  LedgerState,
  Fork,
  Obligation,
  Ledger,
  Phase,
  Persona,
  ConversationType,
  LedgerEvent,
} from "@/types";
import { isFork, isObligation, isPathDecision, isObligationDecision } from "@/types";

// Exported conversation format
interface ExportedConversation {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messages: LedgerState["conversations"][0]["messages"];
  currentChatPath: string[];
  type: ConversationType;
}

// JSON export format for backup/restore
export interface LedgerExport {
  version: number;
  exportedAt: string;
  ledger: {
    name: string;
    persona?: Persona;
    createdAt: number;
    updatedAt: number;
  };
  state: {
    entries: LedgerState["entries"];
    decisions: LedgerState["decisions"];
    conversations: ExportedConversation[];
    currentConversationId: string;
    events: LedgerEvent[];
  };
}

export const EXPORT_VERSION = 4;

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
  state: LedgerState;
  currentLedger: Ledger | null;
}

function generateJSONExport(state: LedgerState, ledger: Ledger | null): LedgerExport {
  return {
    version: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    ledger: {
      name: ledger?.name ?? "Unnamed Ledger",
      persona: ledger?.persona ?? "thinking-partner",
      createdAt: ledger?.createdAt ?? Date.now(),
      updatedAt: ledger?.updatedAt ?? Date.now(),
    },
    state: {
      entries: state.entries,
      decisions: state.decisions,
      conversations: state.conversations,
      currentConversationId: state.currentConversationId,
      events: state.events,
    },
  };
}

function generateMarkdownExport(state: LedgerState): string {
  const lines: string[] = [];
  const timestamp = new Date().toISOString();

  lines.push("# Corvus Ledger Export");
  lines.push(`> Exported at: ${timestamp}`);
  lines.push("");

  // Chat History (organized by conversation)
  lines.push("## Chat History");
  lines.push("");
  if (state.conversations.length === 0) {
    lines.push("_No conversations yet._");
  } else {
    state.conversations.forEach((conversation, convIndex) => {
      const conversationName = conversation.name ?? `Conversation ${convIndex + 1}`;
      lines.push(`### ${conversationName}`);
      lines.push(`> Created: ${new Date(conversation.createdAt).toLocaleString()}`);
      lines.push("");

      if (conversation.messages.length === 0) {
        lines.push("_No messages in this conversation._");
      } else {
        conversation.messages.forEach((msg, index) => {
          const role = msg.role === "user" ? "USER" : "HUGINN";
          const time = new Date(msg.recordedAt).toLocaleTimeString();
          const parentInfo = msg.parentId ? ` (reply to ${msg.parentId.slice(0, 8)})` : "";
          lines.push(`#### [${index + 1}] ${role} (${msg.id.slice(0, 8)})${parentInfo}`);
          lines.push(`_${time}_`);
          lines.push("");
          lines.push(msg.content);
          lines.push("");
          lines.push("---");
          lines.push("");
        });
      }
      lines.push("");
    });
  }

  // Forks
  const forks = state.entries.filter(isFork) as Fork[];
  lines.push("## Forks (Decision Points)");
  lines.push("");
  if (forks.length === 0) {
    lines.push("_No forks yet._");
  } else {
    forks.forEach((fork) => {
      const chosenPath = fork.paths.find((p) => p.state === "chosen");
      const statusIcon = chosenPath ? "✓" : "?";
      lines.push(`### [${statusIcon}] ${fork.title}`);
      lines.push(`- **ID:** \`${fork.id.slice(0, 8)}\``);
      lines.push(`- **Phase:** ${fork.phase}`);
      lines.push(`- **Category:** ${fork.category || "-"}`);
      lines.push(`- **Why:** ${fork.why}`);
      lines.push("");
      lines.push("**Paths:**");
      fork.paths.forEach((path) => {
        const stateIcon = path.state === "chosen" ? "✓" : path.state === "dismissed" ? "~~" : "○";
        const pathLine =
          path.state === "dismissed"
            ? `- ${stateIcon} ~~${path.title}~~`
            : `- ${stateIcon} ${path.title}`;
        lines.push(pathLine);
        if (path.state === "chosen" && path.chosenRationale) {
          lines.push(`  - _"${path.chosenRationale}"_`);
        }
      });
      lines.push("");
    });
  }

  // Obligations
  const obligations = state.entries.filter(isObligation) as Obligation[];
  lines.push("## Obligations");
  lines.push("");
  if (obligations.length === 0) {
    lines.push("_No obligations yet._");
  } else {
    const phases: Phase[] = ["past", "now", "soon", "parking-lot"];
    const phaseLabels: Record<Phase, string> = {
      past: "PAST",
      now: "NOW",
      soon: "SOON",
      "parking-lot": "PARKING LOT",
    };
    const stateIcons: Record<string, string> = {
      todo: "○",
      done: "✓",
      "wont-do": "✕",
      delegated: "→",
      parked: "⏸",
    };
    for (const phase of phases) {
      const phaseObligations = obligations.filter((o) => o.phase === phase);
      if (phaseObligations.length === 0) continue;

      lines.push(`### ${phaseLabels[phase]}`);
      lines.push("");
      phaseObligations.forEach((obligation) => {
        const stateIcon = stateIcons[obligation.state] || "?";
        lines.push(`#### [${stateIcon}] ${obligation.title}`);
        lines.push(`- **ID:** \`${obligation.id.slice(0, 8)}\``);
        lines.push(`- **State:** ${obligation.state}`);
        lines.push(`- **Category:** ${obligation.category || "-"}`);
        lines.push(`- **Why:** ${obligation.why}`);
        if (obligation.notes) {
          lines.push(`- **Notes:** "${obligation.notes}"`);
        }
        if (obligation.triggeredBy && obligation.triggeredBy.length > 0) {
          lines.push(`- **Triggered by:** ${obligation.triggeredBy.join(", ")}`);
        }
        lines.push("");
      });
    }
  }

  // Decisions (Muninn)
  lines.push("## Decision Log (Muninn)");
  lines.push("");
  if (state.decisions.length === 0) {
    lines.push("_No decisions made yet._");
  } else {
    state.decisions.forEach((decision) => {
      const time = new Date(decision.decidedAt).toLocaleString();

      if (isPathDecision(decision)) {
        lines.push(`### ${decision.forkTitle} → ${decision.pathTitle}`);
        lines.push(`- **ID:** \`${decision.id.slice(0, 8)}\``);
        lines.push(`- **Rationale:** "${decision.rationale}"`);
        lines.push(`- **Decided at:** ${time}`);
        if (decision.revisitsDecisionId) {
          lines.push(`- **Revisits:** \`${decision.revisitsDecisionId.slice(0, 8)}\``);
        }
      } else if (isObligationDecision(decision)) {
        lines.push(`### ${decision.obligationTitle} → ${decision.newState}`);
        lines.push(`- **ID:** \`${decision.id.slice(0, 8)}\``);
        lines.push(`- **Previous state:** ${decision.previousState}`);
        lines.push(`- **New state:** ${decision.newState}`);
        if (decision.notes) {
          lines.push(`- **Notes:** "${decision.notes}"`);
        }
        lines.push(`- **Decided at:** ${time}`);
      }
      lines.push("");
    });
  }

  return lines.join("\n");
}

type ExportFormat = "markdown" | "json";

export function ExportModal({ isOpen, onClose, state, currentLedger }: ExportModalProps) {
  const [copied, setCopied] = useState(false);
  const [format, setFormat] = useState<ExportFormat>("markdown");

  const markdown = generateMarkdownExport(state);
  const jsonExport = generateJSONExport(state, currentLedger);
  const jsonString = JSON.stringify(jsonExport, null, 2);

  const content = format === "markdown" ? markdown : jsonString;
  const filename = `corvus-${currentLedger?.name?.toLowerCase().replace(/\s+/g, "-") ?? "export"}-${new Date().toISOString().split("T")[0]}`;

  const handleCopy = async () => {
    await navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const extension = format === "markdown" ? "md" : "json";
    const mimeType = format === "markdown" ? "text/markdown" : "application/json";
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `${filename}.${extension}`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <>
          {/* Backdrop */}
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
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
              <div className="flex items-center gap-4">
                <h2 className="text-lg font-semibold text-corvus-text">Export Ledger State</h2>
                {/* Format Toggle */}
                <div className="flex items-center bg-corvus-border/30 rounded-md p-0.5">
                  <button
                    onClick={() => setFormat("markdown")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      format === "markdown"
                        ? "bg-corvus-surface text-corvus-text"
                        : "text-corvus-muted hover:text-corvus-text"
                    }`}
                  >
                    Markdown
                  </button>
                  <button
                    onClick={() => setFormat("json")}
                    className={`px-3 py-1 text-xs font-medium rounded transition-colors ${
                      format === "json"
                        ? "bg-corvus-surface text-corvus-text"
                        : "text-corvus-muted hover:text-corvus-text"
                    }`}
                  >
                    JSON (Backup)
                  </button>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleDownload}
                  className="px-4 py-2 rounded-md text-sm font-medium bg-corvus-border/50 text-corvus-text hover:bg-corvus-border transition-colors"
                >
                  Download
                </button>
                <button
                  onClick={handleCopy}
                  className={`
                    px-4 py-2 rounded-md text-sm font-medium transition-colors
                    ${
                      copied
                        ? "bg-green-500/20 text-green-400"
                        : "bg-corvus-accent/20 text-corvus-accent hover:bg-corvus-accent/30"
                    }
                  `}
                >
                  {copied ? "Copied!" : "Copy"}
                </button>
                <button
                  onClick={onClose}
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
            </div>

            {/* Content */}
            <div className="flex-1 overflow-auto p-4">
              <pre className="text-sm text-corvus-text font-mono whitespace-pre-wrap">
                {content}
              </pre>
            </div>

            {/* Footer hint */}
            {format === "json" && (
              <div className="px-4 py-2 border-t border-corvus-border bg-corvus-bg/50">
                <p className="text-xs text-corvus-muted">
                  JSON format can be imported later to restore this ledger.
                </p>
              </div>
            )}
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );
}
