"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import type { Entry, Fork, Path, Obligation, Phase, ObligationState } from "@/types";
import { isFork, isObligation } from "@/types";

interface TimelineProps {
  entries: Entry[];
  onChoosePath?: (forkId: string, pathId: string) => void;
  onDismissPath?: (forkId: string, pathId: string) => void;
  onReopenPath?: (forkId: string, pathId: string) => void;
  onChangeObligationState?: (
    obligationId: string,
    newState: ObligationState,
    notes?: string
  ) => void;
  onUpdateObligationNotes?: (obligationId: string, notes: string) => void;
  // Entry interaction actions
  onAskAbout?: (entry: Entry) => void;
  onNewDiscussion?: (entry: Entry) => void;
  onWhatIf?: (fork: Fork) => void;
}

// Sort entries by phase, then by decidedAt
function sortEntries(entries: Entry[]): Entry[] {
  const phaseOrder: Record<Phase, number> = { past: 0, now: 1, soon: 2, "parking-lot": 3 };

  return [...entries].sort((a, b) => {
    const phaseDiff = phaseOrder[a.phase] - phaseOrder[b.phase];
    if (phaseDiff !== 0) return phaseDiff;
    return a.decidedAt - b.decidedAt;
  });
}

// Spring config for smooth animations
const spring = {
  type: "spring" as const,
  stiffness: 400,
  damping: 30,
};

export function Timeline({
  entries,
  onChoosePath,
  onDismissPath,
  onReopenPath,
  onChangeObligationState,
  onUpdateObligationNotes,
  onAskAbout,
  onNewDiscussion,
  onWhatIf,
}: TimelineProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showLegend, setShowLegend] = useState(true);
  const [showPast, setShowPast] = useState(false);

  const sortedEntries = sortEntries(entries);

  // Separate past entries for collapsible section
  const pastEntries = sortedEntries.filter((e) => e.phase === "past");
  const activeEntries = sortedEntries.filter((e) => e.phase !== "past");

  // Generate tick marks (unitless time intervals)
  const tickCount = Math.max(8, Math.ceil(entries.length * 1.5));

  return (
    <div className="flex-1 overflow-y-auto relative">
      {/* Legend */}
      <Legend isOpen={showLegend} onToggle={() => setShowLegend(!showLegend)} />

      <div className="relative min-h-full py-8 pl-24 pr-8">
        {/* Vertical spine */}
        <div className="absolute left-20 top-0 bottom-0 w-px bg-gradient-to-b from-corvus-border via-corvus-accent/30 to-corvus-border" />

        {/* Tick marks */}
        <div className="absolute left-16 top-8 bottom-8 flex flex-col justify-between pointer-events-none">
          {Array.from({ length: tickCount }).map((_, i) => (
            <div
              key={i}
              className="flex items-center"
              style={{ opacity: 0.3 + (i % 3 === 0 ? 0.3 : 0) }}
            >
              <div className={`h-px bg-corvus-muted ${i % 3 === 0 ? "w-4" : "w-2"}`} />
            </div>
          ))}
        </div>

        {/* Phase markers on spine */}
        <PhaseMarkers entries={sortedEntries} />

        {/* Past entries (collapsible) */}
        {pastEntries.length > 0 && (
          <div className="relative ml-8 mb-4">
            <button
              onClick={() => setShowPast(!showPast)}
              className="flex items-center gap-2 text-xs text-corvus-muted hover:text-corvus-text transition-colors mb-2"
            >
              <motion.svg
                animate={{ rotate: showPast ? 90 : 0 }}
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <polyline points="9 18 15 12 9 6" />
              </motion.svg>
              Past ({pastEntries.length})
            </button>
            <AnimatePresence>
              {showPast && (
                <motion.div
                  initial={{ height: 0, opacity: 0 }}
                  animate={{ height: "auto", opacity: 1 }}
                  exit={{ height: 0, opacity: 0 }}
                  transition={{ duration: 0.2 }}
                  className="overflow-hidden"
                >
                  <div className="space-y-2 opacity-60">
                    <AnimatePresence mode="sync">
                      {pastEntries.map((entry, index) => {
                        if (isFork(entry)) {
                          return (
                            <ForkBubble
                              key={entry.id}
                              fork={entry}
                              isExpanded={expandedId === entry.id}
                              onToggle={() =>
                                setExpandedId(expandedId === entry.id ? null : entry.id)
                              }
                              onChoosePath={onChoosePath}
                              onDismissPath={onDismissPath}
                              onReopenPath={onReopenPath}
                              onAskAbout={onAskAbout}
                              onNewDiscussion={onNewDiscussion}
                              onWhatIf={onWhatIf}
                              index={index}
                            />
                          );
                        } else if (isObligation(entry)) {
                          return (
                            <ObligationBubble
                              key={entry.id}
                              obligation={entry}
                              isExpanded={expandedId === entry.id}
                              onToggle={() =>
                                setExpandedId(expandedId === entry.id ? null : entry.id)
                              }
                              onChangeState={onChangeObligationState}
                              onUpdateNotes={onUpdateObligationNotes}
                              onAskAbout={onAskAbout}
                              onNewDiscussion={onNewDiscussion}
                              index={index}
                            />
                          );
                        }
                        return null;
                      })}
                    </AnimatePresence>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Active timeline entries */}
        <div className="relative ml-8 space-y-2">
          <AnimatePresence mode="sync">
            {activeEntries.map((entry, index) => {
              if (isFork(entry)) {
                return (
                  <ForkBubble
                    key={entry.id}
                    fork={entry}
                    isExpanded={expandedId === entry.id}
                    onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    onChoosePath={onChoosePath}
                    onDismissPath={onDismissPath}
                    onReopenPath={onReopenPath}
                    onAskAbout={onAskAbout}
                    onNewDiscussion={onNewDiscussion}
                    onWhatIf={onWhatIf}
                    index={index}
                  />
                );
              } else if (isObligation(entry)) {
                return (
                  <ObligationBubble
                    key={entry.id}
                    obligation={entry}
                    isExpanded={expandedId === entry.id}
                    onToggle={() => setExpandedId(expandedId === entry.id ? null : entry.id)}
                    onChangeState={onChangeObligationState}
                    onUpdateNotes={onUpdateObligationNotes}
                    onAskAbout={onAskAbout}
                    onNewDiscussion={onNewDiscussion}
                    index={index}
                  />
                );
              }
              return null;
            })}
          </AnimatePresence>
        </div>

        {/* Empty state */}
        {entries.length === 0 && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="absolute inset-0 flex items-center justify-center"
          >
            <div className="text-center text-corvus-muted ml-8">
              <p className="text-lg mb-2">Timeline empty</p>
              <p className="text-sm">Start with Huginn →</p>
            </div>
          </motion.div>
        )}
      </div>
    </div>
  );
}

// Phase markers shown on the spine
function PhaseMarkers({ entries }: { entries: Entry[] }) {
  // Only show markers for active phases (past is in collapsible section)
  const phases: Phase[] = ["now", "soon", "parking-lot"];
  const phaseLabels: Record<Phase, string> = {
    past: "Past",
    now: "Now",
    soon: "Soon",
    "parking-lot": "Parked",
  };

  // Calculate which phases have entries
  const presentPhases = new Set(entries.map((e) => e.phase));

  // Calculate approximate positions
  let currentIndex = 0;
  const positions: { phase: Phase; index: number }[] = [];

  for (const phase of phases) {
    if (presentPhases.has(phase)) {
      positions.push({ phase, index: currentIndex });
      currentIndex += entries.filter((e) => e.phase === phase).length;
    }
  }

  if (positions.length === 0) return null;

  return (
    <>
      {positions.map(({ phase, index }) => (
        <motion.div
          key={phase}
          initial={{ opacity: 0, x: -10 }}
          animate={{ opacity: 1, x: 0 }}
          className="absolute left-2 flex items-center"
          style={{ top: `${32 + index * 52}px` }}
        >
          <span className="text-[10px] font-semibold text-corvus-muted uppercase tracking-wider">
            {phaseLabels[phase]}
          </span>
          <div className="ml-2 w-2 h-2 rounded-full bg-corvus-accent/50" />
        </motion.div>
      ))}
    </>
  );
}

// =============================================================================
// FORK BUBBLE
// =============================================================================

interface ForkBubbleProps {
  fork: Fork;
  isExpanded: boolean;
  onToggle: () => void;
  onChoosePath?: (forkId: string, pathId: string) => void;
  onDismissPath?: (forkId: string, pathId: string) => void;
  onReopenPath?: (forkId: string, pathId: string) => void;
  onAskAbout?: (entry: Entry) => void;
  onNewDiscussion?: (entry: Entry) => void;
  onWhatIf?: (fork: Fork) => void;
  index: number;
}

function ForkBubble({
  fork,
  isExpanded,
  onToggle,
  onChoosePath,
  onDismissPath,
  onReopenPath,
  onAskAbout,
  onNewDiscussion,
  onWhatIf,
  index,
}: ForkBubbleProps) {
  const truncatedTitle = fork.title.length > 28 ? fork.title.slice(0, 28) + "…" : fork.title;

  // Check if any path is chosen
  const chosenPath = fork.paths.find((p) => p.state === "chosen");
  const openPaths = fork.paths.filter((p) => p.state === "open");
  const hasDecision = !!chosenPath;

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, scale: 0.9 }}
      transition={spring}
      className="relative flex items-start"
    >
      {/* Connection line to spine */}
      <svg className="absolute -left-8 top-3 w-8 h-4 overflow-visible">
        <motion.path
          d="M 0 8 Q 16 8 32 8"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          className={hasDecision ? "text-corvus-accent" : "text-blue-400/60"}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        />
        {/* Fork dot on spine */}
        <circle
          cx="0"
          cy="8"
          r="3"
          className={hasDecision ? "fill-corvus-accent" : "fill-blue-400"}
        />
      </svg>

      {/* Bubble */}
      <motion.div
        layout
        className={`
          relative text-left rounded-lg transition-colors
          ${isExpanded ? "bg-corvus-surface border-2" : "bg-corvus-surface/60 border"}
          ${
            hasDecision
              ? "border-corvus-accent shadow-lg shadow-corvus-accent/10"
              : "border-blue-400/50"
          }
        `}
      >
        {/* Header - always clickable */}
        <div className="group/entry">
          <motion.div layout={false} className="w-full px-3 py-2 flex items-center gap-2">
            <button onClick={onToggle} className="flex items-center gap-2 flex-1 text-left">
              <span
                className={`w-2 h-2 rounded-full ${hasDecision ? "bg-amber-400" : "bg-blue-400"}`}
              />
              <span className="text-sm text-corvus-text flex-1">
                {isExpanded ? fork.title : truncatedTitle}
              </span>
            </button>

            {/* Hover-reveal action icons */}
            <div className="flex items-center gap-1">
              <div className="hidden group-hover/entry:flex items-center gap-1 mr-2">
                {onAskAbout && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAskAbout(fork);
                    }}
                    className="p-1 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/10"
                    title="Ask about this"
                  >
                    <ChatIcon />
                  </button>
                )}
                {onNewDiscussion && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewDiscussion(fork);
                    }}
                    className="p-1 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/10"
                    title="New discussion"
                  >
                    <ChatPlusIcon />
                  </button>
                )}
                {hasDecision && onWhatIf && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onWhatIf(fork);
                    }}
                    className="p-1 text-amber-400/70 hover:text-amber-400 transition-colors rounded hover:bg-white/10"
                    title="Explore alternatives"
                  >
                    <BranchIcon />
                  </button>
                )}
              </div>
              <span className="text-xs text-corvus-muted">
                {hasDecision ? "✓" : `${openPaths.length} paths`}
              </span>
            </div>
          </motion.div>
        </div>

        {/* Expanded view with paths */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-corvus-border/50"
            >
              <div className="p-3 space-y-2">
                <p className="text-xs text-corvus-muted mb-2">{fork.why}</p>

                {fork.paths.map((path) => {
                  // Determine if this is the current choice (most recent chosenAt)
                  const chosenPaths = fork.paths.filter((p) => p.state === "chosen");
                  const currentChoiceId =
                    chosenPaths.length > 0
                      ? chosenPaths.reduce((latest, p) =>
                          (p.chosenAt ?? 0) > (latest.chosenAt ?? 0) ? p : latest
                        ).id
                      : null;

                  return (
                    <PathItem
                      key={path.id}
                      path={path}
                      forkId={fork.id}
                      isCurrentChoice={path.id === currentChoiceId}
                      hasPreviousChoices={chosenPaths.length > 1}
                      onChoose={onChoosePath}
                      onDismiss={onDismissPath}
                      onReopen={onReopenPath}
                    />
                  );
                })}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// Individual path item within a fork
interface PathItemProps {
  path: Path;
  forkId: string;
  isCurrentChoice?: boolean;
  hasPreviousChoices?: boolean;
  onChoose?: (forkId: string, pathId: string) => void;
  onDismiss?: (forkId: string, pathId: string) => void;
  onReopen?: (forkId: string, pathId: string) => void;
}

function PathItem({
  path,
  forkId,
  isCurrentChoice,
  hasPreviousChoices: _hasPreviousChoices,
  onChoose,
  onDismiss,
  onReopen,
}: PathItemProps) {
  // Determine styling based on state and whether it's current choice
  const getPathStyles = () => {
    if (path.state === "open") {
      return "bg-corvus-bg/50 border-corvus-border hover:border-blue-400/50";
    }
    if (path.state === "dismissed") {
      return "bg-corvus-bg/30 border-corvus-border/30 opacity-50";
    }
    // chosen state
    if (isCurrentChoice) {
      return "bg-corvus-accent/10 border-corvus-accent";
    }
    // Previous choice - dimmed
    return "bg-corvus-bg/30 border-corvus-muted/50 opacity-70";
  };

  return (
    <motion.div
      layout
      className={`
        p-2 rounded border text-sm transition-colors
        ${getPathStyles()}
      `}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1">
          <span
            className={
              path.state === "dismissed" ? "line-through text-corvus-muted" : "text-corvus-text"
            }
          >
            {path.title}
          </span>
          {path.state === "chosen" &&
            (isCurrentChoice ? (
              <span className="ml-2 text-xs text-corvus-accent font-semibold">✓ Chosen</span>
            ) : (
              <span className="ml-2 text-xs text-corvus-muted">Previous</span>
            ))}
        </div>

        {/* Action buttons */}
        <div className="flex gap-1">
          {path.state === "open" && (
            <>
              {onChoose && (
                <button
                  onClick={() => onChoose(forkId, path.id)}
                  className="px-2 py-0.5 text-xs rounded bg-corvus-accent/20 text-corvus-accent hover:bg-corvus-accent/30"
                >
                  Choose
                </button>
              )}
              {onDismiss && (
                <button
                  onClick={() => onDismiss(forkId, path.id)}
                  className="px-2 py-0.5 text-xs rounded bg-corvus-muted/20 text-corvus-muted hover:bg-corvus-muted/30"
                >
                  ✕
                </button>
              )}
            </>
          )}
          {path.state === "dismissed" && onReopen && (
            <button
              onClick={() => onReopen(forkId, path.id)}
              className="px-2 py-0.5 text-xs rounded bg-corvus-muted/20 text-corvus-muted hover:bg-corvus-muted/30"
            >
              Reopen
            </button>
          )}
        </div>
      </div>

      {path.why && path.state !== "dismissed" && (
        <p className="text-xs text-corvus-muted mt-1">{path.why}</p>
      )}

      {path.state === "chosen" && path.chosenRationale && (
        <p className="text-xs text-corvus-accent/80 mt-1 italic">
          &ldquo;{path.chosenRationale}&rdquo;
        </p>
      )}
    </motion.div>
  );
}

// =============================================================================
// OBLIGATION BUBBLE
// =============================================================================

interface ObligationBubbleProps {
  obligation: Obligation;
  isExpanded: boolean;
  onToggle: () => void;
  onChangeState?: (obligationId: string, newState: ObligationState, notes?: string) => void;
  onUpdateNotes?: (obligationId: string, notes: string) => void;
  onAskAbout?: (entry: Entry) => void;
  onNewDiscussion?: (entry: Entry) => void;
  index: number;
}

// State styling configuration
const stateConfig: Record<
  ObligationState,
  {
    color: string;
    bgColor: string;
    borderColor: string;
    label: string;
    icon: string;
  }
> = {
  todo: {
    color: "text-red-400",
    bgColor: "bg-red-500/20",
    borderColor: "border-red-400/50",
    label: "Todo",
    icon: "○",
  },
  done: {
    color: "text-green-400",
    bgColor: "bg-green-500/20",
    borderColor: "border-green-400/50",
    label: "Done",
    icon: "✓",
  },
  "wont-do": {
    color: "text-gray-400",
    bgColor: "bg-gray-500/20",
    borderColor: "border-gray-400/50",
    label: "Won't Do",
    icon: "✕",
  },
  delegated: {
    color: "text-purple-400",
    bgColor: "bg-purple-500/20",
    borderColor: "border-purple-400/50",
    label: "Delegated",
    icon: "→",
  },
  parked: {
    color: "text-amber-400",
    bgColor: "bg-amber-500/20",
    borderColor: "border-amber-400/50",
    label: "Parked",
    icon: "⏸",
  },
};

function ObligationBubble({
  obligation,
  isExpanded,
  onToggle,
  onChangeState,
  onUpdateNotes,
  onAskAbout,
  onNewDiscussion,
  index,
}: ObligationBubbleProps) {
  const [isEditingNotes, setIsEditingNotes] = useState(false);
  const [notesValue, setNotesValue] = useState(obligation.notes || "");

  const truncatedTitle =
    obligation.title.length > 28 ? obligation.title.slice(0, 28) + "…" : obligation.title;

  const currentState = obligation.state || "todo";
  const config = stateConfig[currentState];
  const isTerminal = currentState !== "todo";

  const handleStateChange = (newState: ObligationState) => {
    onChangeState?.(obligation.id, newState);
  };

  const handleSaveNotes = () => {
    onUpdateNotes?.(obligation.id, notesValue);
    setIsEditingNotes(false);
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, x: 20 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -20, scale: 0.9 }}
      transition={spring}
      className="relative flex items-start"
    >
      {/* Connection line to spine */}
      <svg className="absolute -left-8 top-3 w-8 h-4 overflow-visible">
        <motion.path
          d="M 0 8 Q 16 8 32 8"
          stroke="currentColor"
          strokeWidth="1.5"
          fill="none"
          className={config.color.replace("text-", "text-") + "/60"}
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.3, delay: index * 0.02 }}
        />
        <circle cx="0" cy="8" r="3" className={config.color.replace("text-", "fill-")} />
      </svg>

      {/* Bubble */}
      <motion.div
        layout
        className={`
          relative text-left rounded-lg transition-colors
          ${
            isExpanded
              ? `bg-corvus-surface border-2 ${config.borderColor}`
              : `bg-corvus-surface/60 border ${config.borderColor.replace("/50", "/30")}`
          }
        `}
      >
        {/* Header - always clickable */}
        <div className="group/entry">
          <motion.div layout={false} className="w-full px-3 py-2 flex items-center gap-2">
            <button onClick={onToggle} className="flex items-center gap-2 flex-1 text-left">
              <span className={`w-2 h-2 rounded-full ${config.color.replace("text-", "bg-")}`} />
              <span
                className={`text-sm flex-1 ${isTerminal ? "text-corvus-muted" : "text-corvus-text"}`}
              >
                {isExpanded ? obligation.title : truncatedTitle}
              </span>
            </button>

            {/* Hover-reveal action icons */}
            <div className="flex items-center gap-1">
              <div className="hidden group-hover/entry:flex items-center gap-1 mr-2">
                {onAskAbout && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onAskAbout(obligation);
                    }}
                    className="p-1 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/10"
                    title="Ask about this"
                  >
                    <ChatIcon />
                  </button>
                )}
                {onNewDiscussion && (
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onNewDiscussion(obligation);
                    }}
                    className="p-1 text-corvus-muted hover:text-corvus-text transition-colors rounded hover:bg-white/10"
                    title="New discussion"
                  >
                    <ChatPlusIcon />
                  </button>
                )}
              </div>
              <span className={`text-xs ${config.color}`}>{config.icon}</span>
            </div>
          </motion.div>
        </div>

        {/* Expanded view */}
        <AnimatePresence>
          {isExpanded && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden border-t border-corvus-border/50"
            >
              <div className="p-3 min-w-[280px] max-w-[400px]">
                {/* State badge and category */}
                <div className="flex items-center gap-2 mb-2">
                  <span
                    className={`text-xs px-2 py-0.5 rounded-full ${config.bgColor} ${config.color}`}
                  >
                    {config.label}
                  </span>
                  {obligation.category && (
                    <span className="text-xs text-corvus-muted">{obligation.category}</span>
                  )}
                </div>

                {/* Why */}
                <p className="text-sm text-corvus-muted mb-3">{obligation.why}</p>

                {/* Notes section */}
                <div className="mb-3">
                  {isEditingNotes ? (
                    <div className="space-y-2">
                      <textarea
                        value={notesValue}
                        onChange={(e) => setNotesValue(e.target.value)}
                        placeholder="Add notes..."
                        className="w-full px-2 py-1.5 text-xs bg-corvus-bg border border-corvus-border rounded resize-none focus:outline-none focus:border-corvus-accent"
                        rows={3}
                        autoFocus
                      />
                      <div className="flex gap-2">
                        <button
                          onClick={handleSaveNotes}
                          className="px-2 py-1 text-xs rounded bg-corvus-accent/20 text-corvus-accent hover:bg-corvus-accent/30"
                        >
                          Save
                        </button>
                        <button
                          onClick={() => {
                            setNotesValue(obligation.notes || "");
                            setIsEditingNotes(false);
                          }}
                          className="px-2 py-1 text-xs rounded bg-corvus-muted/20 text-corvus-muted hover:bg-corvus-muted/30"
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button
                      onClick={() => setIsEditingNotes(true)}
                      className="text-xs text-corvus-muted hover:text-corvus-text transition-colors"
                    >
                      {obligation.notes ? (
                        <span className="italic">&ldquo;{obligation.notes}&rdquo;</span>
                      ) : (
                        "+ Add notes"
                      )}
                    </button>
                  )}
                </div>

                {/* State change buttons */}
                {onChangeState && (
                  <div className="flex flex-wrap gap-1.5 pt-2 border-t border-corvus-border/30">
                    {currentState !== "done" && (
                      <button
                        onClick={() => handleStateChange("done")}
                        className="px-2 py-1 text-xs rounded bg-green-500/20 text-green-400 hover:bg-green-500/30"
                      >
                        Done
                      </button>
                    )}
                    {currentState !== "parked" && (
                      <button
                        onClick={() => handleStateChange("parked")}
                        className="px-2 py-1 text-xs rounded bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
                      >
                        Park
                      </button>
                    )}
                    {currentState !== "delegated" && (
                      <button
                        onClick={() => handleStateChange("delegated")}
                        className="px-2 py-1 text-xs rounded bg-purple-500/20 text-purple-400 hover:bg-purple-500/30"
                      >
                        Delegate
                      </button>
                    )}
                    {currentState !== "wont-do" && (
                      <button
                        onClick={() => handleStateChange("wont-do")}
                        className="px-2 py-1 text-xs rounded bg-gray-500/20 text-gray-400 hover:bg-gray-500/30"
                      >
                        Won&apos;t Do
                      </button>
                    )}
                    {currentState !== "todo" && (
                      <button
                        onClick={() => handleStateChange("todo")}
                        className="px-2 py-1 text-xs rounded bg-corvus-muted/20 text-corvus-muted hover:bg-corvus-muted/30"
                      >
                        Reopen
                      </button>
                    )}
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}

// Collapsible legend
function Legend({ isOpen, onToggle }: { isOpen: boolean; onToggle: () => void }) {
  return (
    <div className="absolute top-4 right-4 z-10">
      <motion.div
        initial={false}
        animate={{ width: isOpen ? "auto" : "auto" }}
        className="bg-corvus-surface/95 backdrop-blur-sm border border-corvus-border rounded-lg overflow-hidden"
      >
        {/* Header / Toggle */}
        <button
          onClick={onToggle}
          className="w-full px-3 py-2 flex items-center justify-between gap-4 text-xs font-medium text-corvus-muted hover:text-corvus-text transition-colors"
        >
          <span>Legend</span>
          <motion.svg
            animate={{ rotate: isOpen ? 180 : 0 }}
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <polyline points="6 9 12 15 18 9" />
          </motion.svg>
        </button>

        {/* Content */}
        <AnimatePresence>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: "auto", opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="border-t border-corvus-border"
            >
              <div className="px-3 py-2 space-y-2">
                {/* Fork states */}
                <div className="text-[10px] font-semibold text-corvus-muted uppercase tracking-wider mb-1">
                  Fork
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-blue-400" />
                  <span className="text-xs text-corvus-text">Open</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs text-corvus-text">Decided</span>
                </div>

                {/* Obligation states */}
                <div className="text-[10px] font-semibold text-corvus-muted uppercase tracking-wider mt-3 mb-1">
                  Obligation
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-red-400" />
                  <span className="text-xs text-corvus-text">Todo</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-green-400" />
                  <span className="text-xs text-corvus-text">Done</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-amber-400" />
                  <span className="text-xs text-corvus-text">Parked</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-purple-400" />
                  <span className="text-xs text-corvus-text">Delegated</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-gray-400" />
                  <span className="text-xs text-corvus-text">Won&apos;t Do</span>
                </div>

                {/* Path states */}
                <div className="text-[10px] font-semibold text-corvus-muted uppercase tracking-wider mt-3 mb-1">
                  Path State
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-2 rounded border border-corvus-border bg-corvus-bg/50" />
                  <span className="text-xs text-corvus-text">Open</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-2 rounded border border-corvus-accent bg-corvus-accent/10" />
                  <span className="text-xs text-corvus-text">Chosen</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4 h-2 rounded border border-corvus-border/30 bg-corvus-bg/30 opacity-50" />
                  <span className="text-xs text-corvus-text opacity-50">Dismissed</span>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </div>
  );
}

// =============================================================================
// ICONS
// =============================================================================

function ChatIcon() {
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  );
}

function ChatPlusIcon() {
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
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
      <line x1="12" y1="8" x2="12" y2="14" />
      <line x1="9" y1="11" x2="15" y2="11" />
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
