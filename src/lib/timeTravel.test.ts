import { describe, it, expect } from "vitest";
import type { LedgerEvent } from "@/types";
import {
  applyEvent,
  reconstructStateAtTime,
  getEventTimestamps,
  findEventIndexAtTime,
} from "./timeTravel";
import type { ReconstructedState } from "./timeTravel";

function emptyState(): ReconstructedState {
  return {
    entries: [],
    decisions: [],
    conversations: new Map(),
    activeConversationId: "",
    lastActivityConversationId: "",
  };
}

describe("applyEvent", () => {
  it("handles conversation_created", () => {
    const event: LedgerEvent = {
      id: "e1",
      type: "conversation_created",
      payload: { conversationId: "conv-1", name: "Test", type: "live" },
      recordedAt: 1000,
    };

    const state = applyEvent(emptyState(), event);
    expect(state.conversations.size).toBe(1);
    expect(state.conversations.get("conv-1")?.name).toBe("Test");
    expect(state.activeConversationId).toBe("conv-1");
  });

  it("handles fork_created", () => {
    const event: LedgerEvent = {
      id: "e1",
      type: "fork_created",
      payload: {
        forkId: "f1",
        title: "Which DB?",
        why: "Need persistence",
        phase: "soon",
        pathIds: ["p1", "p2"],
        pathTitles: ["Postgres", "SQLite"],
      },
      recordedAt: 1000,
    };

    const state = applyEvent(emptyState(), event);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].type).toBe("fork");
    expect(state.entries[0].title).toBe("Which DB?");
  });

  it("handles obligation_created", () => {
    const event: LedgerEvent = {
      id: "e1",
      type: "obligation_created",
      payload: {
        obligationId: "o1",
        title: "Set up CI",
        why: "Needed",
        phase: "now",
      },
      recordedAt: 1000,
    };

    const state = applyEvent(emptyState(), event);
    expect(state.entries).toHaveLength(1);
    expect(state.entries[0].type).toBe("obligation");
    expect(state.entries[0].title).toBe("Set up CI");
  });

  it("handles path_chosen", () => {
    // First create a fork
    const forkEvent: LedgerEvent = {
      id: "e1",
      type: "fork_created",
      payload: {
        forkId: "f1",
        title: "Which DB?",
        why: "Need persistence",
        phase: "soon",
        pathIds: ["p1", "p2"],
        pathTitles: ["Postgres", "SQLite"],
      },
      recordedAt: 1000,
    };

    let state = applyEvent(emptyState(), forkEvent);

    const chosenEvent: LedgerEvent = {
      id: "e2",
      type: "path_chosen",
      payload: {
        forkId: "f1",
        pathId: "p1",
        rationale: "Better for scale",
        decisionId: "d1",
        decidedAt: 2000,
      },
      recordedAt: 2000,
    };

    state = applyEvent(state, chosenEvent);

    const fork = state.entries[0] as any;
    expect(fork.paths[0].state).toBe("chosen");
    expect(fork.paths[1].state).toBe("dismissed");
    expect(state.decisions).toHaveLength(1);
  });

  it("handles obligation_state_changed", () => {
    // Create obligation first
    const createEvent: LedgerEvent = {
      id: "e1",
      type: "obligation_created",
      payload: {
        obligationId: "o1",
        title: "Set up CI",
        why: "Needed",
        phase: "soon",
      },
      recordedAt: 1000,
    };

    let state = applyEvent(emptyState(), createEvent);

    const stateChangeEvent: LedgerEvent = {
      id: "e2",
      type: "obligation_state_changed",
      payload: {
        obligationId: "o1",
        previousState: "todo",
        newState: "done",
        decisionId: "d1",
        decidedAt: 2000,
      },
      recordedAt: 2000,
    };

    state = applyEvent(state, stateChangeEvent);

    const obligation = state.entries[0] as any;
    expect(obligation.state).toBe("done");
    expect(obligation.phase).toBe("past");
    expect(state.decisions).toHaveLength(1);
  });

  it("handles obligation_state_changed to parked", () => {
    const createEvent: LedgerEvent = {
      id: "e1",
      type: "obligation_created",
      payload: {
        obligationId: "o1",
        title: "Set up CI",
        why: "Needed",
        phase: "soon",
      },
      recordedAt: 1000,
    };

    let state = applyEvent(emptyState(), createEvent);

    const stateChangeEvent: LedgerEvent = {
      id: "e2",
      type: "obligation_state_changed",
      payload: {
        obligationId: "o1",
        previousState: "todo",
        newState: "parked",
        decisionId: "d1",
        decidedAt: 2000,
      },
      recordedAt: 2000,
    };

    state = applyEvent(state, stateChangeEvent);

    const obligation = state.entries[0] as any;
    expect(obligation.state).toBe("parked");
    expect(obligation.phase).toBe("parking-lot");
  });

  it("handles message_added", () => {
    // Create conversation first
    const convEvent: LedgerEvent = {
      id: "e0",
      type: "conversation_created",
      payload: { conversationId: "conv-1", type: "live" },
      recordedAt: 500,
    };

    let state = applyEvent(emptyState(), convEvent);

    const msgEvent: LedgerEvent = {
      id: "e1",
      type: "message_added",
      payload: {
        messageId: "m1",
        conversationId: "conv-1",
        role: "user",
        content: "Hello",
      },
      recordedAt: 1000,
    };

    state = applyEvent(state, msgEvent);

    const conv = state.conversations.get("conv-1");
    expect(conv?.messages).toHaveLength(1);
    expect(conv?.messages[0].content).toBe("Hello");
    expect(conv?.currentChatPath).toEqual(["m1"]);
  });

  it("returns state unchanged for unknown event type", () => {
    const state = emptyState();
    // Cast the whole object to LedgerEvent to test the default branch
    const event = {
      id: "e1",
      type: "unknown_type",
      payload: {},
      recordedAt: 1000,
    } as unknown as LedgerEvent;

    const result = applyEvent(state, event);
    expect(result).toBe(state);
  });
});

describe("reconstructStateAtTime", () => {
  const events: LedgerEvent[] = [
    {
      id: "e1",
      type: "conversation_created",
      payload: { conversationId: "conv-1", type: "live" },
      recordedAt: 1000,
    },
    {
      id: "e2",
      type: "fork_created",
      payload: {
        forkId: "f1",
        title: "DB Choice",
        why: "Need persistence",
        phase: "soon",
        pathIds: ["p1", "p2"],
        pathTitles: ["Postgres", "SQLite"],
      },
      recordedAt: 2000,
    },
    {
      id: "e3",
      type: "path_chosen",
      payload: {
        forkId: "f1",
        pathId: "p1",
        rationale: "Better for scale",
        decisionId: "d1",
        decidedAt: 3000,
      },
      recordedAt: 3000,
    },
  ];

  it("reconstructs state at intermediate timestamp", () => {
    const state = reconstructStateAtTime(events, 2500);
    expect(state.entries).toHaveLength(1);
    expect(state.decisions).toHaveLength(0); // path not chosen yet
    const fork = state.entries[0] as any;
    expect(fork.paths[0].state).toBe("open");
  });

  it("reconstructs full state after all events", () => {
    const state = reconstructStateAtTime(events, 5000);
    expect(state.entries).toHaveLength(1);
    expect(state.decisions).toHaveLength(1);
    const fork = state.entries[0] as any;
    expect(fork.paths[0].state).toBe("chosen");
  });

  it("returns empty state before any events", () => {
    const state = reconstructStateAtTime(events, 500);
    expect(state.entries).toHaveLength(0);
    expect(state.conversations.size).toBe(0);
  });

  it("handles empty events array", () => {
    const state = reconstructStateAtTime([], 5000);
    expect(state.entries).toHaveLength(0);
  });
});

describe("getEventTimestamps", () => {
  it("returns sorted unique timestamps", () => {
    const events: LedgerEvent[] = [
      {
        id: "e1",
        type: "conversation_created",
        payload: { conversationId: "c1", type: "live" },
        recordedAt: 3000,
      },
      {
        id: "e2",
        type: "conversation_created",
        payload: { conversationId: "c2", type: "live" },
        recordedAt: 1000,
      },
      {
        id: "e3",
        type: "conversation_created",
        payload: { conversationId: "c3", type: "live" },
        recordedAt: 3000, // duplicate
      },
    ];

    const timestamps = getEventTimestamps(events);
    expect(timestamps).toEqual([1000, 3000]);
  });

  it("handles empty events", () => {
    expect(getEventTimestamps([])).toEqual([]);
  });
});

describe("findEventIndexAtTime", () => {
  const events: LedgerEvent[] = [
    {
      id: "e1",
      type: "conversation_created",
      payload: { conversationId: "c1", type: "live" },
      recordedAt: 1000,
    },
    {
      id: "e2",
      type: "conversation_created",
      payload: { conversationId: "c2", type: "live" },
      recordedAt: 2000,
    },
    {
      id: "e3",
      type: "conversation_created",
      payload: { conversationId: "c3", type: "live" },
      recordedAt: 3000,
    },
  ];

  it("returns -1 before any events", () => {
    expect(findEventIndexAtTime(events, 500)).toBe(-1);
  });

  it("returns correct index between events", () => {
    expect(findEventIndexAtTime(events, 1500)).toBe(0);
    expect(findEventIndexAtTime(events, 2500)).toBe(1);
  });

  it("returns index at exact timestamp", () => {
    expect(findEventIndexAtTime(events, 2000)).toBe(1);
  });

  it("returns last index after all events", () => {
    expect(findEventIndexAtTime(events, 5000)).toBe(2);
  });
});
