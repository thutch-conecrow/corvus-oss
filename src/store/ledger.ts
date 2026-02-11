"use client";

import { nanoid } from "nanoid";
import type {
  Entry,
  Fork,
  Path,
  Obligation,
  DecisionRecord,
  PathDecisionRecord,
  ObligationDecisionRecord,
  ChatMessage,
  LedgerState,
  Ledger,
  Persona,
  AppState,
  Phase,
  PathState,
  ObligationState,
  Conversation,
  ConversationType,
  LedgerEvent,
  EventType,
  MigrationStatus,
} from "@/types";
import { isFork, isObligation } from "@/types";
import { reconstructStateAtTime } from "@/lib/timeTravel";

// =============================================================================
// TITLE NORMALIZATION & DEDUP
// =============================================================================

// Normalize a title for comparison (lowercase, strip punctuation, collapse whitespace)
function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[?!.,;:'"()]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

// Find an existing fork by normalized title (checks effective entries for isolated conversations)
function findExistingForkByNormalizedTitle(title: string): Fork | undefined {
  const normalized = normalizeTitle(title);
  // Use getEffectiveEntriesInternal to check against correct entry set
  const entries = getEffectiveEntriesInternal();
  return entries.find((e) => isFork(e) && normalizeTitle(e.title) === normalized) as
    | Fork
    | undefined;
}

// Find an existing obligation by normalized title (checks effective entries for isolated conversations)
function findExistingObligationByNormalizedTitle(title: string): Obligation | undefined {
  const normalized = normalizeTitle(title);
  // Use getEffectiveEntriesInternal to check against correct entry set
  const entries = getEffectiveEntriesInternal();
  return entries.find((e) => isObligation(e) && normalizeTitle(e.title) === normalized) as
    | Obligation
    | undefined;
}

// Internal version of getEffectiveEntries (forward declared, implemented after conversation functions)
function getEffectiveEntriesInternal(): Entry[] {
  const conversation = state.conversations.find((c) => c.id === state.currentConversationId);
  if (!conversation) return state.entries;

  if (conversation.type === "isolated" && conversation.branchedFrom) {
    const baseEntries = conversation.branchedFrom.entrySnapshot;
    const localEntries = conversation.localEntries ?? [];
    const entriesById = new Map<string, Entry>();
    baseEntries.forEach((e) => entriesById.set(e.id, e));
    localEntries.forEach((e) => entriesById.set(e.id, e));
    return Array.from(entriesById.values());
  }

  return state.entries;
}

// =============================================================================
// LOCAL STORAGE PERSISTENCE (for prototyping only)
// =============================================================================

const STORAGE_KEY_APP = "corvus-ledger-app";
const STORAGE_KEY_LEDGER_PREFIX = "corvus-ledger-ledger-";
// Legacy key prefix for migration
const LEGACY_STORAGE_KEY_VENTURE_PREFIX = "corvus-ledger-venture-";
const STORAGE_VERSION = 9; // Bump this when model changes to invalidate stored data

interface SerializedAppState {
  version: number;
  ledgers: Ledger[];
  currentLedgerId: string | null;
}

// Legacy format for migration from v5 (ventures)
interface LegacySerializedAppStateV5 {
  version: number;
  ventures: Array<{ id: string; name: string; mode: string; createdAt: number; updatedAt: number }>;
  currentVentureId: string | null;
}

// Legacy format for migration from v6 (mode → persona)
interface LegacySerializedAppStateV6 {
  version: number;
  ledgers: Array<{ id: string; name: string; mode: string; createdAt: number; updatedAt: number }>;
  currentLedgerId: string | null;
}

/**
 * Migrate mode to persona.
 * Both 'greenfield' and 'reconstruction' map to 'thinking-partner' as the default.
 */
function migrateModeToPerson(_mode: string): Persona {
  // All modes map to thinking-partner - the interviewer persona for reconstruction
  // will be added in Phase 3
  return "thinking-partner";
}

// Legacy format for migration from v7 (messages at top level)
interface LegacySerializedLedgerStateV7 {
  version: number;
  facts?: Array<[string, unknown]>; // Legacy field, no longer used
  entries: Entry[];
  decisions: DecisionRecord[];
  messages: ChatMessage[];
  currentChatPath: string[];
}

// Serialized conversation for storage
interface SerializedConversation {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  currentChatPath: string[];
  type: ConversationType;
}

interface SerializedLedgerState {
  version: number;
  entries: Entry[];
  decisions: DecisionRecord[];
  conversations: SerializedConversation[];
  currentConversationId: string;
  events: LedgerEvent[];
}

// Legacy format for migration from v8 (no events)
interface LegacySerializedLedgerStateV8 {
  version: number;
  facts?: Array<[string, unknown]>; // Legacy field, no longer used
  entries: Entry[];
  decisions: DecisionRecord[];
  conversations: SerializedConversation[];
  currentConversationId: string;
}

/**
 * Migrate from v7 (messages at ledger level) to v8 (conversations)
 */
function migrateV7ToV8(parsed: LegacySerializedLedgerStateV7): LegacySerializedLedgerStateV8 {
  const defaultConversationId = nanoid();
  const now = Date.now();

  return {
    version: 8,
    entries: parsed.entries,
    decisions: parsed.decisions.map((d) => ({ ...d, conversationId: defaultConversationId })),
    conversations: [
      {
        id: defaultConversationId,
        createdAt: parsed.messages[0]?.recordedAt ?? now,
        updatedAt: parsed.messages[parsed.messages.length - 1]?.recordedAt ?? now,
        messages: parsed.messages,
        currentChatPath: parsed.currentChatPath,
        type: "live",
      },
    ],
    currentConversationId: defaultConversationId,
  };
}

/**
 * Migrate from v8 (no events) to v9 (with events array)
 * Existing ledgers get an empty events array - no backfill.
 */
function migrateV8ToV9(parsed: LegacySerializedLedgerStateV8): SerializedLedgerState {
  return {
    ...parsed,
    version: 9,
    events: [],
  };
}

function saveAppState(appState: AppState): void {
  if (typeof window === "undefined") return;
  try {
    const serialized: SerializedAppState = {
      version: STORAGE_VERSION,
      ledgers: appState.ledgers,
      currentLedgerId: appState.currentLedgerId,
    };
    localStorage.setItem(STORAGE_KEY_APP, JSON.stringify(serialized));
  } catch (e) {
    console.warn("Failed to save app state to localStorage:", e);
  }
}

function saveLedgerState(ledgerId: string, state: LedgerState): void {
  if (typeof window === "undefined") return;
  try {
    const serialized: SerializedLedgerState = {
      version: STORAGE_VERSION,
      entries: state.entries,
      decisions: state.decisions,
      conversations: state.conversations,
      currentConversationId: state.currentConversationId,
      events: state.events,
    };
    localStorage.setItem(STORAGE_KEY_LEDGER_PREFIX + ledgerId, JSON.stringify(serialized));
  } catch (e) {
    console.warn("Failed to save ledger state to localStorage:", e);
  }
}

function loadAppState(): AppState | null {
  if (typeof window === "undefined") return null;
  try {
    const stored = localStorage.getItem(STORAGE_KEY_APP);
    if (!stored) return null;

    const parsed = JSON.parse(stored);

    // Handle migration from v5 (ventures → ledgers with mode)
    if (parsed.version === 5 && parsed.ventures) {
      console.log("Migrating from v5 (ventures) to v7 (ledgers with persona)...");
      const legacyState = parsed as LegacySerializedAppStateV5;

      // Migrate each venture's state to new key format
      legacyState.ventures.forEach((v) => {
        const oldKey = LEGACY_STORAGE_KEY_VENTURE_PREFIX + v.id;
        const newKey = STORAGE_KEY_LEDGER_PREFIX + v.id;
        const ventureData = localStorage.getItem(oldKey);
        if (ventureData) {
          try {
            const parsedLedgerState = JSON.parse(ventureData);
            parsedLedgerState.version = STORAGE_VERSION;
            localStorage.setItem(newKey, JSON.stringify(parsedLedgerState));
            localStorage.removeItem(oldKey);
          } catch {
            localStorage.setItem(newKey, ventureData);
            localStorage.removeItem(oldKey);
          }
        }
      });

      const migratedState: AppState = {
        ledgers: legacyState.ventures.map((v) => ({
          id: v.id,
          name: v.name,
          persona: migrateModeToPerson(v.mode),
          createdAt: v.createdAt,
          updatedAt: v.updatedAt,
        })),
        currentLedgerId: legacyState.currentVentureId,
      };

      saveAppState(migratedState);
      console.log("Migration from v5 complete.");
      return migratedState;
    }

    // Handle migration from v6 (mode → persona)
    if (parsed.version === 6 && parsed.ledgers) {
      console.log("Migrating from v6 (mode) to v7 (persona)...");
      const legacyState = parsed as LegacySerializedAppStateV6;

      // Update ledger state versions
      legacyState.ledgers.forEach((l) => {
        const key = STORAGE_KEY_LEDGER_PREFIX + l.id;
        const ledgerData = localStorage.getItem(key);
        if (ledgerData) {
          try {
            const parsedLedgerState = JSON.parse(ledgerData);
            parsedLedgerState.version = STORAGE_VERSION;
            localStorage.setItem(key, JSON.stringify(parsedLedgerState));
          } catch {
            // Leave as-is if parse fails
          }
        }
      });

      const migratedState: AppState = {
        ledgers: legacyState.ledgers.map((l) => ({
          id: l.id,
          name: l.name,
          persona: migrateModeToPerson(l.mode),
          createdAt: l.createdAt,
          updatedAt: l.updatedAt,
        })),
        currentLedgerId: legacyState.currentLedgerId,
      };

      saveAppState(migratedState);
      console.log("Migration from v6 complete.");
      return migratedState;
    }

    // Handle migration from v7 or v8 to v9
    // App state format is unchanged, just need to update version
    // Ledger state migration (adding events array) is handled in loadLedgerState
    if (parsed.version === 7 || parsed.version === 8) {
      console.log(`Migrating app state from v${parsed.version} to v9...`);

      const migratedState: AppState = {
        ledgers: parsed.ledgers,
        currentLedgerId: parsed.currentLedgerId,
      };

      saveAppState(migratedState);
      console.log(`Migration from v${parsed.version} complete.`);
      return migratedState;
    }

    if (parsed.version !== STORAGE_VERSION) {
      console.log(
        `App storage version mismatch (${parsed.version} vs ${STORAGE_VERSION}), clearing stored data`
      );
      clearAllStorage();
      return null;
    }

    return {
      ledgers: parsed.ledgers,
      currentLedgerId: parsed.currentLedgerId,
    };
  } catch (e) {
    console.warn("Failed to load app state from localStorage:", e);
    return null;
  }
}

/**
 * Result of loading a ledger, with quarantine support
 */
interface LedgerLoadResult {
  state: LedgerState | null;
  migrationStatus: MigrationStatus;
  migrationError?: string;
  schemaVersion: number;
}

function loadLedgerState(ledgerId: string): LedgerLoadResult {
  const quarantined = (error: string): LedgerLoadResult => ({
    state: null,
    migrationStatus: "quarantined",
    migrationError: error,
    schemaVersion: 0,
  });

  if (typeof window === "undefined") {
    return { state: null, migrationStatus: "healthy", schemaVersion: STORAGE_VERSION };
  }

  try {
    const stored = localStorage.getItem(STORAGE_KEY_LEDGER_PREFIX + ledgerId);
    if (!stored) {
      return { state: null, migrationStatus: "healthy", schemaVersion: STORAGE_VERSION };
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let parsed: any;
    try {
      parsed = JSON.parse(stored);
    } catch (parseError) {
      console.error(`Failed to parse ledger ${ledgerId}:`, parseError);
      return quarantined(
        `JSON parse error: ${parseError instanceof Error ? parseError.message : "Unknown error"}`
      );
    }

    // Wrap migrations in try/catch for defensive error handling
    try {
      // Handle migration to v8 (messages → conversations)
      // Check by structure, not just version, because app state migrations may have
      // bumped the version without actually migrating the ledger data structure
      if (parsed.messages !== undefined && parsed.conversations === undefined) {
        console.log(`Migrating ledger ${ledgerId} to v8 (messages → conversations)...`);
        parsed = migrateV7ToV8(parsed as LegacySerializedLedgerStateV7);
        console.log(`Migration of ledger ${ledgerId} to v8 complete.`);
      }

      // Handle migration to v9 (add events array)
      // Check by structure: if events is undefined, migrate
      if (parsed.conversations !== undefined && parsed.events === undefined) {
        console.log(`Migrating ledger ${ledgerId} to v9 (adding events)...`);
        parsed = migrateV8ToV9(parsed as LegacySerializedLedgerStateV8);
        // Save migrated state
        localStorage.setItem(STORAGE_KEY_LEDGER_PREFIX + ledgerId, JSON.stringify(parsed));
        console.log(`Migration of ledger ${ledgerId} to v9 complete.`);
      }
    } catch (migrationError) {
      console.error(`Migration failed for ledger ${ledgerId}:`, migrationError);
      // Don't modify localStorage - preserve original data for recovery
      return quarantined(
        `Migration failed: ${migrationError instanceof Error ? migrationError.message : "Unknown error"}`
      );
    }

    if (parsed.version !== STORAGE_VERSION) {
      console.warn(`Ledger ${ledgerId} version mismatch: ${parsed.version} vs ${STORAGE_VERSION}`);
      return quarantined(
        `Version mismatch: stored v${parsed.version}, expected v${STORAGE_VERSION}`
      );
    }

    return {
      state: {
        entries: (parsed.entries ?? []) as Entry[],
        decisions: (parsed.decisions ?? []) as DecisionRecord[],
        conversations: (parsed.conversations ?? []) as Conversation[],
        currentConversationId: (parsed.currentConversationId ?? "") as string,
        events: (parsed.events ?? []) as LedgerEvent[],
      },
      migrationStatus: "healthy",
      schemaVersion: STORAGE_VERSION,
    };
  } catch (e) {
    console.error(`Unexpected error loading ledger ${ledgerId}:`, e);
    return quarantined(`Load error: ${e instanceof Error ? e.message : "Unknown error"}`);
  }
}

function deleteLedgerStorage(ledgerId: string): void {
  if (typeof window === "undefined") return;
  localStorage.removeItem(STORAGE_KEY_LEDGER_PREFIX + ledgerId);
}

function clearAllStorage(): void {
  if (typeof window === "undefined") return;
  // Clear app state
  localStorage.removeItem(STORAGE_KEY_APP);
  // Clear all ledger states (both old and new key formats)
  const keys = Object.keys(localStorage);
  keys.forEach((key) => {
    if (
      key.startsWith(STORAGE_KEY_LEDGER_PREFIX) ||
      key.startsWith(LEGACY_STORAGE_KEY_VENTURE_PREFIX)
    ) {
      localStorage.removeItem(key);
    }
  });
}

// =============================================================================
// STORE STATE
// =============================================================================

const defaultLedgerState: LedgerState = {
  entries: [],
  decisions: [],
  conversations: [],
  currentConversationId: "",
  events: [],
};

const defaultAppState: AppState = {
  ledgers: [],
  currentLedgerId: null,
};

// Initialize app state from localStorage
let appState: AppState = loadAppState() ?? defaultAppState;

// Auto-create a default ledger if none exist
if (appState.ledgers.length === 0 && typeof window !== "undefined") {
  const now = Date.now();
  const defaultLedger: Ledger = {
    id: nanoid(),
    name: "My Ledger",
    persona: "thinking-partner",
    createdAt: now,
    updatedAt: now,
  };
  appState.ledgers.push(defaultLedger);
  appState.currentLedgerId = defaultLedger.id;
  saveAppState(appState);
}

// Initialize current ledger's state
let state: LedgerState;
if (appState.currentLedgerId) {
  const loadResult = loadLedgerState(appState.currentLedgerId);

  // Update ledger metadata with migration status
  const currentLedger = appState.ledgers.find((l) => l.id === appState.currentLedgerId);
  if (currentLedger) {
    currentLedger.schemaVersion = loadResult.schemaVersion;
    currentLedger.migrationStatus = loadResult.migrationStatus;
    currentLedger.migrationError = loadResult.migrationError;
    saveAppState(appState);

    if (loadResult.migrationStatus === "quarantined") {
      console.warn(
        `⚠️ Ledger "${currentLedger.name}" is quarantined due to: ${loadResult.migrationError}. ` +
          `Data is preserved in localStorage for recovery. Mutations are disabled.`
      );
    }
  }

  state = loadResult.state ?? {
    ...defaultLedgerState,
    conversations: [],
    currentConversationId: "",
  };
} else {
  state = { ...defaultLedgerState, conversations: [], currentConversationId: "" };
}

// Ensure a default conversation exists after initialization (inline since ensureDefaultConversation isn't defined yet)
// Only do this for healthy ledgers
const initLedger = appState.ledgers.find((l) => l.id === appState.currentLedgerId);
if (
  typeof window !== "undefined" &&
  appState.currentLedgerId &&
  state.conversations.length === 0 &&
  initLedger?.migrationStatus !== "quarantined"
) {
  const now = Date.now();
  const initConversation: Conversation = {
    id: nanoid(),
    createdAt: now,
    updatedAt: now,
    messages: [],
    currentChatPath: [],
    type: "live",
  };
  state.conversations.push(initConversation);
  state.currentConversationId = initConversation.id;
  saveLedgerState(appState.currentLedgerId, state);
}

// Subscribers for reactive updates
type LedgerSubscriber = (state: LedgerState) => void;
type AppSubscriber = (state: AppState) => void;
const ledgerSubscribers = new Set<LedgerSubscriber>();
const appSubscribers = new Set<AppSubscriber>();

/**
 * Check if the current ledger is quarantined (migration failed).
 * Returns true if mutations should be blocked.
 */
function isCurrentLedgerQuarantined(): boolean {
  if (!appState.currentLedgerId) return false;
  const ledger = appState.ledgers.find((l) => l.id === appState.currentLedgerId);
  return ledger?.migrationStatus === "quarantined";
}

/**
 * Mutation guard - checks if the current ledger is quarantined.
 * If quarantined, logs a warning and returns false (mutation should be blocked).
 * @param operation - Name of the operation being attempted (for logging)
 * @returns true if mutation is allowed, false if blocked
 */
function checkMutationAllowed(operation: string): boolean {
  if (isCurrentLedgerQuarantined()) {
    const ledger = appState.ledgers.find((l) => l.id === appState.currentLedgerId);
    console.warn(
      `⚠️ Mutation blocked: "${operation}" on quarantined ledger "${ledger?.name}". ` +
        `Reason: ${ledger?.migrationError}. Export the data and create a new ledger if needed.`
    );
    return false;
  }
  return true;
}

/**
 * Check if the current ledger is quarantined (exported for UI use).
 */
export function isLedgerQuarantined(): boolean {
  return isCurrentLedgerQuarantined();
}

/**
 * Get quarantine error message for the current ledger, if any.
 */
export function getQuarantineError(): string | undefined {
  if (!appState.currentLedgerId) return undefined;
  const ledger = appState.ledgers.find((l) => l.id === appState.currentLedgerId);
  return ledger?.migrationError;
}

function notifyLedger() {
  state = { ...state };
  if (appState.currentLedgerId) {
    // Don't save if ledger is quarantined
    if (!isCurrentLedgerQuarantined()) {
      saveLedgerState(appState.currentLedgerId, state);
      // Update ledger's updatedAt
      const ledger = appState.ledgers.find((l) => l.id === appState.currentLedgerId);
      if (ledger) {
        ledger.updatedAt = Date.now();
        saveAppState(appState);
      }
    }
  }
  ledgerSubscribers.forEach((fn) => fn(state));
}

function notifyApp() {
  appState = { ...appState };
  saveAppState(appState);
  appSubscribers.forEach((fn) => fn(appState));
}

// Legacy notify function - calls notifyLedger for backwards compatibility
function notify() {
  notifyLedger();
}

// =============================================================================
// EVENT LOGGING
// =============================================================================

/**
 * Helper type for creating events with typed payloads.
 * This ensures the payload matches the event type.
 */
type EventPayloadMap = {
  message_added: import("@/types").MessageAddedPayload;
  conversation_created: import("@/types").ConversationCreatedPayload;
  conversation_switched: import("@/types").ConversationSwitchedPayload;
  branch_created: import("@/types").BranchCreatedPayload;
  branch_merged: import("@/types").BranchMergedPayload;
  branch_abandoned: import("@/types").BranchAbandonedPayload;
  branch_reverted: import("@/types").BranchRevertedPayload;
  fork_created: import("@/types").ForkCreatedPayload;
  fork_created_resolved: import("@/types").ForkCreatedResolvedPayload;
  path_chosen: import("@/types").PathChosenPayload;
  path_dismissed: import("@/types").PathDismissedPayload;
  path_reopened: import("@/types").PathReopenedPayload;
  obligation_created: import("@/types").ObligationCreatedPayload;
  obligation_created_resolved: import("@/types").ObligationCreatedResolvedPayload;
  obligation_state_changed: import("@/types").ObligationStateChangedPayload;
  obligation_notes_updated: import("@/types").ObligationNotesUpdatedPayload;
  message_linked_to_entries: import("@/types").MessageLinkedToEntriesPayload;
  llm_interaction: import("@/types").LlmInteractionPayload;
};

/**
 * Append an event to the event log.
 * Events are only logged for live conversations (not isolated branches).
 */
function appendEvent<T extends EventType>(type: T, payload: EventPayloadMap[T]): void {
  // Only log events for live conversations (main timeline)
  const conversation = state.conversations.find((c) => c.id === state.currentConversationId);
  if (conversation?.type === "isolated") {
    // Branch changes are not logged to the main event log
    return;
  }

  const event: LedgerEvent = {
    id: nanoid(),
    type,
    payload,
    recordedAt: Date.now(),
  } as LedgerEvent;

  state.events.push(event);
}

// =============================================================================
// SUBSCRIPTIONS
// =============================================================================

export function subscribe(fn: LedgerSubscriber): () => void {
  ledgerSubscribers.add(fn);
  return () => ledgerSubscribers.delete(fn);
}

export function subscribeToApp(fn: AppSubscriber): () => void {
  appSubscribers.add(fn);
  return () => appSubscribers.delete(fn);
}

export function getState(): LedgerState {
  return state;
}

export function getAppState(): AppState {
  return appState;
}

// =============================================================================
// LEDGER MANAGEMENT
// =============================================================================

export function createLedger(name: string, persona: Persona = "thinking-partner"): Ledger {
  const now = Date.now();
  const ledger: Ledger = {
    id: nanoid(),
    name,
    persona,
    createdAt: now,
    updatedAt: now,
  };

  appState.ledgers.push(ledger);

  // If this is the first ledger, make it current
  if (appState.ledgers.length === 1) {
    appState.currentLedgerId = ledger.id;
    state = {
      ...defaultLedgerState,
      conversations: [],
      currentConversationId: "",
    };
    ensureDefaultConversation();
    saveLedgerState(ledger.id, state);
  }

  notifyApp();
  if (appState.currentLedgerId === ledger.id) {
    notifyLedger();
  }

  return ledger;
}

export function selectLedger(ledgerId: string): void {
  const ledger = appState.ledgers.find((l) => l.id === ledgerId);
  if (!ledger) return;

  // Save current ledger state before switching (only if not quarantined)
  if (appState.currentLedgerId && !isCurrentLedgerQuarantined()) {
    saveLedgerState(appState.currentLedgerId, state);
  }

  // Switch to new ledger
  appState.currentLedgerId = ledgerId;
  const loadResult = loadLedgerState(ledgerId);

  // Update ledger metadata with migration status
  ledger.schemaVersion = loadResult.schemaVersion;
  ledger.migrationStatus = loadResult.migrationStatus;
  ledger.migrationError = loadResult.migrationError;

  if (loadResult.migrationStatus === "quarantined") {
    console.warn(
      `⚠️ Ledger "${ledger.name}" is quarantined due to: ${loadResult.migrationError}. ` +
        `Data is preserved in localStorage for recovery. Mutations are disabled.`
    );
  }

  state = loadResult.state ?? {
    ...defaultLedgerState,
    conversations: [],
    currentConversationId: "",
  };

  // Only ensure default conversation for healthy ledgers
  if (loadResult.migrationStatus !== "quarantined") {
    ensureDefaultConversation();
  }

  notifyApp();
  notifyLedger();
}

export function renameLedger(ledgerId: string, newName: string): void {
  const ledger = appState.ledgers.find((l) => l.id === ledgerId);
  if (!ledger) return;

  ledger.name = newName;
  ledger.updatedAt = Date.now();
  notifyApp();
}

export function changeLedgerPersona(ledgerId: string, persona: Persona): void {
  const ledger = appState.ledgers.find((l) => l.id === ledgerId);
  if (!ledger) return;

  ledger.persona = persona;
  ledger.updatedAt = Date.now();
  notifyApp();
}

export function deleteLedger(ledgerId: string): void {
  const index = appState.ledgers.findIndex((l) => l.id === ledgerId);
  if (index === -1) return;

  // Remove from list
  appState.ledgers.splice(index, 1);
  deleteLedgerStorage(ledgerId);

  // If we deleted the current ledger, switch to another or clear
  if (appState.currentLedgerId === ledgerId) {
    if (appState.ledgers.length > 0) {
      appState.currentLedgerId = appState.ledgers[0].id;
      const nextLedger = appState.ledgers[0];
      const loadResult = loadLedgerState(appState.currentLedgerId);

      // Update ledger metadata
      nextLedger.schemaVersion = loadResult.schemaVersion;
      nextLedger.migrationStatus = loadResult.migrationStatus;
      nextLedger.migrationError = loadResult.migrationError;

      state = loadResult.state ?? {
        ...defaultLedgerState,
        conversations: [],
        currentConversationId: "",
      };

      // Only ensure default conversation for healthy ledgers
      if (loadResult.migrationStatus !== "quarantined") {
        ensureDefaultConversation();
      }
    } else {
      appState.currentLedgerId = null;
      state = {
        ...defaultLedgerState,
        conversations: [],
        currentConversationId: "",
      };
    }
    notifyLedger();
  }

  notifyApp();
}

export function getLedgers(): Ledger[] {
  return appState.ledgers;
}

export function getCurrentLedger(): Ledger | null {
  if (!appState.currentLedgerId) return null;
  return appState.ledgers.find((l) => l.id === appState.currentLedgerId) ?? null;
}

// Backwards compatibility aliases (deprecated - will be removed in Phase 2)
/** @deprecated Use createLedger instead */
export const createVenture = createLedger;
/** @deprecated Use selectLedger instead */
export const selectVenture = selectLedger;
/** @deprecated Use renameLedger instead */
export const renameVenture = renameLedger;
/** @deprecated Use deleteLedger instead */
export const deleteVenture = deleteLedger;
/** @deprecated Use getLedgers instead */
export const getVentures = getLedgers;
/** @deprecated Use getCurrentLedger instead */
export const getCurrentVenture = getCurrentLedger;

// =============================================================================
// CONVERSATIONS
// =============================================================================

/**
 * Ensure a default conversation exists for the current ledger.
 * Called internally when loading or creating a ledger.
 */
function ensureDefaultConversation(): void {
  if (state.conversations.length === 0) {
    const now = Date.now();
    const conversation: Conversation = {
      id: nanoid(),
      createdAt: now,
      updatedAt: now,
      messages: [],
      currentChatPath: [],
      type: "live",
    };
    state.conversations.push(conversation);
    state.currentConversationId = conversation.id;
  } else if (
    !state.currentConversationId ||
    !state.conversations.find((c) => c.id === state.currentConversationId)
  ) {
    // If currentConversationId is invalid, select the first conversation
    state.currentConversationId = state.conversations[0].id;
  }
}

export function createConversation(name?: string): Conversation {
  const now = Date.now();
  const conversation: Conversation = {
    id: nanoid(),
    name,
    createdAt: now,
    updatedAt: now,
    messages: [],
    currentChatPath: [],
    type: "live",
  };

  state.conversations.push(conversation);
  state.currentConversationId = conversation.id;

  // Emit event
  appendEvent("conversation_created", {
    conversationId: conversation.id,
    name,
    type: "live",
  });

  notify();

  return conversation;
}

export function selectConversation(conversationId: string): void {
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return;

  const fromConversationId = state.currentConversationId;
  state.currentConversationId = conversationId;

  // Emit event
  appendEvent("conversation_switched", {
    fromConversationId,
    toConversationId: conversationId,
  });

  notify();
}

export function renameConversation(conversationId: string, newName: string): void {
  const conversation = state.conversations.find((c) => c.id === conversationId);
  if (!conversation) return;

  conversation.name = newName;
  conversation.updatedAt = Date.now();
  notify();
}

export function deleteConversation(conversationId: string): void {
  const index = state.conversations.findIndex((c) => c.id === conversationId);
  if (index === -1) return;

  // Don't delete the last conversation
  if (state.conversations.length === 1) {
    console.warn("Cannot delete the last conversation");
    return;
  }

  state.conversations.splice(index, 1);

  // If we deleted the current conversation, switch to another
  if (state.currentConversationId === conversationId) {
    state.currentConversationId = state.conversations[0].id;
  }

  notify();
}

export function getCurrentConversation(): Conversation | null {
  return state.conversations.find((c) => c.id === state.currentConversationId) ?? null;
}

export function getConversations(): Conversation[] {
  return state.conversations;
}

/**
 * Execute a callback in the context of a specific conversation.
 * This temporarily sets the current conversation, runs the callback,
 * then restores the original conversation context.
 *
 * Use this when applying API responses that may have been initiated
 * from a different conversation than the one currently selected.
 */
export function withConversationContext<T>(conversationId: string, callback: () => T): T {
  const originalConversationId = state.currentConversationId;
  const targetConversation = state.conversations.find((c) => c.id === conversationId);

  if (!targetConversation) {
    console.warn(
      `withConversationContext: conversation ${conversationId} not found, using current`
    );
    return callback();
  }

  try {
    // Temporarily switch context (without notify - we don't want UI to flicker)
    state.currentConversationId = conversationId;
    return callback();
  } finally {
    // Restore original context
    state.currentConversationId = originalConversationId;
    // Single notify at the end to update UI with all changes
    notify();
  }
}

// =============================================================================
// BRANCHES (Isolated Conversations)
// =============================================================================

/**
 * Create an isolated branch from the current conversation.
 * The branch gets a snapshot of current entries and will not affect shared state.
 */
export function createBranch(name?: string): Conversation {
  const now = Date.now();
  const sourceConversation = getCurrentConversation();

  // Deep clone entries for the snapshot
  const entrySnapshot = JSON.parse(JSON.stringify(state.entries)) as Entry[];

  const branch: Conversation = {
    id: nanoid(),
    name: name ?? "What-if",
    createdAt: now,
    updatedAt: now,
    messages: [],
    currentChatPath: [],
    type: "isolated",
    branchedFrom: {
      conversationId: sourceConversation?.id ?? "",
      timestamp: now,
      entrySnapshot,
    },
    localEntries: [],
    localDecisions: [],
    status: "active",
  };

  state.conversations.push(branch);

  // Emit event before switching to branch (while still in live context)
  appendEvent("branch_created", {
    branchId: branch.id,
    name: branch.name,
    sourceConversationId: sourceConversation?.id ?? "",
    entrySnapshotIds: entrySnapshot.map((e) => e.id),
  });

  state.currentConversationId = branch.id;
  notify();

  return branch;
}

/**
 * Create an isolated branch from a specific message (the divergence point).
 * Messages are copied from root through the parent of the divergence point.
 * The divergence point itself is NOT copied — it's what the user is replacing.
 * Entry snapshot is reconstructed at the parent message's timestamp.
 */
export function createBranchFromMessage(messageId: string, name?: string): Conversation | null {
  if (!checkMutationAllowed("createBranchFromMessage")) {
    return null;
  }

  const sourceConversation = getCurrentConversation();
  if (!sourceConversation) return null;

  const targetMessage = sourceConversation.messages.find((m) => m.id === messageId);
  if (!targetMessage) return null;

  const now = Date.now();

  // Determine which messages to copy (root through parent of divergence point)
  let clonedMessages: ChatMessage[] = [];
  let clonedChatPath: string[] = [];
  let snapshotTimestamp: number;

  if (targetMessage.parentId) {
    // Walk from parent to root to get the path to copy
    const pathToCopy = getPathToMessage(targetMessage.parentId);

    // Deep clone the messages on that path
    const pathSet = new Set(pathToCopy);
    clonedMessages = sourceConversation.messages
      .filter((m) => pathSet.has(m.id))
      .map((m) => JSON.parse(JSON.stringify(m)) as ChatMessage);

    // Linearize: each message's childIds should only contain the next in path
    for (let i = 0; i < clonedMessages.length; i++) {
      if (i < clonedMessages.length - 1) {
        clonedMessages[i].childIds = [clonedMessages[i + 1].id];
      } else {
        clonedMessages[i].childIds = [];
      }
    }

    clonedChatPath = pathToCopy;

    // Use parent message's recordedAt for the entry snapshot
    const parentMessage = sourceConversation.messages.find((m) => m.id === targetMessage.parentId);
    snapshotTimestamp = parentMessage?.recordedAt ?? now;
  } else {
    // Target is root message — no messages to copy, empty snapshot
    snapshotTimestamp = 0;
  }

  // Build entry snapshot by reconstructing state at the snapshot timestamp
  let entrySnapshot: Entry[];
  if (snapshotTimestamp === 0) {
    entrySnapshot = [];
  } else {
    const reconstructed = reconstructStateAtTime(state.events, snapshotTimestamp);
    entrySnapshot = JSON.parse(JSON.stringify(reconstructed.entries)) as Entry[];
  }

  const branch: Conversation = {
    id: nanoid(),
    name: name ?? "Branch",
    createdAt: now,
    updatedAt: now,
    messages: clonedMessages,
    currentChatPath: clonedChatPath,
    type: "isolated",
    branchedFrom: {
      conversationId: sourceConversation.id,
      timestamp: snapshotTimestamp,
      entrySnapshot,
      sourceMessageId: messageId,
    },
    localEntries: [],
    localDecisions: [],
    status: "active",
  };

  state.conversations.push(branch);

  // Emit event before switching to branch (while still in live context)
  appendEvent("branch_created", {
    branchId: branch.id,
    name: branch.name,
    sourceConversationId: sourceConversation.id,
    entrySnapshotIds: entrySnapshot.map((e) => e.id),
    sourceMessageId: messageId,
  });

  state.currentConversationId = branch.id;
  notify();

  return branch;
}

/**
 * Check if the current conversation is isolated (a branch).
 */
export function isCurrentConversationIsolated(): boolean {
  const conversation = getCurrentConversation();
  return conversation?.type === "isolated";
}

/**
 * Get the effective entries for the current conversation.
 * - For live conversations: returns shared entries
 * - For isolated conversations: returns snapshot + local modifications
 */
export function getEffectiveEntries(): Entry[] {
  const conversation = getCurrentConversation();
  if (!conversation) return state.entries;

  if (conversation.type === "isolated" && conversation.branchedFrom) {
    // Start with the snapshot from when branched
    const baseEntries = conversation.branchedFrom.entrySnapshot;
    const localEntries = conversation.localEntries ?? [];

    // Merge: local entries override snapshot entries by ID
    const entriesById = new Map<string, Entry>();
    baseEntries.forEach((e) => entriesById.set(e.id, e));
    localEntries.forEach((e) => entriesById.set(e.id, e));

    return Array.from(entriesById.values());
  }

  return state.entries;
}

/**
 * Get the effective decisions for the current conversation.
 * - For live conversations: returns shared decisions
 * - For isolated conversations: returns shared + local decisions
 */
export function getEffectiveDecisions(): DecisionRecord[] {
  const conversation = getCurrentConversation();
  if (!conversation) return state.decisions;

  if (conversation.type === "isolated") {
    const localDecisions = conversation.localDecisions ?? [];
    // For branches, return decisions up to branch point + local decisions
    const branchTimestamp = conversation.branchedFrom?.timestamp ?? 0;
    const preExistingDecisions = state.decisions.filter((d) => d.recordedAt <= branchTimestamp);
    return [...preExistingDecisions, ...localDecisions];
  }

  return state.decisions;
}

/**
 * Get the number of meaningful changes in a branch.
 * Counts: decisions made + new entries created (not in snapshot).
 * Returns 0 for non-branch conversations.
 */
export function getBranchChangeCount(conversationId?: string): number {
  const conversation = conversationId
    ? state.conversations.find((c) => c.id === conversationId)
    : getCurrentConversation();

  if (!conversation || conversation.type !== "isolated") return 0;

  const decisions = conversation.localDecisions?.length ?? 0;

  // Count new entries (not in snapshot) - these are truly new, not just modified
  const snapshotIds = new Set(conversation.branchedFrom?.entrySnapshot.map((e) => e.id) ?? []);
  const newEntries = (conversation.localEntries ?? []).filter((e) => !snapshotIds.has(e.id)).length;

  return decisions + newEntries;
}

/**
 * Check if a branch has been merged.
 */
export function isBranchMerged(conversationId?: string): boolean {
  const conversation = conversationId
    ? state.conversations.find((c) => c.id === conversationId)
    : getCurrentConversation();

  return conversation?.mergedAt !== undefined;
}

/**
 * Merge a branch's local changes back to the main/shared state.
 * - Local entries are merged into state.entries (updates existing or adds new)
 * - Local decisions are appended to state.decisions
 * - Branch is marked as merged and becomes read-only
 */
export function mergeBranch(conversationId?: string): boolean {
  const conversation = conversationId
    ? state.conversations.find((c) => c.id === conversationId)
    : getCurrentConversation();

  if (!conversation || conversation.type !== "isolated") {
    console.warn("mergeBranch: conversation is not a branch");
    return false;
  }

  if (conversation.mergedAt) {
    console.warn("mergeBranch: branch already merged");
    return false;
  }

  const localEntries = conversation.localEntries ?? [];
  const localDecisions = conversation.localDecisions ?? [];
  const mergedEntryIds: string[] = [];
  const mergedDecisionIds: string[] = [];

  // Merge entries: update existing or add new
  for (const localEntry of localEntries) {
    const existingIndex = state.entries.findIndex((e) => e.id === localEntry.id);
    if (existingIndex >= 0) {
      // Update existing entry
      state.entries[existingIndex] = JSON.parse(JSON.stringify(localEntry));
    } else {
      // Add new entry
      state.entries.push(JSON.parse(JSON.stringify(localEntry)));
    }
    mergedEntryIds.push(localEntry.id);
  }

  // Append decisions (with updated conversationId to indicate source)
  for (const localDecision of localDecisions) {
    const mergedDecision = {
      ...JSON.parse(JSON.stringify(localDecision)),
      // Record that this decision came from a branch merge
      mergedFromBranch: conversation.id,
    };
    state.decisions.push(mergedDecision);
    mergedDecisionIds.push(mergedDecision.id);
  }

  // Mark branch as merged
  conversation.mergedAt = Date.now();

  // Emit event (manually append since we want this on main timeline)
  // Save current conversation, temporarily switch to live to emit event
  const branchId = conversation.id;
  const originalConversationId = state.currentConversationId;
  const sourceConversationId =
    conversation.branchedFrom?.conversationId ??
    state.conversations.find((c) => c.type === "live")?.id ??
    "";

  // Temporarily switch to source conversation to emit event on main timeline
  if (sourceConversationId) {
    state.currentConversationId = sourceConversationId;
    appendEvent("branch_merged", {
      branchId,
      mergedEntryIds,
      mergedDecisionIds,
    });
    state.currentConversationId = originalConversationId;
  }

  // Update branch status
  conversation.status = "merged";

  notify();
  return true;
}

/**
 * Abandon a branch (mark it as explicitly abandoned).
 * This means the user decided not to pursue this direction.
 * The branch remains in the conversation list but is marked as abandoned.
 *
 * @param conversationId - The branch to abandon (must be isolated type)
 * @param reason - Optional explanation for why the branch was abandoned
 * @returns true if successful
 */
export function abandonBranch(conversationId: string, reason?: string): boolean {
  const conversation = state.conversations.find((c) => c.id === conversationId);

  if (!conversation) {
    console.warn(`Cannot abandon branch: conversation ${conversationId} not found`);
    return false;
  }

  if (conversation.type !== "isolated") {
    console.warn(`Cannot abandon branch: conversation ${conversationId} is not an isolated branch`);
    return false;
  }

  if (conversation.status === "merged") {
    console.warn(`Cannot abandon branch: conversation ${conversationId} is already merged`);
    return false;
  }

  if (conversation.status === "abandoned") {
    console.warn(`Branch ${conversationId} is already abandoned`);
    return false;
  }

  // Mark branch as abandoned
  conversation.status = "abandoned";

  // Emit event on main timeline
  const branchId = conversation.id;
  const originalConversationId = state.currentConversationId;
  const sourceConversationId =
    conversation.branchedFrom?.conversationId ??
    state.conversations.find((c) => c.type === "live")?.id ??
    "";

  if (sourceConversationId) {
    state.currentConversationId = sourceConversationId;
    appendEvent("branch_abandoned", {
      branchId,
      reason,
    });
    state.currentConversationId = originalConversationId;
  }

  notify();
  return true;
}

/**
 * Revert a previously merged branch.
 * This marks the branch as reverted and removes its entries/decisions from main.
 *
 * @param conversationId - The branch to revert (must be isolated type and already merged)
 * @param reason - Optional explanation for why the branch was reverted
 * @returns true if successful
 */
export function revertBranch(conversationId: string, reason?: string): boolean {
  const conversation = state.conversations.find((c) => c.id === conversationId);

  if (!conversation) {
    console.warn(`Cannot revert branch: conversation ${conversationId} not found`);
    return false;
  }

  if (conversation.type !== "isolated") {
    console.warn(`Cannot revert branch: conversation ${conversationId} is not an isolated branch`);
    return false;
  }

  if (conversation.status !== "merged") {
    console.warn(`Cannot revert branch: conversation ${conversationId} is not merged`);
    return false;
  }

  // Get the entry IDs that were merged from this branch
  const localEntryIds = new Set(conversation.localEntries?.map((e) => e.id) ?? []);
  const localDecisionIds = new Set(conversation.localDecisions?.map((d) => d.id) ?? []);

  // Build a map of pre-branch entry states from the snapshot
  const snapshotEntryMap = new Map<string, Entry>();
  for (const entry of conversation.branchedFrom?.entrySnapshot ?? []) {
    snapshotEntryMap.set(entry.id, entry);
  }

  // Restore or remove merged entries from main state
  state.entries = state.entries.flatMap((e) => {
    if (!localEntryIds.has(e.id)) return [e];
    // If entry existed before the branch, restore to pre-branch state
    const snapshotEntry = snapshotEntryMap.get(e.id);
    if (snapshotEntry) return [JSON.parse(JSON.stringify(snapshotEntry)) as Entry];
    // If entry was created by the branch, remove it
    return [];
  });

  // Remove only branch-created decisions from main state
  state.decisions = state.decisions.filter((d) => !localDecisionIds.has(d.id));

  // Clear merge timestamp and mark as reverted
  conversation.mergedAt = undefined;
  conversation.status = "reverted";

  // Emit event on main timeline
  const branchId = conversation.id;
  const originalConversationId = state.currentConversationId;
  const sourceConversationId =
    conversation.branchedFrom?.conversationId ??
    state.conversations.find((c) => c.type === "live")?.id ??
    "";

  if (sourceConversationId) {
    state.currentConversationId = sourceConversationId;
    appendEvent("branch_reverted", {
      branchId,
      reason,
    });
    state.currentConversationId = originalConversationId;
  }

  notify();
  return true;
}

/**
 * Internal: Get the entries array to mutate based on conversation type.
 * - Live conversations: mutate shared state.entries
 * - Isolated conversations: mutate localEntries
 */
function getMutableEntries(): Entry[] {
  const conversation = getCurrentConversation();
  if (conversation?.type === "isolated") {
    if (!conversation.localEntries) {
      conversation.localEntries = [];
    }
    return conversation.localEntries;
  }
  return state.entries;
}

/**
 * Internal: Push a decision to the correct location based on conversation type.
 */
function pushDecision(decision: DecisionRecord): void {
  const conversation = getCurrentConversation();
  if (conversation?.type === "isolated") {
    if (!conversation.localDecisions) {
      conversation.localDecisions = [];
    }
    conversation.localDecisions.push(decision);
  } else {
    state.decisions.push(decision);
  }
}

/**
 * Internal: Find an entry by predicate, checking both effective entries and for mutations.
 * For isolated conversations, looks in snapshot + local entries.
 */
function findEntryForMutation<T extends Entry>(predicate: (e: Entry) => e is T): T | undefined {
  const conversation = getCurrentConversation();

  if (conversation?.type === "isolated") {
    // First check local entries
    const localEntry = conversation.localEntries?.find(predicate);
    if (localEntry) return localEntry;

    // Then check snapshot
    const snapshotEntry = conversation.branchedFrom?.entrySnapshot.find(predicate);
    if (snapshotEntry) {
      // Clone the snapshot entry into local entries for mutation
      const clone = JSON.parse(JSON.stringify(snapshotEntry)) as T;
      if (!conversation.localEntries) {
        conversation.localEntries = [];
      }
      conversation.localEntries.push(clone);
      return clone;
    }
    return undefined;
  }

  return state.entries.find(predicate);
}

// =============================================================================
// FORKS & PATHS
// =============================================================================

export function createFork(
  title: string,
  why: string,
  paths: Array<{ title: string; why: string }>,
  options?: {
    category?: string;
    phase?: Phase;
    isBinary?: boolean;
    linkedMessageId?: string;
  }
): Fork | null {
  // Mutation guard
  if (!checkMutationAllowed("createFork")) {
    return null;
  }

  // Check for existing fork with same normalized title
  const existing = findExistingForkByNormalizedTitle(title);
  if (existing) {
    // Link message to existing fork if provided
    if (options?.linkedMessageId && !existing.linkedMessageIds?.includes(options.linkedMessageId)) {
      existing.linkedMessageIds = [...(existing.linkedMessageIds || []), options.linkedMessageId];
      notify();
    }
    return existing; // Return existing instead of creating duplicate
  }

  const now = Date.now();
  const forkId = nanoid();

  const pathEntries: Path[] = paths.map((p) => ({
    id: nanoid(),
    type: "path" as const,
    title: p.title,
    why: p.why,
    phase: options?.phase ?? "soon",
    category: options?.category,
    state: "open" as PathState,
    forkId,
    recordedAt: now,
    decidedAt: now,
    linkedMessageIds: options?.linkedMessageId ? [options.linkedMessageId] : undefined,
  }));

  const fork: Fork = {
    id: forkId,
    type: "fork",
    title,
    why,
    phase: options?.phase ?? "soon",
    category: options?.category,
    isBinary: options?.isBinary,
    paths: pathEntries,
    recordedAt: now,
    decidedAt: now,
    linkedMessageIds: options?.linkedMessageId ? [options.linkedMessageId] : undefined,
  };

  getMutableEntries().push(fork);

  // Emit event
  appendEvent("fork_created", {
    forkId,
    title,
    why,
    phase: options?.phase ?? "soon",
    category: options?.category,
    isBinary: options?.isBinary,
    pathIds: pathEntries.map((p) => p.id),
    pathTitles: pathEntries.map((p) => p.title),
    linkedMessageId: options?.linkedMessageId,
  });

  notify();
  return fork;
}

export function choosePath(
  forkId: string,
  pathId: string,
  rationale: string,
  options?: {
    decidedAt?: number;
    linkedMessageId?: string;
  }
): DecisionRecord | null {
  const fork = findEntryForMutation((e): e is Fork => e.id === forkId && isFork(e));
  if (!fork) return null;

  const path = fork.paths.find((p) => p.id === pathId);
  if (!path) return null;

  const now = Date.now();

  // Update path states
  fork.paths.forEach((p) => {
    if (p.id === pathId) {
      p.state = "chosen";
      p.chosenAt = now;
      p.chosenRationale = rationale;
    } else if (p.state === "open") {
      p.state = "dismissed";
    }
  });

  // Create decision record
  const decision: PathDecisionRecord = {
    id: nanoid(),
    kind: "path",
    pathId,
    forkId,
    forkTitle: fork.title,
    pathTitle: path.title,
    rationale,
    recordedAt: now,
    decidedAt: options?.decidedAt ?? now,
    linkedMessageId: options?.linkedMessageId,
    conversationId: state.currentConversationId,
  };

  pushDecision(decision);

  // Emit event
  appendEvent("path_chosen", {
    forkId,
    pathId,
    rationale,
    decisionId: decision.id,
    decidedAt: options?.decidedAt ?? now,
    linkedMessageId: options?.linkedMessageId,
  });

  notify();
  return decision;
}

export function dismissPath(forkId: string, pathId: string): boolean {
  const fork = findEntryForMutation((e): e is Fork => e.id === forkId && isFork(e));
  if (!fork) return false;

  const path = fork.paths.find((p) => p.id === pathId);
  if (!path || path.state !== "open") return false;

  path.state = "dismissed";

  // Emit event
  appendEvent("path_dismissed", {
    forkId,
    pathId,
  });
  notify();
  return true;
}

export function reopenPath(forkId: string, pathId: string): boolean {
  const fork = findEntryForMutation((e): e is Fork => e.id === forkId && isFork(e));
  if (!fork) return false;

  const path = fork.paths.find((p) => p.id === pathId);
  if (!path || path.state !== "dismissed") return false;

  path.state = "open";

  // Emit event
  appendEvent("path_reopened", {
    forkId,
    pathId,
  });

  notify();
  return true;
}

// Find fork by title (for LLM responses that don't know IDs)
export function findForkByTitle(title: string): Fork | undefined {
  const entries = getEffectiveEntriesInternal();
  return entries.find((e) => isFork(e) && e.title.toLowerCase() === title.toLowerCase()) as
    | Fork
    | undefined;
}

// Create a fork with a path already chosen (for reconstruction mode)
export function createResolvedFork(
  title: string,
  why: string,
  paths: Array<{ title: string; why: string }>,
  chosenPathTitle: string,
  rationale: string,
  options?: {
    category?: string;
    decidedAt?: number;
    linkedMessageId?: string;
  }
): { fork: Fork; decision: PathDecisionRecord } | null {
  // Check for existing fork with same normalized title
  const existing = findExistingForkByNormalizedTitle(title);
  if (existing) {
    return null; // Don't create duplicate
  }

  const now = Date.now();
  const decidedAt = options?.decidedAt ?? now;
  const forkId = nanoid();

  // Find the chosen path index
  const chosenIndex = paths.findIndex(
    (p) => p.title.toLowerCase() === chosenPathTitle.toLowerCase()
  );
  if (chosenIndex === -1) {
    console.warn(`Chosen path "${chosenPathTitle}" not found in paths`);
    return null;
  }

  const pathEntries: Path[] = paths.map((p, i) => ({
    id: nanoid(),
    type: "path" as const,
    title: p.title,
    why: p.why,
    phase: "past" as Phase,
    category: options?.category,
    state: i === chosenIndex ? ("chosen" as PathState) : ("dismissed" as PathState),
    forkId,
    recordedAt: now,
    decidedAt,
    chosenAt: i === chosenIndex ? decidedAt : undefined,
    chosenRationale: i === chosenIndex ? rationale : undefined,
    linkedMessageIds: options?.linkedMessageId ? [options.linkedMessageId] : undefined,
  }));

  const fork: Fork = {
    id: forkId,
    type: "fork",
    title,
    why,
    phase: "past",
    category: options?.category,
    paths: pathEntries,
    recordedAt: now,
    decidedAt,
    linkedMessageIds: options?.linkedMessageId ? [options.linkedMessageId] : undefined,
  };

  const chosenPath = pathEntries[chosenIndex];

  const decision: PathDecisionRecord = {
    id: nanoid(),
    kind: "path",
    pathId: chosenPath.id,
    forkId,
    forkTitle: title,
    pathTitle: chosenPath.title,
    rationale,
    recordedAt: now,
    decidedAt,
    linkedMessageId: options?.linkedMessageId,
    conversationId: state.currentConversationId,
  };

  getMutableEntries().push(fork);
  pushDecision(decision);

  // Emit event
  appendEvent("fork_created_resolved", {
    forkId,
    title,
    why,
    category: options?.category,
    pathIds: pathEntries.map((p) => p.id),
    pathTitles: pathEntries.map((p) => p.title),
    chosenPathId: chosenPath.id,
    rationale,
    decisionId: decision.id,
    decidedAt,
    linkedMessageId: options?.linkedMessageId,
  });

  notify();

  return { fork, decision };
}

// Find path by title within a fork
export function findPathByTitle(fork: Fork, title: string): Path | undefined {
  return fork.paths.find((p) => p.title.toLowerCase() === title.toLowerCase());
}

// =============================================================================
// OBLIGATIONS
// =============================================================================

export function createObligation(
  title: string,
  why: string,
  options?: {
    category?: string;
    phase?: Phase;
    linkedMessageId?: string;
    triggeredBy?: string[];
  }
): Obligation | null {
  // Mutation guard
  if (!checkMutationAllowed("createObligation")) {
    return null;
  }

  // Check for existing obligation with same normalized title
  const existing = findExistingObligationByNormalizedTitle(title);
  if (existing) {
    // Link message to existing obligation if provided
    if (options?.linkedMessageId && !existing.linkedMessageIds?.includes(options.linkedMessageId)) {
      existing.linkedMessageIds = [...(existing.linkedMessageIds || []), options.linkedMessageId];
      notify();
    }
    return existing; // Return existing instead of creating duplicate
  }

  const now = Date.now();

  const obligation: Obligation = {
    id: nanoid(),
    type: "obligation",
    title,
    why,
    phase: options?.phase ?? "soon",
    category: options?.category,
    state: "todo",
    recordedAt: now,
    decidedAt: now,
    linkedMessageIds: options?.linkedMessageId ? [options.linkedMessageId] : undefined,
    triggeredBy: options?.triggeredBy,
  };

  getMutableEntries().push(obligation);

  // Emit event
  appendEvent("obligation_created", {
    obligationId: obligation.id,
    title,
    why,
    phase: options?.phase ?? "soon",
    category: options?.category,
    linkedMessageId: options?.linkedMessageId,
    triggeredBy: options?.triggeredBy,
  });

  notify();
  return obligation;
}

// Create an obligation that's already resolved (for reconstruction mode)
export function createResolvedObligation(
  title: string,
  why: string,
  resolvedState: "done" | "wont-do" | "delegated",
  options?: {
    category?: string;
    notes?: string;
    completedAt?: number;
    linkedMessageId?: string;
  }
): { obligation: Obligation; decision: ObligationDecisionRecord } | null {
  // Check for existing obligation with same normalized title
  const existing = findExistingObligationByNormalizedTitle(title);
  if (existing) {
    return null; // Don't create duplicate
  }

  const now = Date.now();
  const completedAt = options?.completedAt ?? now;

  const obligation: Obligation = {
    id: nanoid(),
    type: "obligation",
    title,
    why,
    phase: "past",
    category: options?.category,
    state: resolvedState,
    notes: options?.notes,
    stateChangedAt: completedAt,
    recordedAt: now,
    decidedAt: completedAt,
    linkedMessageIds: options?.linkedMessageId ? [options.linkedMessageId] : undefined,
  };

  const decision: ObligationDecisionRecord = {
    id: nanoid(),
    kind: "obligation",
    obligationId: obligation.id,
    obligationTitle: title,
    previousState: "todo",
    newState: resolvedState,
    notes: options?.notes,
    recordedAt: now,
    decidedAt: completedAt,
    linkedMessageId: options?.linkedMessageId,
    conversationId: state.currentConversationId,
  };

  getMutableEntries().push(obligation);
  pushDecision(decision);

  // Emit event
  appendEvent("obligation_created_resolved", {
    obligationId: obligation.id,
    title,
    why,
    category: options?.category,
    resolvedState,
    notes: options?.notes,
    decisionId: decision.id,
    completedAt,
    linkedMessageId: options?.linkedMessageId,
  });

  notify();

  return { obligation, decision };
}

export function changeObligationState(
  obligationId: string,
  newState: ObligationState,
  options?: {
    notes?: string;
    decidedAt?: number;
    linkedMessageId?: string;
  }
): ObligationDecisionRecord | null {
  const obligation = findEntryForMutation(
    (e): e is Obligation => isObligation(e) && e.id === obligationId
  );

  if (!obligation) return null;

  const now = Date.now();
  const previousState = obligation.state;

  // Don't create a decision if state hasn't changed
  if (previousState === newState && !options?.notes) {
    return null;
  }

  // Update obligation state
  obligation.state = newState;
  obligation.stateChangedAt = now;

  // Update notes if provided
  if (options?.notes !== undefined) {
    obligation.notes = options.notes;
  }

  // Update phase based on new state
  switch (newState) {
    case "done":
    case "wont-do":
    case "delegated":
      obligation.phase = "past";
      break;
    case "parked":
      obligation.phase = "parking-lot";
      break;
    case "todo":
      // When returning to todo, move back to 'soon' (sensible default)
      if (obligation.phase === "past" || obligation.phase === "parking-lot") {
        obligation.phase = "soon";
      }
      break;
  }

  // Create decision record
  const decision: ObligationDecisionRecord = {
    id: nanoid(),
    kind: "obligation",
    obligationId,
    obligationTitle: obligation.title,
    previousState,
    newState,
    notes: options?.notes,
    recordedAt: now,
    decidedAt: options?.decidedAt ?? now,
    linkedMessageId: options?.linkedMessageId,
    conversationId: state.currentConversationId,
  };

  pushDecision(decision);

  // Emit event
  appendEvent("obligation_state_changed", {
    obligationId,
    previousState,
    newState,
    notes: options?.notes,
    decisionId: decision.id,
    decidedAt: options?.decidedAt ?? now,
    linkedMessageId: options?.linkedMessageId,
  });

  notify();
  return decision;
}

export function updateObligationNotes(obligationId: string, notes: string): boolean {
  const obligation = findEntryForMutation(
    (e): e is Obligation => isObligation(e) && e.id === obligationId
  );

  if (!obligation) return false;

  const previousNotes = obligation.notes;
  obligation.notes = notes;

  // Emit event
  appendEvent("obligation_notes_updated", {
    obligationId,
    previousNotes,
    newNotes: notes,
  });

  notify();
  return true;
}

// Update the decidedAt timestamp for an entry (fork or obligation)
export function updateEntryDecidedAt(entryId: string, newDecidedAt: number): boolean {
  const conversation = getCurrentConversation();

  // Handle isolated conversations
  if (conversation?.type === "isolated") {
    // Check local entries first
    const entry = conversation.localEntries?.find((e) => e.id === entryId);
    if (entry) {
      entry.decidedAt = newDecidedAt;
      notify();
      return true;
    }

    // Check snapshot and clone if found
    const snapshotEntry = conversation.branchedFrom?.entrySnapshot.find((e) => e.id === entryId);
    if (snapshotEntry) {
      const clone = JSON.parse(JSON.stringify(snapshotEntry)) as Entry;
      clone.decidedAt = newDecidedAt;
      if (!conversation.localEntries) {
        conversation.localEntries = [];
      }
      conversation.localEntries.push(clone);
      notify();
      return true;
    }
    return false;
  }

  // Main entries
  const entry = state.entries.find((e) => e.id === entryId);
  if (!entry) return false;

  entry.decidedAt = newDecidedAt;
  notify();
  return true;
}

// Update the decidedAt timestamp for a decision record
export function updateDecisionDecidedAt(decisionId: string, newDecidedAt: number): boolean {
  // Check effective decisions (handles isolated conversations)
  const conversation = state.conversations.find((c) => c.id === state.currentConversationId);

  // Determine which decisions array to search
  let decisions: DecisionRecord[];
  if (conversation?.type === "isolated" && conversation.localDecisions) {
    decisions = conversation.localDecisions;
  } else {
    decisions = state.decisions;
  }

  const decision = decisions.find((d) => d.id === decisionId);
  if (!decision) return false;

  decision.decidedAt = newDecidedAt;
  notify();
  return true;
}

// =============================================================================
// CHAT MESSAGES (Tree Structure)
// =============================================================================

export function addMessage(
  role: "user" | "assistant",
  content: string,
  parentId?: string,
  options?: { isError?: boolean }
): ChatMessage {
  // Mutation guard - warn but don't block messages (allow viewing quarantined ledger chat)
  if (!checkMutationAllowed("addMessage")) {
    // For chat, we allow read-only viewing but log the warning
  }

  const conversation = getCurrentConversation();
  if (!conversation) {
    throw new Error("No current conversation");
  }

  const id = nanoid();
  const now = Date.now();

  const message: ChatMessage = {
    id,
    role,
    content,
    recordedAt: now,
    parentId,
    childIds: [],
    linkedEntryIds: [],
    isError: options?.isError,
  };

  // Update parent's childIds if this is a branch
  if (parentId) {
    const parent = conversation.messages.find((m) => m.id === parentId);
    if (parent) {
      parent.childIds.push(id);
    }
  }

  conversation.messages.push(message);
  conversation.updatedAt = now;

  // Update current chat path
  if (!parentId) {
    conversation.currentChatPath = [id];
  } else {
    // Find the path from root to this message
    conversation.currentChatPath = getPathToMessage(id);
  }

  // Emit event
  appendEvent("message_added", {
    messageId: id,
    conversationId: conversation.id,
    role,
    content,
    parentId,
  });

  notify();
  return message;
}

// Remove a message from the conversation (used for removing error messages on retry)
export function removeMessage(messageId: string): void {
  const conversation = getCurrentConversation();
  if (!conversation) return;

  const messageIndex = conversation.messages.findIndex((m) => m.id === messageId);
  if (messageIndex === -1) return;

  const message = conversation.messages[messageIndex];

  // Remove from parent's childIds
  if (message.parentId) {
    const parent = conversation.messages.find((m) => m.id === message.parentId);
    if (parent) {
      parent.childIds = parent.childIds.filter((id) => id !== messageId);
    }
  }

  // Remove from current chat path if present
  conversation.currentChatPath = conversation.currentChatPath.filter((id) => id !== messageId);

  // Remove the message itself
  conversation.messages.splice(messageIndex, 1);
  conversation.updatedAt = Date.now();

  notify();
}

// Get the path from root to a specific message
export function getPathToMessage(messageId: string): string[] {
  const conversation = getCurrentConversation();
  if (!conversation) return [];

  const path: string[] = [];
  let current = conversation.messages.find((m) => m.id === messageId);

  while (current) {
    path.unshift(current.id);
    current = current.parentId
      ? conversation.messages.find((m) => m.id === current!.parentId)
      : undefined;
  }

  return path;
}

// Get messages in current linear path
export function getCurrentChatMessages(): ChatMessage[] {
  const conversation = getCurrentConversation();
  if (!conversation) return [];

  return conversation.currentChatPath
    .map((id) => conversation.messages.find((m) => m.id === id))
    .filter((m): m is ChatMessage => m !== undefined);
}

// Link a message to entries
export function linkMessageToEntries(messageId: string, entryIds: string[]): void {
  const conversation = getCurrentConversation();
  if (!conversation) return;

  const message = conversation.messages.find((m) => m.id === messageId);
  if (message) {
    message.linkedEntryIds = [...(message.linkedEntryIds || []), ...entryIds];
  }

  // Also link entries back to message
  entryIds.forEach((entryId) => {
    const entry = state.entries.find((e) => e.id === entryId);
    if (entry) {
      entry.linkedMessageIds = [...(entry.linkedMessageIds || []), messageId];
    }
    // Also check paths within forks
    state.entries.forEach((e) => {
      if (isFork(e)) {
        const path = e.paths.find((p) => p.id === entryId);
        if (path) {
          path.linkedMessageIds = [...(path.linkedMessageIds || []), messageId];
        }
      }
    });
  });

  // Emit event
  if (entryIds.length > 0) {
    appendEvent("message_linked_to_entries", {
      messageId,
      entryIds,
    });
  }

  notify();
}

// =============================================================================
// QUERIES
// =============================================================================

// Get all forks
export function getForks(): Fork[] {
  return state.entries.filter(isFork) as Fork[];
}

// Get all obligations
export function getObligations(): Obligation[] {
  return state.entries.filter((e) => e.type === "obligation") as Obligation[];
}

// Get entries linked to a message
export function getEntriesForMessage(messageId: string): Entry[] {
  const results: Entry[] = [];

  state.entries.forEach((entry) => {
    if (entry.linkedMessageIds?.includes(messageId)) {
      results.push(entry);
    }
    if (isFork(entry)) {
      entry.paths.forEach((path) => {
        if (path.linkedMessageIds?.includes(messageId)) {
          results.push(path);
        }
      });
    }
  });

  return results;
}

// Get message linked to an entry
export function getMessagesForEntry(entryId: string): ChatMessage[] {
  const conversation = getCurrentConversation();
  if (!conversation) return [];

  // Find the entry
  let linkedMessageIds: string[] = [];

  const entry = state.entries.find((e) => e.id === entryId);
  if (entry) {
    linkedMessageIds = entry.linkedMessageIds || [];
  } else {
    // Check paths within forks
    for (const e of state.entries) {
      if (isFork(e)) {
        const path = e.paths.find((p) => p.id === entryId);
        if (path) {
          linkedMessageIds = path.linkedMessageIds || [];
          break;
        }
      }
    }
  }

  return linkedMessageIds
    .map((id) => conversation.messages.find((m) => m.id === id))
    .filter((m): m is ChatMessage => m !== undefined);
}

// =============================================================================
// RESET
// =============================================================================

/** Reset the current ledger's state */
export function resetCurrentLedger(): void {
  state = {
    entries: [],
    decisions: [],
    conversations: [],
    currentConversationId: "",
    events: [],
  };
  ensureDefaultConversation();
  notify();
}

/** Clear all data (all ledgers) */
export function resetAllData(): void {
  clearAllStorage();
  appState = { ...defaultAppState };
  state = { ...defaultLedgerState };
  notifyApp();
  notifyLedger();
}

/** @deprecated Use resetCurrentLedger or resetAllData instead */
export function resetStore(): void {
  resetCurrentLedger();
}

/** @deprecated Use resetCurrentLedger instead */
export const resetCurrentVenture = resetCurrentLedger;

// =============================================================================
// IMPORT
// =============================================================================

// Serialized conversation for import/export
interface ImportedConversation {
  id: string;
  name?: string;
  createdAt: number;
  updatedAt: number;
  messages: ChatMessage[];
  currentChatPath: string[];
  type: ConversationType;
}

interface ImportedState {
  facts?: Array<[string, unknown]>; // Legacy field, no longer used
  entries: Entry[];
  decisions: DecisionRecord[];
  // New format: conversations
  conversations?: ImportedConversation[];
  currentConversationId?: string;
  // Legacy format: messages at top level (v2 and earlier)
  messages?: ChatMessage[];
  currentChatPath?: string[];
}

interface ImportedLedger {
  name: string;
  persona?: Persona;
  mode?: string; // Legacy field for backward compatibility
  createdAt: number;
  updatedAt: number;
}

/**
 * Import data as a new ledger.
 * If a ledger with the same name exists, adds a numeric suffix.
 */
export function importAsNewLedger(
  ledgerInfo: ImportedLedger,
  importedState: ImportedState
): Ledger {
  // Handle name conflicts
  let name = ledgerInfo.name;
  let suffix = 1;
  while (appState.ledgers.some((l) => l.name === name)) {
    suffix++;
    name = `${ledgerInfo.name} (${suffix})`;
  }

  const now = Date.now();
  // Support both persona (new format) and mode (legacy format)
  const persona: Persona =
    ledgerInfo.persona ??
    (ledgerInfo.mode ? migrateModeToPerson(ledgerInfo.mode) : "thinking-partner");
  const ledger: Ledger = {
    id: nanoid(),
    name,
    persona,
    createdAt: ledgerInfo.createdAt || now,
    updatedAt: now,
  };

  // Handle migration from legacy format (messages at top level) to new format (conversations)
  let conversations: Conversation[];
  let currentConversationId: string;

  if (importedState.conversations && importedState.conversations.length > 0) {
    // New format: use conversations directly
    conversations = importedState.conversations;
    // Validate currentConversationId exists in conversations, fall back to first
    const candidateId = importedState.currentConversationId ?? conversations[0].id;
    currentConversationId = conversations.some((c) => c.id === candidateId)
      ? candidateId
      : conversations[0].id;
  } else if (importedState.messages) {
    // Legacy format: wrap messages into a single conversation
    const defaultConversationId = nanoid();
    conversations = [
      {
        id: defaultConversationId,
        createdAt: importedState.messages[0]?.recordedAt ?? now,
        updatedAt: importedState.messages[importedState.messages.length - 1]?.recordedAt ?? now,
        messages: importedState.messages,
        currentChatPath: importedState.currentChatPath ?? [],
        type: "live",
      },
    ];
    currentConversationId = defaultConversationId;
  } else {
    // No messages at all: create empty conversation
    const defaultConversationId = nanoid();
    conversations = [
      {
        id: defaultConversationId,
        createdAt: now,
        updatedAt: now,
        messages: [],
        currentChatPath: [],
        type: "live",
      },
    ];
    currentConversationId = defaultConversationId;
  }

  // Ensure all decisions have conversationId (for legacy imports)
  const decisions = (importedState.decisions ?? []).map((d) => ({
    ...d,
    conversationId: d.conversationId ?? currentConversationId,
  }));

  // Create the ledger state from imported data
  // Note: imported events are preserved if present, otherwise start fresh
  const newState: LedgerState = {
    entries: importedState.entries,
    decisions,
    conversations,
    currentConversationId,
    events: (importedState as ImportedState & { events?: LedgerEvent[] }).events ?? [],
  };

  // Save the ledger and its state
  appState.ledgers.push(ledger);
  saveLedgerState(ledger.id, newState);

  // Switch to the new ledger
  if (appState.currentLedgerId) {
    saveLedgerState(appState.currentLedgerId, state);
  }
  appState.currentLedgerId = ledger.id;
  state = newState;

  notifyApp();
  notifyLedger();

  return ledger;
}

/**
 * Replace the current ledger's data with imported data.
 * Keeps the same ledger ID and name.
 */
export function replaceCurrentLedgerData(importedState: ImportedState): void {
  if (!appState.currentLedgerId) {
    // No current ledger, create one
    const now = Date.now();
    const ledger: Ledger = {
      id: nanoid(),
      name: "Imported Ledger",
      persona: "thinking-partner",
      createdAt: now,
      updatedAt: now,
    };
    appState.ledgers.push(ledger);
    appState.currentLedgerId = ledger.id;
    notifyApp();
  }

  const now = Date.now();

  // Handle migration from legacy format (messages at top level) to new format (conversations)
  let conversations: Conversation[];
  let currentConversationId: string;

  if (importedState.conversations && importedState.conversations.length > 0) {
    // New format: use conversations directly
    conversations = importedState.conversations;
    // Validate currentConversationId exists in conversations, fall back to first
    const candidateId = importedState.currentConversationId ?? conversations[0].id;
    currentConversationId = conversations.some((c) => c.id === candidateId)
      ? candidateId
      : conversations[0].id;
  } else if (importedState.messages) {
    // Legacy format: wrap messages into a single conversation
    const defaultConversationId = nanoid();
    conversations = [
      {
        id: defaultConversationId,
        createdAt: importedState.messages[0]?.recordedAt ?? now,
        updatedAt: importedState.messages[importedState.messages.length - 1]?.recordedAt ?? now,
        messages: importedState.messages,
        currentChatPath: importedState.currentChatPath ?? [],
        type: "live",
      },
    ];
    currentConversationId = defaultConversationId;
  } else {
    // No messages at all: create empty conversation
    const defaultConversationId = nanoid();
    conversations = [
      {
        id: defaultConversationId,
        createdAt: now,
        updatedAt: now,
        messages: [],
        currentChatPath: [],
        type: "live",
      },
    ];
    currentConversationId = defaultConversationId;
  }

  // Ensure all decisions have conversationId (for legacy imports)
  const decisions = (importedState.decisions ?? []).map((d) => ({
    ...d,
    conversationId: d.conversationId ?? currentConversationId,
  }));

  // Replace state with imported data
  // Note: imported events are preserved if present, otherwise start fresh
  state = {
    entries: importedState.entries,
    decisions,
    conversations,
    currentConversationId,
    events: (importedState as ImportedState & { events?: LedgerEvent[] }).events ?? [],
  };

  notifyLedger();
}

// =============================================================================
// LLM INTERACTION TRACKING (for simulator/replay)
// =============================================================================

/**
 * Get the current event count.
 * Used to track which events are spawned during LLM response processing.
 */
export function getEventCount(): number {
  return state.events.length;
}

/**
 * Get event IDs from a starting index.
 * Used to collect the IDs of events spawned during LLM response processing.
 */
export function getEventIdsSince(startIndex: number): string[] {
  return state.events.slice(startIndex).map((e) => e.id);
}

/**
 * Record an LLM interaction event.
 * This captures the full request/response context for replay and debugging.
 *
 * @param payload - The LLM interaction payload
 */
export function recordLlmInteraction(payload: import("@/types").LlmInteractionPayload): void {
  appendEvent("llm_interaction", payload);
  notify();
}

// Backwards compatibility aliases (deprecated - will be removed in Phase 2)
/** @deprecated Use importAsNewLedger instead */
export const importAsNewVenture = importAsNewLedger;
/** @deprecated Use replaceCurrentLedgerData instead */
export const replaceCurrentVentureData = replaceCurrentLedgerData;

// =============================================================================
// SAMPLE LEDGER
// =============================================================================

/**
 * Load the bundled sample ledger as a read-only ledger.
 * Returns the created ledger, or null if it already exists.
 */
export function loadSampleLedger(): Ledger | null {
  // Check if sample is already loaded
  const existing = appState.ledgers.find((l) => l.isSample);
  if (existing) {
    // Just switch to it
    selectLedger(existing.id);
    return existing;
  }

  // Dynamic import is not available in sync context, so we use require-style
  // The JSON is statically bundled by Next.js
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const sampleData = require("@/data/sample-ledger.json");

  const ledger = importAsNewLedger(sampleData.ledger, sampleData.state);

  // Mark as sample (read-only)
  ledger.isSample = true;
  ledger.name = "Sample: Block Party";
  saveAppState(appState);

  return ledger;
}

/**
 * Check if the current ledger is a read-only sample.
 */
export function isCurrentLedgerSample(): boolean {
  const ledger = getCurrentLedger();
  return ledger?.isSample === true;
}
