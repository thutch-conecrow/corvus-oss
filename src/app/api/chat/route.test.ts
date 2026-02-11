import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted to create mock before vi.mock hoists
const { mockCreate } = vi.hoisted(() => ({
  mockCreate: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => {
  return {
    default: class MockAnthropic {
      messages = { create: mockCreate };
    },
  };
});

// Import after mocking
import { POST } from "./route";

function makeRequest(body: Record<string, unknown>): Request {
  return new Request("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function makeBody(overrides?: Record<string, unknown>) {
  return {
    message: "Hello",
    messageHistory: [],
    apiKey: "test-api-key",
    ...overrides,
  };
}

describe("POST /api/chat", () => {
  beforeEach(() => {
    mockCreate.mockReset();
  });

  it("returns parsed JSON for valid response", async () => {
    const responseData = {
      forks: [
        {
          title: "Which DB?",
          why: "Need persistence",
          paths: [
            { title: "Postgres", why: "Reliable" },
            { title: "SQLite", why: "Simple" },
          ],
        },
      ],
      assistant_message: "Here are your options.",
    };

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(responseData) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();

    expect(data.forks).toHaveLength(1);
    expect(data.assistant_message).toBe("Here are your options.");
  });

  it("returns 401 when no API key is provided", async () => {
    const response = await POST(
      makeRequest({
        message: "Hello",
        messageHistory: [],
        // No apiKey, and no env var
      })
    );

    expect(response.status).toBe(401);
    const data = await response.json();
    expect(data.error).toContain("No API key");
  });

  it("handles max_tokens truncation with fallback", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: '{"assistant_message": "partial"}' }],
      stop_reason: "max_tokens",
      usage: { input_tokens: 100, output_tokens: 2048 },
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();

    // Should return a fallback message, not the truncated response
    expect(data.assistant_message).toContain("break it down");
  });

  it("salvages prose when JSON parse fails", async () => {
    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "I think you should consider a few things here." }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 30 },
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();

    // extractFallbackMessage returns the prose directly since it doesn't start with JSON chars
    expect(data.assistant_message).toBe("I think you should consider a few things here.");
  });

  it("handles no text content in response", async () => {
    mockCreate.mockResolvedValue({
      content: [],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 0 },
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();
    expect(data.assistant_message).toBe(
      "I had trouble formulating a response. Could you rephrase that?"
    );
  });

  it("salvages partial response on validation error", async () => {
    // Valid fork + invalid obligation (missing required fields)
    const partialData = {
      forks: [{ title: "Valid Fork", why: "Good", paths: [{ title: "A", why: "B" }] }],
      assistant_message: "Here's what I got",
      obligations: [{ bad_field: true }],
    };

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: JSON.stringify(partialData) }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();

    // Salvage path keeps valid fork and assistant_message, drops invalid obligation
    expect(data.assistant_message).toBe("Here's what I got");
    expect(data.forks).toHaveLength(1);
    expect(data.forks[0].title).toBe("Valid Fork");
  });

  it("handles rate limit 429", async () => {
    mockCreate.mockRejectedValue({
      status: 429,
      message: "Rate limited",
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();
    expect(data.assistant_message).toContain("too many requests");
  });

  it("handles overload 529", async () => {
    mockCreate.mockRejectedValue({
      status: 529,
      message: "API overloaded",
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();
    expect(data.assistant_message).toContain("overloaded");
  });

  it("handles unknown errors", async () => {
    mockCreate.mockRejectedValue(new Error("Network failure"));

    const response = await POST(makeRequest(makeBody()));
    // Non-recoverable errors return 500
    expect(response.status).toBe(500);
  });

  it("handles JSON wrapped in markdown code blocks", async () => {
    const responseData = {
      assistant_message: "Got it!",
    };

    mockCreate.mockResolvedValue({
      content: [{ type: "text", text: "```json\n" + JSON.stringify(responseData) + "\n```" }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    });

    const response = await POST(makeRequest(makeBody()));
    const data = await response.json();
    expect(data.assistant_message).toBe("Got it!");
  });

  it("selects synthesizer prompt for synthesizer persona", async () => {
    const validResponse = {
      content: [{ type: "text", text: '{"assistant_message": "ok"}' }],
      stop_reason: "end_turn",
      usage: { input_tokens: 100, output_tokens: 50 },
    };
    mockCreate.mockResolvedValue(validResponse);

    await POST(makeRequest(makeBody({ persona: "synthesizer" })));
    const synthesizerPrompt = mockCreate.mock.calls[0][0].system[0].text;

    mockCreate.mockResolvedValue(validResponse);
    await POST(makeRequest(makeBody()));
    const defaultPrompt = mockCreate.mock.calls[1][0].system[0].text;

    // Synthesizer gets its own prompt, not the default thinking-partner prompt
    expect(synthesizerPrompt).toContain("You are Corvus in Synthesizer mode");
    expect(defaultPrompt).toContain("You are Corvus, a thoughtful planning partner");
    expect(synthesizerPrompt).not.toBe(defaultPrompt);
  });
});
