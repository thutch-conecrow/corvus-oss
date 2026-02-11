// =============================================================================
// CORE TYPES
// =============================================================================

// Timeline phases
export type Phase = "past" | "now" | "soon" | "parking-lot";

// Path state within a Fork
export type PathState = "open" | "dismissed" | "chosen";

// Obligation state
export type ObligationState = "todo" | "done" | "wont-do" | "delegated" | "parked";

// =============================================================================
// TIMELINE ENTRIES (Tree Structure)
// =============================================================================

// Base for all timeline entries
interface BaseEntry {
  id: string;
  title: string;
  why: string; // Short explanation
  phase: Phase;
  category?: string;
  // Two notions of time
  recordedAt: number; // When written to system (immutable)
  decidedAt: number; // When user says it happened (mutable)
  // Links to chat
  linkedMessageIds?: string[];
  // Rule engine trigger
  triggeredBy?: string[];
  // Tags (two-tier: LLM-extracted vs user-defined)
  inferredTags?: string[]; // Tags extracted by LLM from conversation
  userTags?: string[]; // Tags added manually by user
}

// An obligation - something that must be done
export interface Obligation extends BaseEntry {
  type: "obligation";
  state: ObligationState;
  notes?: string;
  stateChangedAt?: number;
}

// A path within a fork - one possible choice
export interface Path extends BaseEntry {
  type: "path";
  state: PathState;
  forkId: string; // Parent fork
  // If chosen, when and why
  chosenAt?: number;
  chosenRationale?: string;
  // If revisiting a previous choice, reference to original
  revisitsPathId?: string;
}

// A fork - a decision point with multiple paths
export interface Fork extends BaseEntry {
  type: "fork";
  paths: Path[];
  // Is this a binary yes/no fork?
  isBinary?: boolean;
}

// Union type for all entry types
export type Entry = Obligation | Fork | Path;

// Type guards
export function isObligation(entry: Entry): entry is Obligation {
  return entry.type === "obligation";
}

export function isFork(entry: Entry): entry is Fork {
  return entry.type === "fork";
}

export function isPath(entry: Entry): entry is Path {
  return entry.type === "path";
}

// =============================================================================
// CHAT (Tree Structure)
// =============================================================================

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  // Two notions of time
  recordedAt: number;
  // Tree structure
  parentId?: string; // null/undefined = root level
  childIds: string[];
  // Links to entries
  linkedEntryIds?: string[];
  // Error flag - true if this is an error response that can be retried
  isError?: boolean;
}

// =============================================================================
// CONVERSATIONS
// =============================================================================

export type ConversationType = "live" | "isolated" | "read-only";

// Branch lifecycle status (git semantics)
// - active: Branch is currently being worked on
// - merged: Branch changes have been merged to main
// - abandoned: Branch was explicitly abandoned (user decided not to pursue)
// - reverted: Branch was merged but later reverted
export type BranchStatus = "active" | "merged" | "abandoned" | "reverted";

// Branch origin info for isolated conversations
export interface BranchOrigin {
  conversationId: string;
  timestamp: number;
  entrySnapshot: Entry[];
  sourceMessageId?: string; // The divergence point message (not copied into branch)
}

export interface Conversation {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  currentChatPath: string[];
  type: ConversationType;
  // For isolated conversations (branches)
  branchedFrom?: BranchOrigin;
  // Local modifications (only for isolated)
  localEntries?: Entry[];
  localDecisions?: DecisionRecord[];
  // When the branch was merged back to main (undefined = not merged)
  mergedAt?: number;
  // Branch lifecycle status (optional for backward compat, defaults to 'active')
  // For 'live' conversations, status is always 'active'
  // For 'isolated' conversations, status tracks the branch lifecycle
  status?: BranchStatus;
}

// =============================================================================
// DECISION LOG (Muninn)
// =============================================================================

// A decision about a fork path
export interface PathDecisionRecord {
  id: string;
  kind: "path";
  pathId: string; // The path that was chosen
  forkId: string; // The fork it belongs to
  forkTitle: string; // Denormalized for display
  pathTitle: string; // Denormalized for display
  rationale: string;
  recordedAt: number; // When recorded in ledger
  decidedAt: number; // When user says they decided
  // If this revisits a previous decision
  revisitsDecisionId?: string;
  // Message that triggered this decision
  linkedMessageId?: string;
  // Conversation where this decision was made
  conversationId: string;
}

// A decision about an obligation's state
export interface ObligationDecisionRecord {
  id: string;
  kind: "obligation";
  obligationId: string;
  obligationTitle: string; // Denormalized for display
  previousState: ObligationState;
  newState: ObligationState;
  notes?: string; // Notes provided with the state change
  recordedAt: number;
  decidedAt: number;
  linkedMessageId?: string;
  // Conversation where this decision was made
  conversationId: string;
}

// Union type for all decision types
export type DecisionRecord = PathDecisionRecord | ObligationDecisionRecord;

// Type guards for decisions
export function isPathDecision(decision: DecisionRecord): decision is PathDecisionRecord {
  return decision.kind === "path";
}

export function isObligationDecision(
  decision: DecisionRecord
): decision is ObligationDecisionRecord {
  return decision.kind === "obligation";
}

// =============================================================================
// LLM RESPONSE SCHEMA
// =============================================================================

export interface LLMResponse {
  // New forks with paths (open/undecided)
  forks?: Array<{
    title: string;
    why: string;
    category?: string;
    phase?: Phase;
    isBinary?: boolean;
    paths: Array<{
      title: string;
      why: string;
    }>;
  }>;
  // New standalone obligations (open/todo)
  obligations?: Array<{
    title: string;
    why: string;
    category?: string;
    phase?: Phase;
  }>;
  // Pre-resolved forks (reconstruction mode - decisions already made)
  forks_resolved?: Array<{
    title: string;
    why: string;
    category?: string;
    paths: Array<{
      title: string;
      why: string;
    }>;
    chosenPathTitle: string;
    rationale: string;
    decidedAt?: string; // fuzzy date like "June 2024"
  }>;
  // Pre-resolved obligations (reconstruction mode - already completed)
  obligations_resolved?: Array<{
    title: string;
    why: string;
    category?: string;
    state: "done" | "wont-do" | "delegated";
    notes?: string;
    completedAt?: string; // fuzzy date
  }>;
  // Path selections (when user makes a choice)
  selections?: Array<{
    forkTitle: string; // Match by title since LLM doesn't know IDs
    chosenPathTitle: string;
    rationale: string;
  }>;
  // Path dismissals
  dismissals?: Array<{
    forkTitle: string;
    pathTitle: string;
  }>;
  // Short message to display
  assistant_message?: string;
  // Warning for degraded responses (e.g., truncated due to limits)
  _warning?: string;
}

// =============================================================================
// STORE STATE
// =============================================================================

export interface LedgerState {
  // Entry tree (Forks, Paths, Obligations)
  entries: Entry[];
  // Decision log (Muninn) - append-only
  decisions: DecisionRecord[];
  // Conversations (each contains messages and chat path)
  conversations: Conversation[];
  // Currently active conversation
  currentConversationId: string;
  // Event log for time travel reconstruction - append-only
  events: LedgerEvent[];
}

// =============================================================================
// LEDGERS AND PERSONAS
// =============================================================================

/**
 * Personas define how Huginn engages with the user.
 * Each persona has a different tone, cadence, and purpose.
 */
export type Persona = "thinking-partner" | "synthesizer" | "interviewer";

/**
 * Persona metadata for display purposes
 */
export const PERSONA_INFO: Record<Persona, { label: string; description: string }> = {
  "thinking-partner": {
    label: "Thinking Partner",
    description: "Explore ideas, surface decisions",
  },
  interviewer: {
    label: "Interviewer",
    description: "Document what you've already decided",
  },
  synthesizer: {
    label: "Synthesizer",
    description: "Package for sharing",
  },
};

/**
 * Migration status for defensive state management.
 * - healthy: Data loaded and migrated successfully
 * - quarantined: Data could not be migrated; ledger is read-only/export-only
 */
export type MigrationStatus = "healthy" | "quarantined";

export interface Ledger {
  id: string;
  name: string;
  persona: Persona;
  createdAt: number;
  updatedAt: number;
  // Defensive state management fields (optional for backward compat)
  // Schema version the data was successfully migrated to
  schemaVersion?: number;
  // Migration status: 'healthy' (default) or 'quarantined' (read-only)
  migrationStatus?: MigrationStatus;
  // Error message if migration failed (only set when quarantined)
  migrationError?: string;
  // Sample ledger flag - loaded from bundled fixture, read-only
  isSample?: boolean;
}

export interface AppState {
  ledgers: Ledger[];
  currentLedgerId: string | null;
  // Each ledger's state is stored separately (keyed by ledger id in storage)
}

// Backwards compatibility aliases (deprecated)
/** @deprecated Use Persona instead */
export type LedgerMode = "greenfield" | "reconstruction";
/** @deprecated Use Persona instead */
export type VentureMode = LedgerMode;
/** @deprecated Use Ledger instead */
export type Venture = Ledger;

// =============================================================================
// EVENT LOG (for time travel)
// =============================================================================

export type EventType =
  // Messages
  | "message_added"
  // Conversations
  | "conversation_created"
  | "conversation_switched"
  | "branch_created"
  | "branch_merged"
  | "branch_abandoned"
  | "branch_reverted"
  // Forks
  | "fork_created"
  | "fork_created_resolved"
  // Paths
  | "path_chosen"
  | "path_dismissed"
  | "path_reopened"
  // Obligations
  | "obligation_created"
  | "obligation_created_resolved"
  | "obligation_state_changed"
  | "obligation_notes_updated"
  // Linking
  | "message_linked_to_entries"
  // LLM Interactions (for simulator/replay)
  | "llm_interaction";

// Event payload types
export interface MessageAddedPayload {
  messageId: string;
  conversationId: string;
  role: "user" | "assistant";
  content: string;
  parentId?: string;
}

export interface ConversationCreatedPayload {
  conversationId: string;
  name?: string;
  type: ConversationType;
}

export interface ConversationSwitchedPayload {
  fromConversationId: string;
  toConversationId: string;
}

export interface BranchCreatedPayload {
  branchId: string;
  name?: string;
  sourceConversationId: string;
  entrySnapshotIds: string[];
  sourceMessageId?: string; // The divergence point message
}

export interface BranchMergedPayload {
  branchId: string;
  mergedEntryIds: string[];
  mergedDecisionIds: string[];
}

export interface BranchAbandonedPayload {
  branchId: string;
  reason?: string; // Optional explanation for why the branch was abandoned
}

export interface BranchRevertedPayload {
  branchId: string;
  reason?: string; // Optional explanation for why the branch was reverted
}

export interface ForkCreatedPayload {
  forkId: string;
  title: string;
  why: string;
  phase: Phase;
  category?: string;
  isBinary?: boolean;
  pathIds: string[];
  pathTitles: string[];
  linkedMessageId?: string;
}

export interface ForkCreatedResolvedPayload {
  forkId: string;
  title: string;
  why: string;
  category?: string;
  pathIds: string[];
  pathTitles: string[];
  chosenPathId: string;
  rationale: string;
  decisionId: string;
  decidedAt: number;
  linkedMessageId?: string;
}

export interface PathChosenPayload {
  forkId: string;
  pathId: string;
  rationale: string;
  decisionId: string;
  decidedAt: number;
  linkedMessageId?: string;
}

export interface PathDismissedPayload {
  forkId: string;
  pathId: string;
}

export interface PathReopenedPayload {
  forkId: string;
  pathId: string;
}

export interface ObligationCreatedPayload {
  obligationId: string;
  title: string;
  why: string;
  phase: Phase;
  category?: string;
  linkedMessageId?: string;
  triggeredBy?: string[];
}

export interface ObligationCreatedResolvedPayload {
  obligationId: string;
  title: string;
  why: string;
  category?: string;
  resolvedState: "done" | "wont-do" | "delegated";
  notes?: string;
  decisionId: string;
  completedAt: number;
  linkedMessageId?: string;
}

export interface ObligationStateChangedPayload {
  obligationId: string;
  previousState: ObligationState;
  newState: ObligationState;
  notes?: string;
  decisionId: string;
  decidedAt: number;
  linkedMessageId?: string;
}

export interface ObligationNotesUpdatedPayload {
  obligationId: string;
  previousNotes?: string;
  newNotes: string;
}

export interface MessageLinkedToEntriesPayload {
  messageId: string;
  entryIds: string[];
}

/**
 * LLM Interaction payload - captures the full request/response for replay and debugging.
 * This event is emitted once per LLM API call and contains all the context needed
 * to understand what the LLM saw and what it produced.
 */
export interface LlmInteractionPayload {
  // Message IDs
  userMessageId: string;
  assistantMessageId?: string; // May be undefined if LLM returned no message

  // Request context - what the LLM saw
  request: {
    message: string;
    messageHistory: Array<{
      role: "user" | "assistant";
      content: string;
    }>;
    existingEntries: Array<{
      type: "fork" | "obligation";
      title: string;
      decided?: boolean;
      chosenPath?: string;
      openPaths?: string[];
    }>;
    persona: Persona;
  };

  // Full LLM response - what the LLM returned
  response: LLMResponse;

  // Events spawned from processing this response
  // Allows correlation between this interaction and its effects
  spawnedEventIds: string[];
}

// Base event interface
interface BaseLedgerEvent {
  id: string;
  recordedAt: number;
}

// Discriminated union for all event types
export type LedgerEvent =
  | (BaseLedgerEvent & { type: "message_added"; payload: MessageAddedPayload })
  | (BaseLedgerEvent & { type: "conversation_created"; payload: ConversationCreatedPayload })
  | (BaseLedgerEvent & { type: "conversation_switched"; payload: ConversationSwitchedPayload })
  | (BaseLedgerEvent & { type: "branch_created"; payload: BranchCreatedPayload })
  | (BaseLedgerEvent & { type: "branch_merged"; payload: BranchMergedPayload })
  | (BaseLedgerEvent & { type: "branch_abandoned"; payload: BranchAbandonedPayload })
  | (BaseLedgerEvent & { type: "branch_reverted"; payload: BranchRevertedPayload })
  | (BaseLedgerEvent & { type: "fork_created"; payload: ForkCreatedPayload })
  | (BaseLedgerEvent & { type: "fork_created_resolved"; payload: ForkCreatedResolvedPayload })
  | (BaseLedgerEvent & { type: "path_chosen"; payload: PathChosenPayload })
  | (BaseLedgerEvent & { type: "path_dismissed"; payload: PathDismissedPayload })
  | (BaseLedgerEvent & { type: "path_reopened"; payload: PathReopenedPayload })
  | (BaseLedgerEvent & { type: "obligation_created"; payload: ObligationCreatedPayload })
  | (BaseLedgerEvent & {
      type: "obligation_created_resolved";
      payload: ObligationCreatedResolvedPayload;
    })
  | (BaseLedgerEvent & { type: "obligation_state_changed"; payload: ObligationStateChangedPayload })
  | (BaseLedgerEvent & { type: "obligation_notes_updated"; payload: ObligationNotesUpdatedPayload })
  | (BaseLedgerEvent & {
      type: "message_linked_to_entries";
      payload: MessageLinkedToEntriesPayload;
    })
  | (BaseLedgerEvent & { type: "llm_interaction"; payload: LlmInteractionPayload });
