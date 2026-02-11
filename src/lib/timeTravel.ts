/**
 * Time Travel Module
 *
 * Reconstructs ledger state at any point in time by replaying events.
 * Used for read-only time travel: viewing historical snapshots.
 */

import type {
  LedgerEvent,
  Entry,
  Fork,
  Path,
  Obligation,
  DecisionRecord,
  PathDecisionRecord,
  ObligationDecisionRecord,
  ChatMessage,
  Phase,
  PathState,
  ConversationType,
  MessageAddedPayload,
  ConversationCreatedPayload,
  ConversationSwitchedPayload,
  BranchCreatedPayload,
  BranchMergedPayload,
  BranchAbandonedPayload,
  BranchRevertedPayload,
  ForkCreatedPayload,
  ForkCreatedResolvedPayload,
  PathChosenPayload,
  PathDismissedPayload,
  PathReopenedPayload,
  ObligationCreatedPayload,
  ObligationCreatedResolvedPayload,
  ObligationStateChangedPayload,
  ObligationNotesUpdatedPayload,
  MessageLinkedToEntriesPayload,
} from "@/types";
import { isFork } from "@/types";

/**
 * Simplified conversation for reconstruction (no branch info)
 */
export interface ReconstructedConversation {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  currentChatPath: string[];
  type: ConversationType;
}

/**
 * State reconstructed from events at a point in time
 */
export interface ReconstructedState {
  entries: Entry[];
  decisions: DecisionRecord[];
  conversations: Map<string, ReconstructedConversation>;
  activeConversationId: string;
  lastActivityConversationId: string;
}

/**
 * Create an empty reconstructed state
 */
function createEmptyState(): ReconstructedState {
  return {
    entries: [],
    decisions: [],
    conversations: new Map(),
    activeConversationId: "",
    lastActivityConversationId: "",
  };
}

/**
 * Deep clone a state for immutable updates
 */
function cloneState(state: ReconstructedState): ReconstructedState {
  return {
    entries: JSON.parse(JSON.stringify(state.entries)),
    decisions: JSON.parse(JSON.stringify(state.decisions)),
    conversations: new Map(
      Array.from(state.conversations.entries()).map(([id, conv]) => [
        id,
        JSON.parse(JSON.stringify(conv)),
      ])
    ),
    activeConversationId: state.activeConversationId,
    lastActivityConversationId: state.lastActivityConversationId,
  };
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

function applyMessageAdded(
  state: ReconstructedState,
  payload: MessageAddedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  let conversation = newState.conversations.get(payload.conversationId);
  if (!conversation) {
    // Create conversation if it doesn't exist (shouldn't happen in practice)
    conversation = {
      id: payload.conversationId,
      createdAt: recordedAt,
      updatedAt: recordedAt,
      messages: [],
      currentChatPath: [],
      type: "live",
    };
    newState.conversations.set(payload.conversationId, conversation);
  }

  const message: ChatMessage = {
    id: payload.messageId,
    role: payload.role,
    content: payload.content,
    recordedAt,
    parentId: payload.parentId,
    childIds: [],
    linkedEntryIds: [],
  };

  // Update parent's childIds
  if (payload.parentId) {
    const parent = conversation.messages.find((m) => m.id === payload.parentId);
    if (parent) {
      parent.childIds.push(payload.messageId);
    }
  }

  conversation.messages.push(message);
  conversation.updatedAt = recordedAt;

  // Update chat path
  if (!payload.parentId) {
    conversation.currentChatPath = [payload.messageId];
  } else {
    // Build path from root to this message
    const path: string[] = [];
    let current: ChatMessage | undefined = message;
    while (current) {
      path.unshift(current.id);
      current = current.parentId
        ? conversation.messages.find((m) => m.id === current!.parentId)
        : undefined;
    }
    conversation.currentChatPath = path;
  }

  newState.lastActivityConversationId = payload.conversationId;

  return newState;
}

function applyConversationCreated(
  state: ReconstructedState,
  payload: ConversationCreatedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const conversation: ReconstructedConversation = {
    id: payload.conversationId,
    name: payload.name,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    messages: [],
    currentChatPath: [],
    type: payload.type,
  };

  newState.conversations.set(payload.conversationId, conversation);
  newState.activeConversationId = payload.conversationId;

  return newState;
}

function applyConversationSwitched(
  state: ReconstructedState,
  payload: ConversationSwitchedPayload
): ReconstructedState {
  const newState = cloneState(state);
  newState.activeConversationId = payload.toConversationId;
  return newState;
}

function applyBranchCreated(
  state: ReconstructedState,
  payload: BranchCreatedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const branch: ReconstructedConversation = {
    id: payload.branchId,
    name: payload.name,
    createdAt: recordedAt,
    updatedAt: recordedAt,
    messages: [],
    currentChatPath: [],
    type: "isolated",
  };

  newState.conversations.set(payload.branchId, branch);
  // Note: we don't switch active conversation here as that happens via conversation_switched

  return newState;
}

function applyBranchMerged(
  state: ReconstructedState,
  _payload: BranchMergedPayload
): ReconstructedState {
  // Branch merge doesn't change reconstructed state directly
  // The merged entries/decisions come through their own events
  return state;
}

function applyBranchAbandoned(
  state: ReconstructedState,
  _payload: BranchAbandonedPayload
): ReconstructedState {
  // Branch abandonment doesn't change reconstructed state directly
  // It's tracked in the conversation's status field (not in ReconstructedConversation)
  return state;
}

function applyBranchReverted(
  state: ReconstructedState,
  _payload: BranchRevertedPayload
): ReconstructedState {
  // Branch revert doesn't change reconstructed state directly in time travel
  // The removal of entries/decisions happens at revert time, not during replay
  // In a full implementation, we might track reverted entry IDs and filter them
  return state;
}

function applyForkCreated(
  state: ReconstructedState,
  payload: ForkCreatedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const paths: Path[] = payload.pathIds.map((pathId, i) => ({
    id: pathId,
    type: "path" as const,
    title: payload.pathTitles[i],
    why: "",
    phase: payload.phase,
    category: payload.category,
    state: "open" as PathState,
    forkId: payload.forkId,
    recordedAt,
    decidedAt: recordedAt,
    linkedMessageIds: payload.linkedMessageId ? [payload.linkedMessageId] : undefined,
  }));

  const fork: Fork = {
    id: payload.forkId,
    type: "fork",
    title: payload.title,
    why: payload.why,
    phase: payload.phase,
    category: payload.category,
    isBinary: payload.isBinary,
    paths,
    recordedAt,
    decidedAt: recordedAt,
    linkedMessageIds: payload.linkedMessageId ? [payload.linkedMessageId] : undefined,
  };

  newState.entries.push(fork);

  return newState;
}

function applyForkCreatedResolved(
  state: ReconstructedState,
  payload: ForkCreatedResolvedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const paths: Path[] = payload.pathIds.map((pathId, i) => ({
    id: pathId,
    type: "path" as const,
    title: payload.pathTitles[i],
    why: "",
    phase: "past" as Phase,
    category: payload.category,
    state: (pathId === payload.chosenPathId ? "chosen" : "dismissed") as PathState,
    forkId: payload.forkId,
    recordedAt,
    decidedAt: payload.decidedAt,
    chosenAt: pathId === payload.chosenPathId ? payload.decidedAt : undefined,
    chosenRationale: pathId === payload.chosenPathId ? payload.rationale : undefined,
    linkedMessageIds: payload.linkedMessageId ? [payload.linkedMessageId] : undefined,
  }));

  const fork: Fork = {
    id: payload.forkId,
    type: "fork",
    title: payload.title,
    why: payload.why,
    phase: "past",
    category: payload.category,
    paths,
    recordedAt,
    decidedAt: payload.decidedAt,
    linkedMessageIds: payload.linkedMessageId ? [payload.linkedMessageId] : undefined,
  };

  newState.entries.push(fork);

  // Add decision record
  const chosenPath = paths.find((p) => p.id === payload.chosenPathId);
  if (chosenPath) {
    const decision: PathDecisionRecord = {
      id: payload.decisionId,
      kind: "path",
      pathId: payload.chosenPathId,
      forkId: payload.forkId,
      forkTitle: payload.title,
      pathTitle: chosenPath.title,
      rationale: payload.rationale,
      recordedAt,
      decidedAt: payload.decidedAt,
      linkedMessageId: payload.linkedMessageId,
      conversationId: state.activeConversationId,
    };
    newState.decisions.push(decision);
  }

  return newState;
}

function applyPathChosen(
  state: ReconstructedState,
  payload: PathChosenPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const fork = newState.entries.find((e) => e.id === payload.forkId && isFork(e)) as
    | Fork
    | undefined;

  if (fork) {
    let pathTitle = "";
    fork.paths.forEach((p) => {
      if (p.id === payload.pathId) {
        p.state = "chosen";
        p.chosenAt = payload.decidedAt;
        p.chosenRationale = payload.rationale;
        pathTitle = p.title;
      } else if (p.state === "open") {
        p.state = "dismissed";
      }
    });

    // Add decision record
    const decision: PathDecisionRecord = {
      id: payload.decisionId,
      kind: "path",
      pathId: payload.pathId,
      forkId: payload.forkId,
      forkTitle: fork.title,
      pathTitle,
      rationale: payload.rationale,
      recordedAt,
      decidedAt: payload.decidedAt,
      linkedMessageId: payload.linkedMessageId,
      conversationId: state.activeConversationId,
    };
    newState.decisions.push(decision);
  }

  return newState;
}

function applyPathDismissed(
  state: ReconstructedState,
  payload: PathDismissedPayload
): ReconstructedState {
  const newState = cloneState(state);

  const fork = newState.entries.find((e) => e.id === payload.forkId && isFork(e)) as
    | Fork
    | undefined;

  if (fork) {
    const path = fork.paths.find((p) => p.id === payload.pathId);
    if (path) {
      path.state = "dismissed";
    }
  }

  return newState;
}

function applyPathReopened(
  state: ReconstructedState,
  payload: PathReopenedPayload
): ReconstructedState {
  const newState = cloneState(state);

  const fork = newState.entries.find((e) => e.id === payload.forkId && isFork(e)) as
    | Fork
    | undefined;

  if (fork) {
    const path = fork.paths.find((p) => p.id === payload.pathId);
    if (path) {
      path.state = "open";
    }
  }

  return newState;
}

function applyObligationCreated(
  state: ReconstructedState,
  payload: ObligationCreatedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const obligation: Obligation = {
    id: payload.obligationId,
    type: "obligation",
    title: payload.title,
    why: payload.why,
    phase: payload.phase,
    category: payload.category,
    state: "todo",
    recordedAt,
    decidedAt: recordedAt,
    linkedMessageIds: payload.linkedMessageId ? [payload.linkedMessageId] : undefined,
    triggeredBy: payload.triggeredBy,
  };

  newState.entries.push(obligation);

  return newState;
}

function applyObligationCreatedResolved(
  state: ReconstructedState,
  payload: ObligationCreatedResolvedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const obligation: Obligation = {
    id: payload.obligationId,
    type: "obligation",
    title: payload.title,
    why: payload.why,
    phase: "past",
    category: payload.category,
    state: payload.resolvedState,
    notes: payload.notes,
    stateChangedAt: payload.completedAt,
    recordedAt,
    decidedAt: payload.completedAt,
    linkedMessageIds: payload.linkedMessageId ? [payload.linkedMessageId] : undefined,
  };

  newState.entries.push(obligation);

  // Add decision record
  const decision: ObligationDecisionRecord = {
    id: payload.decisionId,
    kind: "obligation",
    obligationId: payload.obligationId,
    obligationTitle: payload.title,
    previousState: "todo",
    newState: payload.resolvedState,
    notes: payload.notes,
    recordedAt,
    decidedAt: payload.completedAt,
    linkedMessageId: payload.linkedMessageId,
    conversationId: state.activeConversationId,
  };
  newState.decisions.push(decision);

  return newState;
}

function applyObligationStateChanged(
  state: ReconstructedState,
  payload: ObligationStateChangedPayload,
  recordedAt: number
): ReconstructedState {
  const newState = cloneState(state);

  const obligation = newState.entries.find(
    (e) => e.type === "obligation" && e.id === payload.obligationId
  ) as Obligation | undefined;

  if (obligation) {
    obligation.state = payload.newState;
    obligation.stateChangedAt = payload.decidedAt;
    if (payload.notes !== undefined) {
      obligation.notes = payload.notes;
    }

    // Update phase based on state
    switch (payload.newState) {
      case "done":
      case "wont-do":
      case "delegated":
        obligation.phase = "past";
        break;
      case "parked":
        obligation.phase = "parking-lot";
        break;
      case "todo":
        if (obligation.phase === "past" || obligation.phase === "parking-lot") {
          obligation.phase = "soon";
        }
        break;
    }

    // Add decision record
    const decision: ObligationDecisionRecord = {
      id: payload.decisionId,
      kind: "obligation",
      obligationId: payload.obligationId,
      obligationTitle: obligation.title,
      previousState: payload.previousState,
      newState: payload.newState,
      notes: payload.notes,
      recordedAt,
      decidedAt: payload.decidedAt,
      linkedMessageId: payload.linkedMessageId,
      conversationId: state.activeConversationId,
    };
    newState.decisions.push(decision);
  }

  return newState;
}

function applyObligationNotesUpdated(
  state: ReconstructedState,
  payload: ObligationNotesUpdatedPayload
): ReconstructedState {
  const newState = cloneState(state);

  const obligation = newState.entries.find(
    (e) => e.type === "obligation" && e.id === payload.obligationId
  ) as Obligation | undefined;

  if (obligation) {
    obligation.notes = payload.newNotes;
  }

  return newState;
}

function applyMessageLinkedToEntries(
  state: ReconstructedState,
  payload: MessageLinkedToEntriesPayload
): ReconstructedState {
  const newState = cloneState(state);

  // Find message in any conversation and link it
  const conversations = Array.from(newState.conversations.values());
  for (const conversation of conversations) {
    const message = conversation.messages.find((m) => m.id === payload.messageId);
    if (message) {
      message.linkedEntryIds = [...(message.linkedEntryIds || []), ...payload.entryIds];
      break;
    }
  }

  // Link entries back to message
  payload.entryIds.forEach((entryId) => {
    const entry = newState.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.linkedMessageIds = [...(entry.linkedMessageIds || []), payload.messageId];
    }
    // Also check paths within forks
    newState.entries.forEach((e) => {
      if (isFork(e)) {
        const path = e.paths.find((p) => p.id === entryId);
        if (path) {
          path.linkedMessageIds = [...(path.linkedMessageIds || []), payload.messageId];
        }
      }
    });
  });

  return newState;
}

// =============================================================================
// MAIN RECONSTRUCTION FUNCTION
// =============================================================================

/**
 * Apply a single event to the state
 */
export function applyEvent(state: ReconstructedState, event: LedgerEvent): ReconstructedState {
  switch (event.type) {
    case "message_added":
      return applyMessageAdded(state, event.payload, event.recordedAt);
    case "conversation_created":
      return applyConversationCreated(state, event.payload, event.recordedAt);
    case "conversation_switched":
      return applyConversationSwitched(state, event.payload);
    case "branch_created":
      return applyBranchCreated(state, event.payload, event.recordedAt);
    case "branch_merged":
      return applyBranchMerged(state, event.payload);
    case "branch_abandoned":
      return applyBranchAbandoned(state, event.payload);
    case "branch_reverted":
      return applyBranchReverted(state, event.payload);
    case "fork_created":
      return applyForkCreated(state, event.payload, event.recordedAt);
    case "fork_created_resolved":
      return applyForkCreatedResolved(state, event.payload, event.recordedAt);
    case "path_chosen":
      return applyPathChosen(state, event.payload, event.recordedAt);
    case "path_dismissed":
      return applyPathDismissed(state, event.payload);
    case "path_reopened":
      return applyPathReopened(state, event.payload);
    case "obligation_created":
      return applyObligationCreated(state, event.payload, event.recordedAt);
    case "obligation_created_resolved":
      return applyObligationCreatedResolved(state, event.payload, event.recordedAt);
    case "obligation_state_changed":
      return applyObligationStateChanged(state, event.payload, event.recordedAt);
    case "obligation_notes_updated":
      return applyObligationNotesUpdated(state, event.payload);
    case "message_linked_to_entries":
      return applyMessageLinkedToEntries(state, event.payload);
    default:
      // Unknown event type, return state unchanged
      return state;
  }
}

/**
 * Reconstruct ledger state at a specific point in time by replaying events.
 *
 * @param events - Full array of events (sorted by recordedAt ascending)
 * @param targetTimestamp - The timestamp to reconstruct state at
 * @returns State as it existed at the target timestamp
 */
export function reconstructStateAtTime(
  events: LedgerEvent[],
  targetTimestamp: number
): ReconstructedState {
  let state = createEmptyState();

  // Replay events up to (and including) the target timestamp
  for (const event of events) {
    if (event.recordedAt > targetTimestamp) {
      break;
    }
    state = applyEvent(state, event);
  }

  return state;
}

/**
 * Get all unique timestamps where state changed.
 * Useful for building a timeline scrubber.
 */
export function getEventTimestamps(events: LedgerEvent[]): number[] {
  const timestamps = new Set<number>();
  for (const event of events) {
    timestamps.add(event.recordedAt);
  }
  return Array.from(timestamps).sort((a, b) => a - b);
}

/**
 * Find the event index at or before a given timestamp.
 * Returns -1 if no events exist before the timestamp.
 */
export function findEventIndexAtTime(events: LedgerEvent[], targetTimestamp: number): number {
  let result = -1;
  for (let i = 0; i < events.length; i++) {
    if (events[i].recordedAt <= targetTimestamp) {
      result = i;
    } else {
      break;
    }
  }
  return result;
}
