import { describe, it, expect } from "vitest";
import type { DecisionRecord, Fork, Obligation, Path } from "./index";
import { isFork, isObligation, isPath, isPathDecision, isObligationDecision } from "./index";

const baseFork: Fork = {
  id: "f1",
  type: "fork",
  title: "Test Fork",
  why: "Why",
  phase: "soon",
  paths: [],
  recordedAt: 0,
  decidedAt: 0,
};

const baseObligation: Obligation = {
  id: "o1",
  type: "obligation",
  title: "Test Obligation",
  why: "Why",
  phase: "soon",
  state: "todo",
  recordedAt: 0,
  decidedAt: 0,
};

const basePath: Path = {
  id: "p1",
  type: "path",
  title: "Test Path",
  why: "Why",
  phase: "soon",
  state: "open",
  forkId: "f1",
  recordedAt: 0,
  decidedAt: 0,
};

describe("Entry type guards", () => {
  it("isFork returns true for forks", () => {
    expect(isFork(baseFork)).toBe(true);
    expect(isFork(baseObligation)).toBe(false);
    expect(isFork(basePath)).toBe(false);
  });

  it("isObligation returns true for obligations", () => {
    expect(isObligation(baseObligation)).toBe(true);
    expect(isObligation(baseFork)).toBe(false);
    expect(isObligation(basePath)).toBe(false);
  });

  it("isPath returns true for paths", () => {
    expect(isPath(basePath)).toBe(true);
    expect(isPath(baseFork)).toBe(false);
    expect(isPath(baseObligation)).toBe(false);
  });
});

describe("Decision type guards", () => {
  const pathDecision: DecisionRecord = {
    id: "d1",
    kind: "path",
    pathId: "p1",
    forkId: "f1",
    forkTitle: "Test",
    pathTitle: "Path A",
    rationale: "reason",
    recordedAt: 0,
    decidedAt: 0,
    conversationId: "c1",
  };

  const obligationDecision: DecisionRecord = {
    id: "d2",
    kind: "obligation",
    obligationId: "o1",
    obligationTitle: "Task",
    previousState: "todo",
    newState: "done",
    recordedAt: 0,
    decidedAt: 0,
    conversationId: "c1",
  };

  it("isPathDecision returns true for path decisions", () => {
    expect(isPathDecision(pathDecision)).toBe(true);
    expect(isPathDecision(obligationDecision)).toBe(false);
  });

  it("isObligationDecision returns true for obligation decisions", () => {
    expect(isObligationDecision(obligationDecision)).toBe(true);
    expect(isObligationDecision(pathDecision)).toBe(false);
  });
});
