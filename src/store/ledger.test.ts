import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock nanoid before importing the store
vi.mock("nanoid", () => {
  let counter = 0;
  return {
    nanoid: () => `test-id-${++counter}`,
  };
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: vi.fn((key: string) => store[key] ?? null),
    setItem: vi.fn((key: string, value: string) => {
      store[key] = value;
    }),
    removeItem: vi.fn((key: string) => {
      delete store[key];
    }),
    clear: vi.fn(() => {
      store = {};
    }),
    get length() {
      return Object.keys(store).length;
    },
    key: vi.fn((index: number) => Object.keys(store)[index] ?? null),
    // Expose internal store for assertions
    _store: store,
    _reset: () => {
      store = {};
    },
  };
})();

Object.defineProperty(globalThis, "localStorage", { value: localStorageMock });

// Helper to get a fresh store module
async function getStore() {
  vi.resetModules();
  // Reset nanoid counter
  vi.doMock("nanoid", () => {
    let counter = 0;
    return {
      nanoid: () => `test-id-${++counter}`,
    };
  });
  return import("./ledger");
}

describe("ledger store", () => {
  beforeEach(() => {
    localStorageMock.clear();
    localStorageMock.getItem.mockClear();
    localStorageMock.setItem.mockClear();
    localStorageMock.removeItem.mockClear();
    (localStorageMock as any)._reset();
  });

  // --- Ledger CRUD ---

  it("auto-creates a default ledger on fresh load", async () => {
    const store = await getStore();
    const ledgers = store.getLedgers();
    expect(ledgers.length).toBeGreaterThanOrEqual(1);
    expect(ledgers[0].name).toBe("My Ledger");
  });

  it("creates a new ledger", async () => {
    const store = await getStore();
    const before = store.getLedgers().length;
    store.createLedger("Test Project");
    expect(store.getLedgers().length).toBe(before + 1);
    expect(store.getLedgers().find((l) => l.name === "Test Project")).toBeDefined();
  });

  it("selects a ledger", async () => {
    const store = await getStore();
    const ledger = store.createLedger("Second Ledger");
    store.selectLedger(ledger.id);
    expect(store.getCurrentLedger()?.id).toBe(ledger.id);
  });

  it("renames a ledger", async () => {
    const store = await getStore();
    const ledger = store.getCurrentLedger()!;
    store.renameLedger(ledger.id, "Renamed");
    expect(store.getCurrentLedger()?.name).toBe("Renamed");
  });

  it("deletes a ledger and switches to another", async () => {
    const store = await getStore();
    const firstLedger = store.getCurrentLedger()!;
    const secondLedger = store.createLedger("Second");
    store.selectLedger(firstLedger.id);

    store.deleteLedger(firstLedger.id);
    expect(store.getLedgers().length).toBe(1);
    expect(store.getCurrentLedger()?.id).toBe(secondLedger.id);
  });

  // --- Fork creation & deduplication ---

  it("creates a fork", async () => {
    const store = await getStore();
    const fork = store.createFork("Which DB?", "Need persistence", [
      { title: "Postgres", why: "Reliable" },
      { title: "SQLite", why: "Simple" },
    ]);

    expect(fork).not.toBeNull();
    expect(fork!.title).toBe("Which DB?");
    expect(fork!.paths).toHaveLength(2);
    expect(store.getState().entries).toHaveLength(1);
  });

  it("deduplicates forks by normalized title", async () => {
    const store = await getStore();
    store.createFork("Which DB?", "Need persistence", [{ title: "Postgres", why: "Reliable" }]);
    const duplicate = store.createFork("Which DB!", "Dup", [{ title: "MySQL", why: "Also good" }]);

    // Should return existing, not create new
    expect(store.getState().entries).toHaveLength(1);
    expect(duplicate?.title).toBe("Which DB?");
  });

  // --- choosePath ---

  it("marks path as chosen and dismisses others", async () => {
    const store = await getStore();
    const fork = store.createFork("Pick one", "Decide", [
      { title: "A", why: "Option A" },
      { title: "B", why: "Option B" },
    ])!;

    const decision = store.choosePath(fork.id, fork.paths[0].id, "Prefer A");

    expect(decision).not.toBeNull();
    expect(decision!.kind).toBe("path");

    // Re-read from state
    const updatedFork = store.getState().entries[0] as any;
    expect(updatedFork.paths[0].state).toBe("chosen");
    expect(updatedFork.paths[1].state).toBe("dismissed");
  });

  // --- Obligation creation & deduplication ---

  it("creates an obligation", async () => {
    const store = await getStore();
    const obligation = store.createObligation("Set up CI", "Needed for deploy", {
      phase: "now",
    });

    expect(obligation).not.toBeNull();
    expect(obligation!.title).toBe("Set up CI");
    expect(obligation!.state).toBe("todo");
  });

  it("deduplicates obligations by normalized title", async () => {
    const store = await getStore();
    store.createObligation("Set up CI", "Needed");
    const dup = store.createObligation("Set up CI!", "Dup");
    expect(store.getState().entries.filter((e) => e.type === "obligation")).toHaveLength(1);
    expect(dup?.title).toBe("Set up CI");
  });

  // --- changeObligationState ---

  it("changes obligation state and updates phase", async () => {
    const store = await getStore();
    const obligation = store.createObligation("Task", "Reason")!;

    const decision = store.changeObligationState(obligation.id, "done");
    expect(decision).not.toBeNull();
    expect(decision!.kind).toBe("obligation");

    const updated = store.getState().entries[0] as any;
    expect(updated.state).toBe("done");
    expect(updated.phase).toBe("past");
  });

  it("moves obligation to parking-lot when parked", async () => {
    const store = await getStore();
    const obligation = store.createObligation("Task", "Reason")!;

    store.changeObligationState(obligation.id, "parked");
    const updated = store.getState().entries[0] as any;
    expect(updated.state).toBe("parked");
    expect(updated.phase).toBe("parking-lot");
  });

  it("returns null when state hasn't changed", async () => {
    const store = await getStore();
    const obligation = store.createObligation("Task", "Reason")!;
    const decision = store.changeObligationState(obligation.id, "todo");
    expect(decision).toBeNull();
  });

  // --- Messages ---

  it("adds a message to current conversation", async () => {
    const store = await getStore();
    const msg = store.addMessage("user", "Hello world");

    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello world");
    expect(store.getCurrentChatMessages()).toHaveLength(1);
  });

  it("links messages to entries", async () => {
    const store = await getStore();
    const msg = store.addMessage("user", "Hello");
    const fork = store.createFork("Test", "Why", [{ title: "A", why: "A" }])!;

    store.linkMessageToEntries(msg.id, [fork.id]);

    const conversation = store.getCurrentConversation()!;
    const linkedMsg = conversation.messages.find((m) => m.id === msg.id)!;
    expect(linkedMsg.linkedEntryIds).toContain(fork.id);
  });

  // --- Subscriptions ---

  it("ledger subscribers fire on change", async () => {
    const store = await getStore();
    const callback = vi.fn();
    const unsub = store.subscribe(callback);

    store.createObligation("Test", "Reason");
    expect(callback).toHaveBeenCalled();

    unsub();
    callback.mockClear();
    store.createObligation("Test 2", "Reason");
    expect(callback).not.toHaveBeenCalled();
  });

  it("app subscribers fire on ledger management", async () => {
    const store = await getStore();
    const callback = vi.fn();
    const unsub = store.subscribeToApp(callback);

    store.createLedger("New Project");
    expect(callback).toHaveBeenCalled();

    unsub();
  });

  // --- Conversations ---

  it("creates a conversation", async () => {
    const store = await getStore();
    const conv = store.createConversation("Discussion");
    expect(conv.name).toBe("Discussion");
    expect(store.getCurrentConversation()?.id).toBe(conv.id);
  });

  it("switches conversations", async () => {
    const store = await getStore();
    const first = store.getCurrentConversation()!;
    const second = store.createConversation("Second");

    store.selectConversation(first.id);
    expect(store.getCurrentConversation()?.id).toBe(first.id);

    store.selectConversation(second.id);
    expect(store.getCurrentConversation()?.id).toBe(second.id);
  });

  // --- Reset ---

  it("resetCurrentLedger clears state", async () => {
    const store = await getStore();
    store.createFork("Fork", "Why", [{ title: "A", why: "A" }]);
    store.addMessage("user", "Hello");

    store.resetCurrentLedger();
    expect(store.getState().entries).toHaveLength(0);
    expect(store.getState().decisions).toHaveLength(0);
    // Should still have a default conversation
    expect(store.getState().conversations.length).toBeGreaterThanOrEqual(1);
  });

  // --- Import/Export ---

  it("imports as new ledger", async () => {
    const store = await getStore();
    const before = store.getLedgers().length;

    const imported = store.importAsNewLedger(
      {
        name: "Imported",
        persona: "thinking-partner",
        createdAt: 1000,
        updatedAt: 2000,
      },
      {
        entries: [],
        decisions: [],
        conversations: [
          {
            id: "imp-conv-1",
            createdAt: 1000,
            updatedAt: 2000,
            messages: [],
            currentChatPath: [],
            type: "live",
          },
        ],
        currentConversationId: "imp-conv-1",
      }
    );

    expect(store.getLedgers().length).toBe(before + 1);
    expect(imported.name).toBe("Imported");
    expect(store.getCurrentLedger()?.id).toBe(imported.id);
  });

  it("deduplicates import names", async () => {
    const store = await getStore();

    const first = store.importAsNewLedger(
      { name: "Project", createdAt: 0, updatedAt: 0 },
      { entries: [], decisions: [] }
    );

    const second = store.importAsNewLedger(
      { name: "Project", createdAt: 0, updatedAt: 0 },
      { entries: [], decisions: [] }
    );

    expect(first.name).toBe("Project");
    expect(second.name).toBe("Project (2)");
  });
});
