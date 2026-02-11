/**
 * State Engine - Pure functions for computing state changes from LLM responses.
 *
 * This module extracts the logic that transforms LLM responses into state mutations.
 * It's used by:
 * 1. The real app (page.tsx) to process responses
 * 2. The simulator to replay/compare recorded interactions
 *
 * All functions here are PURE - they don't mutate state or emit events.
 * They compute what WOULD happen and return it as data.
 */

import { nanoid } from "nanoid";
import type {
  LLMResponse,
  Entry,
  Fork,
  Path,
  Obligation,
  DecisionRecord,
  PathDecisionRecord,
  ObligationDecisionRecord,
  Phase,
  PathState,
} from "@/types";
import { isFork, isObligation } from "@/types";

// =============================================================================
// TYPES
// =============================================================================

/**
 * Context needed to process an LLM response.
 * This is what the LLM "saw" when it generated the response.
 */
export interface ProcessingContext {
  // Current state
  existingEntries: Entry[];

  // Message context
  userMessageId: string;
  conversationId: string;

  // Timestamp for recorded events (defaults to Date.now())
  timestamp?: number;
}

/**
 * A single computed state change.
 * These are the atomic operations that would be applied to state.
 */
export type StateChange =
  | { type: "fork_created"; fork: Fork }
  | { type: "fork_created_resolved"; fork: Fork; decision: PathDecisionRecord }
  | { type: "obligation_created"; obligation: Obligation }
  | {
      type: "obligation_created_resolved";
      obligation: Obligation;
      decision: ObligationDecisionRecord;
    }
  | { type: "path_chosen"; forkId: string; pathId: string; decision: PathDecisionRecord }
  | { type: "path_dismissed"; forkId: string; pathId: string }
  | { type: "message_linked"; messageId: string; entryIds: string[] };

/**
 * Result of processing an LLM response.
 * Contains all computed changes and the assistant message.
 */
export interface ProcessingResult {
  // State changes to apply
  changes: StateChange[];

  // New entries created (for linking to user message)
  createdEntryIds: string[];

  // Assistant message content
  assistantMessage: string;

  // Whether response had warnings
  hasWarning: boolean;
  warningMessage?: string;
}

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Normalize a title for comparison (lowercase, strip punctuation, collapse whitespace)
 */
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[?!.,;:'"()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Find an existing fork by normalized title.
 */
function findExistingFork(entries: Entry[], title: string): Fork | undefined {
  const normalized = normalizeTitle(title);
  return entries.find((e) => isFork(e) && normalizeTitle(e.title) === normalized) as
    | Fork
    | undefined;
}

/**
 * Find an existing obligation by normalized title.
 */
function findExistingObligation(entries: Entry[], title: string): Obligation | undefined {
  const normalized = normalizeTitle(title);
  return entries.find((e) => isObligation(e) && normalizeTitle(e.title) === normalized) as
    | Obligation
    | undefined;
}

/**
 * Find a fork by exact title (case-insensitive).
 */
function findForkByTitle(entries: Entry[], title: string): Fork | undefined {
  return entries.find((e) => isFork(e) && e.title.toLowerCase() === title.toLowerCase()) as
    | Fork
    | undefined;
}

/**
 * Find a path by title within a fork.
 */
function findPathByTitle(fork: Fork, title: string): Path | undefined {
  return fork.paths.find((p) => p.title.toLowerCase() === title.toLowerCase());
}

// =============================================================================
// CORE PROCESSING FUNCTION
// =============================================================================

/**
 * Process an LLM response and compute all state changes.
 *
 * This is a PURE function - it doesn't mutate anything.
 * It returns a ProcessingResult describing what changes would be made.
 *
 * @param response - The LLM response to process
 * @param context - Current state context
 * @returns Computed state changes and assistant message
 */
export function computeStateChanges(
  response: LLMResponse,
  context: ProcessingContext
): ProcessingResult {
  const changes: StateChange[] = [];
  const createdEntryIds: string[] = [];
  const now = context.timestamp ?? Date.now();

  // Track entries as we create them (for deduplication within this response)
  const entriesWithNew = [...context.existingEntries];

  // --- Process new forks ---
  if (response.forks) {
    for (const f of response.forks) {
      // Check for existing fork with same normalized title
      const existing = findExistingFork(entriesWithNew, f.title);
      if (existing) {
        // Skip duplicate - in real app we'd link message to existing
        continue;
      }

      const forkId = nanoid();
      const pathEntries: Path[] = f.paths.map((p) => ({
        id: nanoid(),
        type: "path" as const,
        title: p.title,
        why: p.why,
        phase: f.phase ?? "soon",
        category: f.category,
        state: "open" as PathState,
        forkId,
        recordedAt: now,
        decidedAt: now,
        linkedMessageIds: [context.userMessageId],
      }));

      const fork: Fork = {
        id: forkId,
        type: "fork",
        title: f.title,
        why: f.why,
        phase: f.phase ?? "soon",
        category: f.category,
        isBinary: f.isBinary,
        paths: pathEntries,
        recordedAt: now,
        decidedAt: now,
        linkedMessageIds: [context.userMessageId],
      };

      changes.push({ type: "fork_created", fork });
      createdEntryIds.push(fork.id);
      entriesWithNew.push(fork);
    }
  }

  // --- Process new obligations ---
  if (response.obligations) {
    for (const o of response.obligations) {
      // Check for existing obligation with same normalized title
      const existing = findExistingObligation(entriesWithNew, o.title);
      if (existing) {
        // Skip duplicate
        continue;
      }

      const obligation: Obligation = {
        id: nanoid(),
        type: "obligation",
        title: o.title,
        why: o.why,
        phase: o.phase ?? "soon",
        category: o.category,
        state: "todo",
        recordedAt: now,
        decidedAt: now,
        linkedMessageIds: [context.userMessageId],
      };

      changes.push({ type: "obligation_created", obligation });
      createdEntryIds.push(obligation.id);
      entriesWithNew.push(obligation);
    }
  }

  // --- Process path selections ---
  if (response.selections) {
    for (const sel of response.selections) {
      const fork = findForkByTitle(entriesWithNew, sel.forkTitle);
      if (!fork) continue;

      const path = findPathByTitle(fork, sel.chosenPathTitle);
      if (!path) continue;

      const decision: PathDecisionRecord = {
        id: nanoid(),
        kind: "path",
        pathId: path.id,
        forkId: fork.id,
        forkTitle: fork.title,
        pathTitle: path.title,
        rationale: sel.rationale,
        recordedAt: now,
        decidedAt: now,
        linkedMessageId: context.userMessageId,
        conversationId: context.conversationId,
      };

      changes.push({
        type: "path_chosen",
        forkId: fork.id,
        pathId: path.id,
        decision,
      });
    }
  }

  // --- Process path dismissals ---
  if (response.dismissals) {
    for (const d of response.dismissals) {
      const fork = findForkByTitle(entriesWithNew, d.forkTitle);
      if (!fork) continue;

      const path = findPathByTitle(fork, d.pathTitle);
      if (!path || path.state !== "open") continue;

      changes.push({
        type: "path_dismissed",
        forkId: fork.id,
        pathId: path.id,
      });
    }
  }

  // --- Process resolved forks (reconstruction mode) ---
  if (response.forks_resolved) {
    for (const f of response.forks_resolved) {
      // Check for existing fork
      const existing = findExistingFork(entriesWithNew, f.title);
      if (existing) continue;

      const forkId = nanoid();
      const chosenIndex = f.paths.findIndex(
        (p) => p.title.toLowerCase() === f.chosenPathTitle.toLowerCase()
      );
      if (chosenIndex === -1) continue;

      const pathEntries: Path[] = f.paths.map((p, i) => ({
        id: nanoid(),
        type: "path" as const,
        title: p.title,
        why: p.why,
        phase: "past" as Phase,
        category: f.category,
        state: i === chosenIndex ? ("chosen" as PathState) : ("dismissed" as PathState),
        forkId,
        recordedAt: now,
        decidedAt: now,
        chosenAt: i === chosenIndex ? now : undefined,
        chosenRationale: i === chosenIndex ? f.rationale : undefined,
        linkedMessageIds: [context.userMessageId],
      }));

      const fork: Fork = {
        id: forkId,
        type: "fork",
        title: f.title,
        why: f.why,
        phase: "past",
        category: f.category,
        paths: pathEntries,
        recordedAt: now,
        decidedAt: now,
        linkedMessageIds: [context.userMessageId],
      };

      const chosenPath = pathEntries[chosenIndex];
      const decision: PathDecisionRecord = {
        id: nanoid(),
        kind: "path",
        pathId: chosenPath.id,
        forkId,
        forkTitle: f.title,
        pathTitle: chosenPath.title,
        rationale: f.rationale,
        recordedAt: now,
        decidedAt: now,
        linkedMessageId: context.userMessageId,
        conversationId: context.conversationId,
      };

      changes.push({ type: "fork_created_resolved", fork, decision });
      createdEntryIds.push(fork.id);
      entriesWithNew.push(fork);
    }
  }

  // --- Process resolved obligations (reconstruction mode) ---
  if (response.obligations_resolved) {
    for (const o of response.obligations_resolved) {
      // Check for existing obligation
      const existing = findExistingObligation(entriesWithNew, o.title);
      if (existing) continue;

      const obligation: Obligation = {
        id: nanoid(),
        type: "obligation",
        title: o.title,
        why: o.why,
        phase: "past",
        category: o.category,
        state: o.state,
        notes: o.notes,
        stateChangedAt: now,
        recordedAt: now,
        decidedAt: now,
        linkedMessageIds: [context.userMessageId],
      };

      const decision: ObligationDecisionRecord = {
        id: nanoid(),
        kind: "obligation",
        obligationId: obligation.id,
        obligationTitle: o.title,
        previousState: "todo",
        newState: o.state,
        notes: o.notes,
        recordedAt: now,
        decidedAt: now,
        linkedMessageId: context.userMessageId,
        conversationId: context.conversationId,
      };

      changes.push({ type: "obligation_created_resolved", obligation, decision });
      createdEntryIds.push(obligation.id);
      entriesWithNew.push(obligation);
    }
  }

  // --- Link message to created entries ---
  if (createdEntryIds.length > 0) {
    changes.push({
      type: "message_linked",
      messageId: context.userMessageId,
      entryIds: createdEntryIds,
    });
  }

  // --- Build assistant message ---
  let assistantMessage = response.assistant_message || "";

  // Add warning indicator if response was degraded
  const hasWarning = !!response._warning;
  if (hasWarning) {
    assistantMessage = `⚠️ ${assistantMessage}`;
  }

  return {
    changes,
    createdEntryIds,
    assistantMessage,
    hasWarning,
    warningMessage: response._warning,
  };
}

// =============================================================================
// CHANGE APPLICATION (for reference/testing)
// =============================================================================

/**
 * Apply a single state change to entries array.
 * Returns a new array (immutable).
 *
 * Note: This is a simplified version for the simulator.
 * The real app uses the store functions which also emit events.
 */
export function applyChangeToEntries(entries: Entry[], change: StateChange): Entry[] {
  switch (change.type) {
    case "fork_created":
    case "fork_created_resolved":
      return [...entries, change.fork];

    case "obligation_created":
    case "obligation_created_resolved":
      return [...entries, change.obligation];

    case "path_chosen":
      return entries.map((e) => {
        if (!isFork(e) || e.id !== change.forkId) return e;
        return {
          ...e,
          paths: e.paths.map((p) => {
            if (p.id === change.pathId) {
              return { ...p, state: "chosen" as PathState };
            } else if (p.state === "open") {
              return { ...p, state: "dismissed" as PathState };
            }
            return p;
          }),
        };
      });

    case "path_dismissed":
      return entries.map((e) => {
        if (!isFork(e) || e.id !== change.forkId) return e;
        return {
          ...e,
          paths: e.paths.map((p) => {
            if (p.id === change.pathId) {
              return { ...p, state: "dismissed" as PathState };
            }
            return p;
          }),
        };
      });

    default:
      return entries;
  }
}

/**
 * Collect all decisions from a list of state changes.
 */
export function collectDecisions(changes: StateChange[]): DecisionRecord[] {
  const decisions: DecisionRecord[] = [];

  for (const change of changes) {
    switch (change.type) {
      case "path_chosen":
        decisions.push(change.decision);
        break;
      case "fork_created_resolved":
        decisions.push(change.decision);
        break;
      case "obligation_created_resolved":
        decisions.push(change.decision);
        break;
    }
  }

  return decisions;
}
