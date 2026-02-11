"use client";

import { useState, useRef, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { DecisionRecord } from "@/types";
import { isPathDecision, isObligationDecision } from "@/types";

interface DecisionLogProps {
  decisions: DecisionRecord[];
  onHighlight?: (decision: DecisionRecord) => void;
  onEditDate?: (decisionId: string, newDate: number) => void;
  /** Max height for stacked layout (e.g., "40vh") */
  maxHeight?: string;
  /** Whether this is rendered as a column (full height, different styling) */
  isColumn?: boolean;
}

const springConfig = {
  type: "spring" as const,
  stiffness: 500,
  damping: 30,
};

export function DecisionLog({
  decisions,
  onHighlight,
  onEditDate,
  maxHeight,
  isColumn,
}: DecisionLogProps) {
  // In column mode, show even if empty (with empty state)
  // In stacked mode, hide if no decisions
  if (decisions.length === 0 && !isColumn) {
    return null;
  }

  // Column layout: full height, scrollable content
  if (isColumn) {
    return (
      <div className="flex flex-col h-full bg-corvus-surface/30">
        {/* Header */}
        <div className="p-4 border-b border-corvus-border shrink-0">
          <h3 className="text-sm font-semibold text-corvus-muted uppercase tracking-wider flex items-center gap-2">
            <span className="text-lg">🐦‍⬛</span>
            Muninn
          </h3>
          <p className="text-xs text-corvus-muted mt-1">Decisions Made ({decisions.length})</p>
        </div>

        {/* Scrollable content */}
        <div className="flex-1 overflow-y-auto p-4">
          {decisions.length === 0 ? (
            <p className="text-sm text-corvus-muted text-center py-8">No decisions yet</p>
          ) : (
            <div className="space-y-2">
              <AnimatePresence mode="sync">
                {decisions.map((decision) => (
                  <DecisionCard
                    key={decision.id}
                    decision={decision}
                    onHighlight={onHighlight}
                    onEditDate={onEditDate}
                    compact
                  />
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    );
  }

  // Stacked layout: bordered section with optional max height
  return (
    <div
      className="border-t border-corvus-border bg-corvus-surface/50 flex flex-col shrink-0"
      style={{ maxHeight: maxHeight }}
    >
      {/* Header */}
      <div className="p-4 pb-2 shrink-0">
        <h3 className="text-sm font-semibold text-corvus-muted uppercase tracking-wider flex items-center gap-2">
          <span className="text-lg">🐦‍⬛</span>
          Muninn
          <span className="text-xs font-normal normal-case">
            — Decisions Made ({decisions.length})
          </span>
        </h3>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-4 pb-4">
        <div className="space-y-2">
          <AnimatePresence mode="sync">
            {decisions.map((decision) => (
              <DecisionCard
                key={decision.id}
                decision={decision}
                onHighlight={onHighlight}
                onEditDate={onEditDate}
              />
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

interface DecisionCardProps {
  decision: DecisionRecord;
  onHighlight?: (decision: DecisionRecord) => void;
  onEditDate?: (decisionId: string, newDate: number) => void;
  /** Compact mode for column layout */
  compact?: boolean;
}

// Obligation state display config
const obligationStateLabels: Record<string, { label: string; color: string }> = {
  todo: { label: "Todo", color: "text-red-400" },
  done: { label: "Done", color: "text-green-400" },
  "wont-do": { label: "Won't Do", color: "text-gray-400" },
  delegated: { label: "Delegated", color: "text-purple-400" },
  parked: { label: "Parked", color: "text-amber-400" },
};

function DecisionCard({ decision, onHighlight, onEditDate, compact }: DecisionCardProps) {
  const formattedDate = new Date(decision.decidedAt).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  const handleDateChange = (newDate: number) => {
    onEditDate?.(decision.id, newDate);
  };

  // Render path decision
  if (isPathDecision(decision)) {
    return (
      <motion.div
        layout
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={springConfig}
        onClick={() => onHighlight?.(decision)}
        className={`
          relative rounded-lg border border-corvus-border bg-corvus-bg
          cursor-pointer hover:border-corvus-accent/50
          transition-colors
          ${compact ? "p-2 pl-6" : "p-3 pl-8"}
        `}
      >
        <div className={`flex items-start ${compact ? "flex-col gap-1" : "justify-between gap-2"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col gap-0.5">
              <span className={`text-corvus-muted ${compact ? "text-[10px]" : "text-xs"}`}>
                {decision.forkTitle}
              </span>
              <span className={`text-corvus-text font-medium ${compact ? "text-xs" : "text-sm"}`}>
                → {decision.pathTitle}
              </span>
            </div>

            {decision.rationale && !compact && (
              <p className="text-xs text-corvus-muted mt-1 italic">
                &ldquo;{decision.rationale}&rdquo;
              </p>
            )}

            {decision.revisitsDecisionId && (
              <span className={`text-amber-400 ${compact ? "text-[10px]" : "text-xs"} mt-1`}>
                ↩ Revisits earlier decision
              </span>
            )}
          </div>

          <EditableDate
            date={decision.decidedAt}
            formattedDate={formattedDate}
            onDateChange={onEditDate ? handleDateChange : undefined}
            compact={compact}
          />
        </div>

        {/* Check icon */}
        <div className={`absolute ${compact ? "top-1.5 left-1.5" : "top-2 left-2"}`}>
          <svg
            width={compact ? "10" : "12"}
            height={compact ? "10" : "12"}
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            className="text-corvus-accent"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
      </motion.div>
    );
  }

  // Render obligation decision
  if (isObligationDecision(decision)) {
    const newStateConfig = obligationStateLabels[decision.newState] || {
      label: decision.newState,
      color: "text-corvus-muted",
    };

    return (
      <motion.div
        layout
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        exit={{ opacity: 0, x: 20 }}
        transition={springConfig}
        onClick={() => onHighlight?.(decision)}
        className={`
          relative rounded-lg border border-corvus-border bg-corvus-bg
          cursor-pointer hover:border-corvus-accent/50
          transition-colors
          ${compact ? "p-2 pl-6" : "p-3 pl-8"}
        `}
      >
        <div className={`flex items-start ${compact ? "flex-col gap-1" : "justify-between gap-2"}`}>
          <div className="flex-1 min-w-0">
            <div className="flex flex-col gap-0.5">
              <span className={`text-corvus-muted ${compact ? "text-[10px]" : "text-xs"}`}>
                {decision.obligationTitle}
              </span>
              <span
                className={`font-medium ${compact ? "text-xs" : "text-sm"} ${newStateConfig.color}`}
              >
                → {newStateConfig.label}
              </span>
            </div>

            {decision.notes && !compact && (
              <p className="text-xs text-corvus-muted mt-1 italic">
                &ldquo;{decision.notes}&rdquo;
              </p>
            )}
          </div>

          <EditableDate
            date={decision.decidedAt}
            formattedDate={formattedDate}
            onDateChange={onEditDate ? handleDateChange : undefined}
            compact={compact}
          />
        </div>

        {/* State-specific icon */}
        <div className={`absolute ${compact ? "top-1.5 left-1.5" : "top-2 left-2"}`}>
          <span className={`${newStateConfig.color} ${compact ? "text-[10px]" : "text-xs"}`}>
            {decision.newState === "done" && "✓"}
            {decision.newState === "wont-do" && "✕"}
            {decision.newState === "delegated" && "→"}
            {decision.newState === "parked" && "⏸"}
            {decision.newState === "todo" && "○"}
          </span>
        </div>
      </motion.div>
    );
  }

  // Fallback for unknown decision types
  return null;
}

interface EditableDateProps {
  date: number;
  formattedDate: string;
  onDateChange?: (newDate: number) => void;
  compact?: boolean;
}

function EditableDate({ date, formattedDate, onDateChange, compact }: EditableDateProps) {
  const [isEditing, setIsEditing] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  // Format date for input (YYYY-MM-DD)
  const inputValue = new Date(date).toISOString().split("T")[0];

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
    }
  }, [isEditing]);

  const handleClick = (e: React.MouseEvent) => {
    if (!onDateChange) return;
    e.stopPropagation(); // Don't trigger card's onHighlight
    setIsEditing(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newDate = new Date(e.target.value);
    if (!isNaN(newDate.getTime())) {
      // Preserve the time from the original date, just change the date part
      const originalDate = new Date(date);
      newDate.setHours(originalDate.getHours());
      newDate.setMinutes(originalDate.getMinutes());
      onDateChange?.(newDate.getTime());
    }
    setIsEditing(false);
  };

  const handleBlur = () => {
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        type="date"
        defaultValue={inputValue}
        onChange={handleChange}
        onBlur={handleBlur}
        onKeyDown={handleKeyDown}
        onClick={(e) => e.stopPropagation()}
        className={`
          bg-corvus-bg border border-corvus-accent rounded px-1
          text-corvus-text
          ${compact ? "text-xs" : "text-sm"}
        `}
      />
    );
  }

  return (
    <span
      onClick={handleClick}
      className={`
        text-corvus-muted whitespace-nowrap
        ${compact ? "text-xs" : "text-sm"}
        ${onDateChange ? "hover:text-corvus-accent hover:underline cursor-pointer" : ""}
      `}
      title={onDateChange ? "Click to edit date" : undefined}
    >
      {formattedDate}
    </span>
  );
}
