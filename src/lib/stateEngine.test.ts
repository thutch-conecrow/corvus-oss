import { describe, it, expect, vi } from "vitest";
import type { LLMResponse, Fork, Obligation, Entry } from "@/types";
import { computeStateChanges, applyChangeToEntries, collectDecisions } from "./stateEngine";
import type { ProcessingContext, StateChange } from "./stateEngine";

// Mock nanoid for deterministic IDs
vi.mock("nanoid", () => {
  let counter = 0;
  return {
    nanoid: () => `test-id-${++counter}`,
  };
});

function makeContext(overrides?: Partial<ProcessingContext>): ProcessingContext {
  return {
    existingEntries: [],
    userMessageId: "user-msg-1",
    conversationId: "conv-1",
    timestamp: 1000,
    ...overrides,
  };
}

describe("computeStateChanges", () => {
  // --- Fork creation ---
  it("creates a fork from response", () => {
    const response: LLMResponse = {
      forks: [
        {
          title: "Which framework?",
          why: "Need to choose",
          paths: [
            { title: "React", why: "Popular" },
            { title: "Vue", why: "Simple" },
          ],
        },
      ],
      assistant_message: "Here's a decision.",
    };

    const result = computeStateChanges(response, makeContext());
    expect(result.changes).toHaveLength(2); // fork_created + message_linked
    expect(result.changes[0].type).toBe("fork_created");

    const change = result.changes[0] as Extract<StateChange, { type: "fork_created" }>;
    expect(change.fork.title).toBe("Which framework?");
    expect(change.fork.paths).toHaveLength(2);
    expect(change.fork.paths[0].title).toBe("React");
    expect(change.fork.phase).toBe("soon"); // default
    expect(result.createdEntryIds).toHaveLength(1);
    expect(result.assistantMessage).toBe("Here's a decision.");
  });

  it("deduplicates forks by normalized title", () => {
    const existingFork: Fork = {
      id: "existing-fork",
      type: "fork",
      title: "Which framework?",
      why: "Need to choose",
      phase: "soon",
      paths: [],
      recordedAt: 500,
      decidedAt: 500,
    };

    const response: LLMResponse = {
      forks: [
        {
          title: "Which Framework?", // Different case
          why: "Duplicate",
          paths: [{ title: "React", why: "Popular" }],
        },
      ],
    };

    const result = computeStateChanges(response, makeContext({ existingEntries: [existingFork] }));
    // Should skip the duplicate fork, no changes
    expect(result.changes).toHaveLength(0);
    expect(result.createdEntryIds).toHaveLength(0);
  });

  // --- Obligation creation ---
  it("creates an obligation from response", () => {
    const response: LLMResponse = {
      obligations: [{ title: "Set up CI", why: "Needed for deployment", phase: "now" }],
    };

    const result = computeStateChanges(response, makeContext());
    expect(result.changes).toHaveLength(2); // obligation_created + message_linked
    expect(result.changes[0].type).toBe("obligation_created");

    const change = result.changes[0] as Extract<StateChange, { type: "obligation_created" }>;
    expect(change.obligation.title).toBe("Set up CI");
    expect(change.obligation.state).toBe("todo");
    expect(change.obligation.phase).toBe("now");
  });

  it("deduplicates obligations by normalized title", () => {
    const existingObligation: Obligation = {
      id: "existing-ob",
      type: "obligation",
      title: "Set up CI!",
      why: "Needed",
      phase: "now",
      state: "todo",
      recordedAt: 500,
      decidedAt: 500,
    };

    const response: LLMResponse = {
      obligations: [{ title: "Set up CI", why: "Duplicate" }],
    };

    const result = computeStateChanges(
      response,
      makeContext({ existingEntries: [existingObligation] })
    );
    expect(result.changes).toHaveLength(0);
  });

  // --- Selections ---
  it("processes path selections", () => {
    const fork: Fork = {
      id: "fork-1",
      type: "fork",
      title: "Which DB?",
      why: "Need persistence",
      phase: "soon",
      paths: [
        {
          id: "path-a",
          type: "path",
          title: "Postgres",
          why: "Reliable",
          phase: "soon",
          state: "open",
          forkId: "fork-1",
          recordedAt: 500,
          decidedAt: 500,
        },
        {
          id: "path-b",
          type: "path",
          title: "SQLite",
          why: "Simple",
          phase: "soon",
          state: "open",
          forkId: "fork-1",
          recordedAt: 500,
          decidedAt: 500,
        },
      ],
      recordedAt: 500,
      decidedAt: 500,
    };

    const response: LLMResponse = {
      selections: [
        { forkTitle: "Which DB?", chosenPathTitle: "Postgres", rationale: "Better for scale" },
      ],
    };

    const result = computeStateChanges(response, makeContext({ existingEntries: [fork] }));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].type).toBe("path_chosen");

    const change = result.changes[0] as Extract<StateChange, { type: "path_chosen" }>;
    expect(change.forkId).toBe("fork-1");
    expect(change.pathId).toBe("path-a");
    expect(change.decision.rationale).toBe("Better for scale");
  });

  it("skips selection for non-existent fork", () => {
    const response: LLMResponse = {
      selections: [{ forkTitle: "Nonexistent", chosenPathTitle: "X", rationale: "Y" }],
    };

    const result = computeStateChanges(response, makeContext());
    expect(result.changes).toHaveLength(0);
  });

  // --- Dismissals ---
  it("processes path dismissals", () => {
    const fork: Fork = {
      id: "fork-1",
      type: "fork",
      title: "Which DB?",
      why: "Need persistence",
      phase: "soon",
      paths: [
        {
          id: "path-a",
          type: "path",
          title: "Postgres",
          why: "Reliable",
          phase: "soon",
          state: "open",
          forkId: "fork-1",
          recordedAt: 500,
          decidedAt: 500,
        },
      ],
      recordedAt: 500,
      decidedAt: 500,
    };

    const response: LLMResponse = {
      dismissals: [{ forkTitle: "Which DB?", pathTitle: "Postgres" }],
    };

    const result = computeStateChanges(response, makeContext({ existingEntries: [fork] }));
    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].type).toBe("path_dismissed");
  });

  // --- Resolved forks (reconstruction) ---
  it("creates resolved forks", () => {
    const response: LLMResponse = {
      forks_resolved: [
        {
          title: "Framework choice",
          why: "Needed to decide",
          paths: [
            { title: "React", why: "Popular" },
            { title: "Vue", why: "Simple" },
          ],
          chosenPathTitle: "React",
          rationale: "Team knows it",
        },
      ],
    };

    const result = computeStateChanges(response, makeContext());
    expect(result.changes).toHaveLength(2); // fork_created_resolved + message_linked
    expect(result.changes[0].type).toBe("fork_created_resolved");

    const change = result.changes[0] as Extract<StateChange, { type: "fork_created_resolved" }>;
    expect(change.fork.phase).toBe("past");
    expect(change.fork.paths[0].state).toBe("chosen");
    expect(change.fork.paths[1].state).toBe("dismissed");
    expect(change.decision.rationale).toBe("Team knows it");
  });

  // --- Resolved obligations (reconstruction) ---
  it("creates resolved obligations", () => {
    const response: LLMResponse = {
      obligations_resolved: [
        {
          title: "Set up CI",
          why: "Automation",
          state: "done",
          notes: "Using GitHub Actions",
        },
      ],
    };

    const result = computeStateChanges(response, makeContext());
    expect(result.changes).toHaveLength(2); // obligation_created_resolved + message_linked
    expect(result.changes[0].type).toBe("obligation_created_resolved");

    const change = result.changes[0] as Extract<
      StateChange,
      { type: "obligation_created_resolved" }
    >;
    expect(change.obligation.phase).toBe("past");
    expect(change.obligation.state).toBe("done");
    expect(change.decision.newState).toBe("done");
  });

  // --- Message linking ---
  it("emits message_linked when entries are created", () => {
    const response: LLMResponse = {
      obligations: [{ title: "Task A", why: "Reason" }],
    };

    const result = computeStateChanges(response, makeContext());
    const linkChange = result.changes.find((c) => c.type === "message_linked");
    expect(linkChange).toBeDefined();

    const change = linkChange as Extract<StateChange, { type: "message_linked" }>;
    expect(change.messageId).toBe("user-msg-1");
    expect(change.entryIds).toHaveLength(1);
  });

  // --- Warning passthrough ---
  it("passes through warnings", () => {
    const response: LLMResponse = {
      assistant_message: "Trimmed response",
      _warning: "Too many items",
    };

    const result = computeStateChanges(response, makeContext());
    expect(result.hasWarning).toBe(true);
    expect(result.warningMessage).toBe("Too many items");
    expect(result.assistantMessage).toContain("\u26a0\ufe0f");
  });

  it("has no warning when _warning is absent", () => {
    const response: LLMResponse = { assistant_message: "Normal" };
    const result = computeStateChanges(response, makeContext());
    expect(result.hasWarning).toBe(false);
  });
});

describe("applyChangeToEntries", () => {
  it("adds a fork", () => {
    const fork: Fork = {
      id: "f1",
      type: "fork",
      title: "Test",
      why: "Why",
      phase: "soon",
      paths: [],
      recordedAt: 0,
      decidedAt: 0,
    };

    const result = applyChangeToEntries([], { type: "fork_created", fork });
    expect(result).toHaveLength(1);
    expect(result[0]).toBe(fork);
  });

  it("adds a resolved fork", () => {
    const fork: Fork = {
      id: "f1",
      type: "fork",
      title: "Test",
      why: "Why",
      phase: "past",
      paths: [],
      recordedAt: 0,
      decidedAt: 0,
    };
    const decision = {
      id: "d1",
      kind: "path" as const,
      pathId: "p1",
      forkId: "f1",
      forkTitle: "Test",
      pathTitle: "Chosen",
      rationale: "reason",
      recordedAt: 0,
      decidedAt: 0,
      conversationId: "c1",
    };

    const result = applyChangeToEntries([], {
      type: "fork_created_resolved",
      fork,
      decision,
    });
    expect(result).toHaveLength(1);
  });

  it("marks chosen path and dismisses others on path_chosen", () => {
    const fork: Fork = {
      id: "f1",
      type: "fork",
      title: "Test",
      why: "Why",
      phase: "soon",
      paths: [
        {
          id: "p1",
          type: "path",
          title: "A",
          why: "A",
          phase: "soon",
          state: "open",
          forkId: "f1",
          recordedAt: 0,
          decidedAt: 0,
        },
        {
          id: "p2",
          type: "path",
          title: "B",
          why: "B",
          phase: "soon",
          state: "open",
          forkId: "f1",
          recordedAt: 0,
          decidedAt: 0,
        },
      ],
      recordedAt: 0,
      decidedAt: 0,
    };

    const decision = {
      id: "d1",
      kind: "path" as const,
      pathId: "p1",
      forkId: "f1",
      forkTitle: "Test",
      pathTitle: "A",
      rationale: "reason",
      recordedAt: 0,
      decidedAt: 0,
      conversationId: "c1",
    };

    const result = applyChangeToEntries([fork], {
      type: "path_chosen",
      forkId: "f1",
      pathId: "p1",
      decision,
    });
    const updatedFork = result[0] as Fork;
    expect(updatedFork.paths[0].state).toBe("chosen");
    expect(updatedFork.paths[1].state).toBe("dismissed");
  });

  it("dismisses a single path on path_dismissed", () => {
    const fork: Fork = {
      id: "f1",
      type: "fork",
      title: "Test",
      why: "Why",
      phase: "soon",
      paths: [
        {
          id: "p1",
          type: "path",
          title: "A",
          why: "A",
          phase: "soon",
          state: "open",
          forkId: "f1",
          recordedAt: 0,
          decidedAt: 0,
        },
        {
          id: "p2",
          type: "path",
          title: "B",
          why: "B",
          phase: "soon",
          state: "open",
          forkId: "f1",
          recordedAt: 0,
          decidedAt: 0,
        },
      ],
      recordedAt: 0,
      decidedAt: 0,
    };

    const result = applyChangeToEntries([fork], {
      type: "path_dismissed",
      forkId: "f1",
      pathId: "p1",
    });
    const updatedFork = result[0] as Fork;
    expect(updatedFork.paths[0].state).toBe("dismissed");
    expect(updatedFork.paths[1].state).toBe("open"); // unchanged
  });

  it("returns entries unchanged for unknown change type", () => {
    const entries: Entry[] = [];
    const result = applyChangeToEntries(entries, {
      type: "message_linked",
      messageId: "m1",
      entryIds: ["e1"],
    });
    expect(result).toEqual([]);
  });
});

describe("collectDecisions", () => {
  it("collects decisions from path_chosen changes", () => {
    const decision = {
      id: "d1",
      kind: "path" as const,
      pathId: "p1",
      forkId: "f1",
      forkTitle: "Test",
      pathTitle: "A",
      rationale: "reason",
      recordedAt: 0,
      decidedAt: 0,
      conversationId: "c1",
    };

    const changes: StateChange[] = [{ type: "path_chosen", forkId: "f1", pathId: "p1", decision }];

    const decisions = collectDecisions(changes);
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toBe(decision);
  });

  it("collects decisions from resolved changes", () => {
    const pathDecision = {
      id: "d1",
      kind: "path" as const,
      pathId: "p1",
      forkId: "f1",
      forkTitle: "Test",
      pathTitle: "A",
      rationale: "reason",
      recordedAt: 0,
      decidedAt: 0,
      conversationId: "c1",
    };

    const obligationDecision = {
      id: "d2",
      kind: "obligation" as const,
      obligationId: "o1",
      obligationTitle: "Task",
      previousState: "todo" as const,
      newState: "done" as const,
      recordedAt: 0,
      decidedAt: 0,
      conversationId: "c1",
    };

    const changes: StateChange[] = [
      {
        type: "fork_created_resolved",
        fork: {
          id: "f1",
          type: "fork",
          title: "Test",
          why: "Why",
          phase: "past",
          paths: [],
          recordedAt: 0,
          decidedAt: 0,
        },
        decision: pathDecision,
      },
      {
        type: "obligation_created_resolved",
        obligation: {
          id: "o1",
          type: "obligation",
          title: "Task",
          why: "Why",
          phase: "past",
          state: "done",
          recordedAt: 0,
          decidedAt: 0,
        },
        decision: obligationDecision,
      },
    ];

    const decisions = collectDecisions(changes);
    expect(decisions).toHaveLength(2);
  });

  it("ignores creation-only changes", () => {
    const changes: StateChange[] = [
      {
        type: "fork_created",
        fork: {
          id: "f1",
          type: "fork",
          title: "Test",
          why: "Why",
          phase: "soon",
          paths: [],
          recordedAt: 0,
          decidedAt: 0,
        },
      },
      {
        type: "obligation_created",
        obligation: {
          id: "o1",
          type: "obligation",
          title: "Task",
          why: "Why",
          phase: "soon",
          state: "todo",
          recordedAt: 0,
          decidedAt: 0,
        },
      },
    ];

    const decisions = collectDecisions(changes);
    expect(decisions).toHaveLength(0);
  });
});
