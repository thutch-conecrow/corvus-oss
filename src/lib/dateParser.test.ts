import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseFuzzyDate, parseFuzzyDateOrNow } from "./dateParser";

describe("parseFuzzyDate", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15)); // June 15, 2025
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  // --- Null / empty / undefined ---
  it("returns null for undefined", () => {
    expect(parseFuzzyDate(undefined)).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(parseFuzzyDate("")).toBeNull();
  });

  it("returns null for unparseable string", () => {
    expect(parseFuzzyDate("asdf gibberish")).toBeNull();
  });

  // --- Exact dates ---
  it('parses "June 19, 2025"', () => {
    expect(parseFuzzyDate("June 19, 2025")).toBe(new Date(2025, 5, 19).getTime());
  });

  it('parses "June 19 2025" (no comma)', () => {
    expect(parseFuzzyDate("June 19 2025")).toBe(new Date(2025, 5, 19).getTime());
  });

  it('parses "19 June 2025" (day first)', () => {
    expect(parseFuzzyDate("19 June 2025")).toBe(new Date(2025, 5, 19).getTime());
  });

  it("parses with ordinal suffix (3rd January 2024)", () => {
    expect(parseFuzzyDate("3rd January 2024")).toBe(new Date(2024, 0, 3).getTime());
  });

  it("is case-insensitive for exact dates", () => {
    expect(parseFuzzyDate("JUNE 19, 2025")).toBe(new Date(2025, 5, 19).getTime());
  });

  // --- Month + year ---
  it('parses "June 2024"', () => {
    expect(parseFuzzyDate("June 2024")).toBe(new Date(2024, 5, 15).getTime());
  });

  it('parses abbreviated month "Jun 2024"', () => {
    expect(parseFuzzyDate("Jun 2024")).toBe(new Date(2024, 5, 15).getTime());
  });

  it('parses "Sept 2024" (alternate abbreviation)', () => {
    expect(parseFuzzyDate("Sept 2024")).toBe(new Date(2024, 8, 15).getTime());
  });

  // --- Quarters ---
  it('parses "Q1 2025"', () => {
    expect(parseFuzzyDate("Q1 2025")).toBe(new Date(2025, 1, 15).getTime());
  });

  it('parses "Q2 2024"', () => {
    expect(parseFuzzyDate("Q2 2024")).toBe(new Date(2024, 4, 15).getTime());
  });

  it('parses "Q3 2025"', () => {
    expect(parseFuzzyDate("Q3 2025")).toBe(new Date(2025, 7, 15).getTime());
  });

  it('parses "Q4 2024"', () => {
    expect(parseFuzzyDate("Q4 2024")).toBe(new Date(2024, 10, 15).getTime());
  });

  // --- Relative dates ---
  it('parses "6 months ago"', () => {
    const expected = new Date(2025, 5, 15);
    expected.setMonth(expected.getMonth() - 6);
    expect(parseFuzzyDate("6 months ago")).toBe(expected.getTime());
  });

  it('parses "2 weeks ago"', () => {
    const expected = new Date(2025, 5, 15);
    expected.setDate(expected.getDate() - 14);
    expect(parseFuzzyDate("2 weeks ago")).toBe(expected.getTime());
  });

  it('parses "1 year ago"', () => {
    const expected = new Date(2025, 5, 15);
    expected.setFullYear(expected.getFullYear() - 1);
    expect(parseFuzzyDate("1 year ago")).toBe(expected.getTime());
  });

  it('parses "3 days ago"', () => {
    const expected = new Date(2025, 5, 15);
    expected.setDate(expected.getDate() - 3);
    expect(parseFuzzyDate("3 days ago")).toBe(expected.getTime());
  });

  // --- Seasons ---
  it('parses "summer 2024"', () => {
    expect(parseFuzzyDate("summer 2024")).toBe(new Date(2024, 6, 15).getTime());
  });

  it('parses "fall 2023"', () => {
    expect(parseFuzzyDate("fall 2023")).toBe(new Date(2023, 9, 15).getTime());
  });

  it('parses "spring 2025"', () => {
    expect(parseFuzzyDate("spring 2025")).toBe(new Date(2025, 3, 15).getTime());
  });

  it('parses "winter 2024"', () => {
    expect(parseFuzzyDate("winter 2024")).toBe(new Date(2024, 0, 15).getTime());
  });

  it('parses "last summer" (previous year)', () => {
    expect(parseFuzzyDate("last summer")).toBe(new Date(2024, 6, 15).getTime());
  });

  it('parses "autumn 2024"', () => {
    expect(parseFuzzyDate("autumn 2024")).toBe(new Date(2024, 9, 15).getTime());
  });

  // --- Year only ---
  it('parses "2024"', () => {
    expect(parseFuzzyDate("2024")).toBe(new Date(2024, 5, 15).getTime());
  });

  it('parses "2025"', () => {
    expect(parseFuzzyDate("2025")).toBe(new Date(2025, 5, 15).getTime());
  });

  // --- Early/mid/late modifiers ---
  it('parses "early June 2024"', () => {
    expect(parseFuzzyDate("early June 2024")).toBe(new Date(2024, 5, 5).getTime());
  });

  it('parses "mid June 2024"', () => {
    expect(parseFuzzyDate("mid June 2024")).toBe(new Date(2024, 5, 15).getTime());
  });

  it('parses "late June 2024"', () => {
    expect(parseFuzzyDate("late June 2024")).toBe(new Date(2024, 5, 25).getTime());
  });

  it('parses "early 2024"', () => {
    expect(parseFuzzyDate("early 2024")).toBe(new Date(2024, 1, 15).getTime());
  });

  it('parses "mid 2024"', () => {
    expect(parseFuzzyDate("mid 2024")).toBe(new Date(2024, 5, 15).getTime());
  });

  it('parses "late 2024"', () => {
    expect(parseFuzzyDate("late 2024")).toBe(new Date(2024, 10, 15).getTime());
  });
});

describe("parseFuzzyDateOrNow", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2025, 5, 15));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns parsed date when parseable", () => {
    expect(parseFuzzyDateOrNow("June 2024")).toBe(new Date(2024, 5, 15).getTime());
  });

  it("returns Date.now() when undefined", () => {
    expect(parseFuzzyDateOrNow(undefined)).toBe(Date.now());
  });

  it("returns Date.now() when unparseable", () => {
    expect(parseFuzzyDateOrNow("not a date")).toBe(Date.now());
  });
});
