import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import type { LLMResponse, Persona } from "@/types";

const DEFAULT_MODEL = "claude-sonnet-4-5-20250929";

// Error types for better categorization
type ErrorType = "api_error" | "json_parse_error" | "validation_error" | "unknown_error";

interface ChatError {
  type: ErrorType;
  message: string;
  details?: string;
  recoverable: boolean;
  fallback_message?: string;
}

// Limits for array sizes - helps detect overly broad prompts
const LIMITS = {
  MAX_FORKS: 5,
  MAX_PATHS_PER_FORK: 6,
  MAX_OBLIGATIONS: 8,
  MAX_SELECTIONS: 5,
};

// Zod schema for LLM response validation (Fork/Path model)
const LLMResponseSchema = z.object({
  forks: z
    .array(
      z.object({
        title: z.string(),
        why: z.string(),
        category: z.string().optional(),
        phase: z.enum(["now", "soon", "parking-lot"]).optional(),
        isBinary: z.boolean().optional(),
        paths: z
          .array(
            z.object({
              title: z.string(),
              why: z.string(),
            })
          )
          .max(LIMITS.MAX_PATHS_PER_FORK),
      })
    )
    .max(LIMITS.MAX_FORKS)
    .optional(),
  obligations: z
    .array(
      z.object({
        title: z.string(),
        why: z.string(),
        category: z.string().optional(),
        phase: z.enum(["now", "soon", "parking-lot"]).optional(),
      })
    )
    .max(LIMITS.MAX_OBLIGATIONS)
    .optional(),
  // Pre-resolved forks (for reconstruction mode - decisions already made)
  forks_resolved: z
    .array(
      z.object({
        title: z.string(),
        why: z.string(),
        category: z.string().optional(),
        paths: z
          .array(
            z.object({
              title: z.string(),
              why: z.string(),
            })
          )
          .max(LIMITS.MAX_PATHS_PER_FORK),
        chosenPathTitle: z.string(),
        rationale: z.string(),
        decidedAt: z.string().optional(), // fuzzy date like "June 2024", "last summer"
      })
    )
    .max(LIMITS.MAX_FORKS)
    .optional(),
  // Pre-resolved obligations (for reconstruction mode - already completed)
  obligations_resolved: z
    .array(
      z.object({
        title: z.string(),
        why: z.string(),
        category: z.string().optional(),
        state: z.enum(["done", "wont-do", "delegated"]),
        notes: z.string().optional(),
        completedAt: z.string().optional(), // fuzzy date
      })
    )
    .max(LIMITS.MAX_OBLIGATIONS)
    .optional(),
  selections: z
    .array(
      z.object({
        forkTitle: z.string(),
        chosenPathTitle: z.string(),
        rationale: z.string(),
      })
    )
    .max(LIMITS.MAX_SELECTIONS)
    .optional(),
  dismissals: z
    .array(
      z.object({
        forkTitle: z.string(),
        pathTitle: z.string(),
      })
    )
    .max(LIMITS.MAX_SELECTIONS)
    .optional(),
  assistant_message: z.string().optional(),
});

// =============================================================================
// PERSONA PROMPTS
// =============================================================================

/**
 * THINKING PARTNER PERSONA
 *
 * Warm, exploratory, lets ambiguity sit. This is the default persona.
 * Creates forks/obligations when recognizing decision points, but doesn't
 * push the user toward structure prematurely.
 */
const THINKING_PARTNER_PROMPT = `You are Corvus, a thoughtful planning partner. Your role is to think alongside the user, helping them explore decisions and surface structure when it emerges naturally.

CRITICAL: You MUST respond ONLY with valid JSON. No prose, no explanation outside JSON. Your entire response must be parseable JSON.

## Your Character

You're a warm, curious thinking partner. You:
- Listen carefully and reflect back what you hear
- Ask genuine questions when curious, not just for data collection
- Let ambiguity sit when the user is still exploring
- Surface structure (forks, obligations) when you genuinely recognize decision points
- Never push the user toward resolution before they're ready
- NEVER offer to "write things up", "create a summary", or "draft something" unsolicited

## Core Concepts

**Fork**: A decision point with multiple possible paths. Only create when you genuinely recognize a choice the user is considering.

**Path**: One possible choice within a fork. Each path has a title and explanation.

**Obligation**: Something that must be done. Only surface when a commitment naturally emerges from conversation.

**Selection**: When the user has made a choice, reference the fork title and chosen path title.

## Output Format (JSON only)

{
  "forks": [{
    "title": "Which framework?",
    "why": "Need to choose mobile development framework",
    "category": "framework",
    "phase": "now|soon|parking-lot",
    "isBinary": false,
    "paths": [
      { "title": "React Native", "why": "Cross-platform, JavaScript expertise" },
      { "title": "Flutter", "why": "Modern, fast development" }
    ]
  }],
  "obligations": [{
    "title": "Set up development environment",
    "why": "Required to start development",
    "category": "development",
    "phase": "now"
  }],
  "forks_resolved": [{
    "title": "string",
    "why": "string",
    "category": "string",
    "paths": [{ "title": "string", "why": "string" }],
    "chosenPathTitle": "string",
    "rationale": "string",
    "decidedAt": "fuzzy date like 'June 2024' or 'last month'"
  }],
  "obligations_resolved": [{
    "title": "string",
    "why": "string",
    "category": "string",
    "state": "done|wont-do|delegated",
    "notes": "optional notes",
    "completedAt": "fuzzy date"
  }],
  "selections": [{
    "forkTitle": "Which framework?",
    "chosenPathTitle": "React Native",
    "rationale": "User stated they want to use React Native"
  }],
  "dismissals": [{
    "forkTitle": "Which framework?",
    "pathTitle": "Flutter"
  }],
  "assistant_message": "Your conversational response"
}

## Guidelines

- Be conversational and warm in assistant_message - you're a thinking partner, not a data extractor
- Ask questions out of genuine curiosity, limited to 1-2 at a time
- **IMPORTANT: Do NOT create forks or obligations that already exist**
- Only create NEW structure when you recognize genuine decision points
- When user says they "decided", "chose", or "went with" something past tense → use forks_resolved
- When user says they "did", "completed", "set up" something → use obligations_resolved
- Only add selections when user EXPLICITLY chooses in present tense
- Let the user lead - don't push toward resolution
- Categories: "platform", "distribution", "framework", "legal", "marketing", "development", "technical", "infrastructure", "business", "operations"
- Phases: "now" (immediate), "soon" (near-term), "parking-lot" (parked for later)`;

/**
 * SYNTHESIZER PERSONA
 *
 * Output-oriented, collaborative refinement. Activated when user wants
 * to export or share. Does NOT create new structure - only packages
 * existing structure for external consumption.
 */
const SYNTHESIZER_PROMPT = `You are Corvus in Synthesizer mode. The user wants to package their thinking for sharing with others. Your role is to help them extract value from what's already been captured.

CRITICAL: You MUST respond ONLY with valid JSON. No prose, no explanation outside JSON. Your entire response must be parseable JSON.

## Your Character

You're a collaborative editor helping the user package their thinking. You:
- Ask about audience and purpose first
- Help them decide what to include and exclude
- Generate structured, opinionated summaries
- Work with what exists - you do NOT create new forks or obligations
- Focus on clarity and communication

## What You Do

1. Clarify the purpose: Who is this for? What do they need to understand?
2. Review what's captured: decisions made, open questions, obligations
3. Generate targeted markdown in assistant_message
4. Iterate based on feedback

## What You DON'T Do

- Create new forks (the Synthesizer packages, not plans)
- Create new obligations
- Push exploration (that's Thinking Partner's job)

## Output Format (JSON only)

{
  "assistant_message": "Your synthesized output or collaborative response (include any clarifying questions here)"
}

Note: In Synthesizer mode, you ONLY use assistant_message. Include any clarifying questions directly in your message.
Other fields (forks, obligations, etc.) should be empty or omitted.

## Example Flows

User: "I need to share this with my leadership team"
→ Ask: "What do they need to understand? The roadmap? Key decisions made? Open questions and blockers?"

User: "The roadmap and what's blocking us"
→ Generate targeted markdown summary in assistant_message

User: "Can you make it more concise?"
→ Revise and regenerate

## Guidelines

- Always start by understanding audience and purpose
- Generate markdown in assistant_message for synthesized content
- Be opinionated about structure - you're the editor
- Keep iterating until the user is satisfied
- Remember: Corvus captures thinking, other tools action it - your job is to grease the wheels for export`;

/**
 * INTERVIEWER PERSONA
 *
 * Excavation mode for documenting past decisions. Used when reconstructing
 * an existing project or venture. Focuses on what has ALREADY been decided,
 * uses forks_resolved and obligations_resolved.
 */
const INTERVIEWER_PROMPT = `You are Corvus in Interviewer mode. Your role is to help the user document decisions they've ALREADY made. You're excavating the past, not planning the future.

CRITICAL: You MUST respond ONLY with valid JSON. No prose, no explanation outside JSON. Your entire response must be parseable JSON.

## Your Character

You're a thoughtful interviewer helping document an existing project. You:
- Ask probing questions about what has already happened
- Help reconstruct the decision history
- Accept fuzzy dates ("last May", "around June 2024", "a few months ago")
- Focus on PAST decisions, not future planning
- Record decisions as already-resolved using forks_resolved and obligations_resolved

## Core Concepts

**forks_resolved**: For decisions that have ALREADY been made. Include the chosen path and rationale.

**obligations_resolved**: For tasks that have ALREADY been completed (or deliberately not done).

**forks/obligations**: Use SPARINGLY - only for genuinely open decisions the user is currently facing. Most things in interview mode should be resolved.

## Output Format (JSON only)

{
  "forks_resolved": [{
    "title": "Which framework to use?",
    "why": "Needed to choose mobile development approach",
    "category": "framework",
    "paths": [
      { "title": "React Native", "why": "Cross-platform, JavaScript" },
      { "title": "Flutter", "why": "Modern, Dart-based" }
    ],
    "chosenPathTitle": "React Native",
    "rationale": "Team already knew JavaScript",
    "decidedAt": "June 2024"
  }],
  "obligations_resolved": [{
    "title": "Set up CI/CD pipeline",
    "why": "Required for deployment automation",
    "category": "infrastructure",
    "state": "done",
    "notes": "Using GitHub Actions",
    "completedAt": "last month"
  }],
  "forks": [{
    "title": "Only for OPEN decisions",
    "why": "Things still being decided NOW",
    "paths": [...]
  }],
  "obligations": [{
    "title": "Only for OPEN tasks",
    "why": "Things that still need to be done"
  }],
  "assistant_message": "Your conversational response"
}

## Interview Techniques

1. **Timeline questions**: "When did you make that decision?" "What led up to that?"
2. **Alternative exploration**: "What other options did you consider?" "Why not X?"
3. **Rationale capture**: "What made you choose that?" "What was the deciding factor?"
4. **Consequence questions**: "How has that worked out?" "Any regrets?"
5. **Gap detection**: "What happened between X and Y?" "Was there anything else?"

## Guidelines

- Most responses should use forks_resolved and obligations_resolved (past tense)
- Use fuzzy dates - exact dates aren't important ("June 2024", "last quarter", "about 6 months ago")
- Ask 1-2 probing questions to dig deeper into the history
- **IMPORTANT: Do NOT create forks or obligations that already exist**
- Categories: "platform", "distribution", "framework", "legal", "marketing", "development", "technical", "infrastructure", "business", "operations"
- Help the user remember and document - you're an interviewer, not a planner
- When the user naturally shifts to discussing open/future decisions, handle them appropriately but gently steer back to documentation`;

// Map personas to their prompts
const PERSONA_PROMPTS: Record<Persona, string> = {
  "thinking-partner": THINKING_PARTNER_PROMPT,
  interviewer: INTERVIEWER_PROMPT,
  synthesizer: SYNTHESIZER_PROMPT,
};

interface ExistingEntry {
  type: "fork" | "obligation";
  title: string;
  decided?: boolean;
  chosenPath?: string;
  openPaths?: string[];
}

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { message, messageHistory, existingEntries, persona, apiKey, model } = body as {
      message: string;
      messageHistory: Array<{ role: "user" | "assistant"; content: string }>;
      existingEntries?: ExistingEntry[];
      persona?: Persona;
      apiKey?: string;
      model?: string;
    };

    // Resolve API key: client-provided (demo mode) or server env var
    const resolvedApiKey = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!resolvedApiKey) {
      return Response.json(
        { error: "No API key configured. Set ANTHROPIC_API_KEY or provide a key in settings." },
        { status: 401 }
      );
    }

    // Resolve model: client-provided > env var > default
    const resolvedModel = model || process.env.ANTHROPIC_MODEL || DEFAULT_MODEL;

    const anthropic = new Anthropic({ apiKey: resolvedApiKey });

    // Select system prompt based on persona (default to thinking-partner)
    const currentPersona: Persona = persona ?? "thinking-partner";
    const systemPrompt = PERSONA_PROMPTS[currentPersona];

    // Build message history for context (25 messages for now, optimize later)
    const historyMessages = messageHistory.slice(-25).map((m) => ({
      role: m.role as "user" | "assistant",
      content: m.content,
    }));

    // Build existing entries context
    let entriesContext = "(none yet)";
    if (existingEntries && existingEntries.length > 0) {
      const forks = existingEntries.filter((e) => e.type === "fork");
      const obligations = existingEntries.filter((e) => e.type === "obligation");

      const forkLines = forks.map((f) => {
        if (f.decided) {
          return `- FORK (DECIDED): "${f.title}" → chose "${f.chosenPath}"`;
        }
        return `- FORK (OPEN): "${f.title}" — paths: ${f.openPaths?.join(", ")}`;
      });

      const obligationLines = obligations.map((o) => `- OBLIGATION: "${o.title}"`);

      entriesContext = [...forkLines, ...obligationLines].join("\n");
    }

    // Token budget - synthesizer may need more for markdown output
    const maxTokens = currentPersona === "synthesizer" ? 4096 : 2048;

    // Build messages with cache control on conversation prefix
    // We cache all but the last user message so repeated exchanges benefit from cache
    const messagesWithCaching = historyMessages.map((msg, idx) => {
      const isLastHistory = idx === historyMessages.length - 1;
      // Cache the last history message as a breakpoint for the conversation prefix
      if (isLastHistory && historyMessages.length > 0) {
        return {
          role: msg.role,
          content: [
            {
              type: "text" as const,
              text: msg.content,
              cache_control: { type: "ephemeral" as const },
            },
          ],
        };
      }
      return msg;
    });

    const response = await anthropic.messages.create({
      model: resolvedModel,
      max_tokens: maxTokens,
      // System prompt with cache control - this is static and benefits most from caching
      system: [
        {
          type: "text",
          text: systemPrompt,
          cache_control: { type: "ephemeral" },
        },
      ],
      messages: [
        ...messagesWithCaching,
        {
          role: "user",
          content: `Existing entries (DO NOT create duplicates):
${entriesContext}

User message: ${message}

Respond with JSON only.`,
        },
      ],
    });

    // Log cache statistics
    const usage = response.usage as unknown as {
      input_tokens: number;
      output_tokens: number;
      cache_creation_input_tokens?: number;
      cache_read_input_tokens?: number;
    };
    const cacheCreated = usage.cache_creation_input_tokens;
    const cacheRead = usage.cache_read_input_tokens;
    console.log("[Chat API] Token usage:", {
      input_tokens: usage.input_tokens,
      output_tokens: usage.output_tokens,
      cache_creation_input_tokens: cacheCreated ?? 0,
      cache_read_input_tokens: cacheRead ?? 0,
      cache_hit: (cacheRead ?? 0) > 0,
      stop_reason: response.stop_reason,
    });

    // Check if response was truncated due to token limit
    if (response.stop_reason === "max_tokens") {
      console.warn("[Chat API] Response truncated due to max_tokens limit");
      return createErrorResponse({
        type: "api_error",
        message: "Response was too long and got cut off",
        recoverable: true,
        fallback_message:
          "That's a lot to unpack! Could you break it down into smaller pieces? Try focusing on just one decision or topic at a time.",
      });
    }

    // Extract text content
    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      console.error("[Chat API] No text response from model");
      return createErrorResponse({
        type: "api_error",
        message: "No text response from model",
        recoverable: true,
        fallback_message: "I had trouble formulating a response. Could you rephrase that?",
      });
    }

    const rawText = textContent.text.trim();

    // Parse JSON
    let parsed: unknown;
    try {
      let jsonStr = rawText;
      // Try to extract JSON if wrapped in markdown code blocks
      if (jsonStr.startsWith("```")) {
        jsonStr = jsonStr.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "");
      }
      parsed = JSON.parse(jsonStr);
    } catch {
      console.error("[Chat API] Failed to parse JSON:", rawText.substring(0, 500));

      // Try to salvage: if the response looks like prose, use it as the message
      const fallbackMessage = extractFallbackMessage(rawText);

      return createErrorResponse({
        type: "json_parse_error",
        message: "Invalid JSON response from model",
        details: rawText.substring(0, 200),
        recoverable: true,
        fallback_message:
          fallbackMessage || "I got a bit confused there. Let me try again - what were you saying?",
      });
    }

    // Validate with zod (using safeParse for graceful handling)
    const result = LLMResponseSchema.safeParse(parsed);

    if (!result.success) {
      console.error("[Chat API] Validation error:", JSON.stringify(result.error.issues, null, 2));
      console.error(
        "[Chat API] Raw parsed data:",
        JSON.stringify(parsed, null, 2).substring(0, 1000)
      );

      // Check if the error is due to exceeding limits (indicates overly broad prompt)
      const limitExceeded = detectLimitExceeded(result.error.issues, parsed);
      if (limitExceeded) {
        console.warn("[Chat API] Limit exceeded:", limitExceeded);

        // Try to salvage with truncation
        const salvaged = salvagePartialResponse(parsed, true);
        if (salvaged) {
          // Add a warning to the message
          salvaged.assistant_message =
            limitExceeded.suggestion +
            (salvaged.assistant_message ? `\n\n${salvaged.assistant_message}` : "");
          salvaged._warning = limitExceeded.warning;
          console.log("[Chat API] Salvaged with truncation, warning:", limitExceeded.warning);
          return Response.json(salvaged);
        }

        return createErrorResponse({
          type: "validation_error",
          message: limitExceeded.warning,
          recoverable: true,
          fallback_message: limitExceeded.suggestion,
        });
      }

      // Try to salvage what we can from the parsed data
      const salvaged = salvagePartialResponse(parsed);
      if (salvaged) {
        console.log("[Chat API] Salvaged partial response");
        return Response.json(salvaged);
      }

      return createErrorResponse({
        type: "validation_error",
        message: "Response structure was unexpected",
        details: result.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; "),
        recoverable: true,
        fallback_message:
          "I had some trouble organizing my thoughts. Could you try asking that differently?",
      });
    }

    return Response.json(result.data);
  } catch (error) {
    console.error("[Chat API] Unexpected error:", error);

    // Check for specific Anthropic API errors
    const isAnthropicError = error && typeof error === "object" && "status" in error;
    if (isAnthropicError) {
      const apiError = error as { status: number; message: string };
      console.error("[Chat API] Anthropic API error:", {
        status: apiError.status,
        message: apiError.message,
      });

      if (apiError.status === 429) {
        return createErrorResponse({
          type: "api_error",
          message: "Rate limited",
          recoverable: true,
          fallback_message:
            "I'm getting too many requests right now. Please wait a moment and try again.",
        });
      }

      if (apiError.status === 529) {
        return createErrorResponse({
          type: "api_error",
          message: "API overloaded",
          recoverable: true,
          fallback_message:
            "The service is temporarily overloaded. Please try again in a few seconds.",
        });
      }
    }

    return createErrorResponse({
      type: "unknown_error",
      message: error instanceof Error ? error.message : "Unknown error",
      recoverable: false,
      fallback_message: "Something unexpected happened. Please try again.",
    });
  }
}

// Helper to create error responses with fallback assistant message
function createErrorResponse(error: ChatError): Response {
  // Return a valid LLMResponse with just the fallback message
  // This allows the UI to show something helpful instead of an error
  const fallbackResponse: LLMResponse = {
    assistant_message: error.fallback_message,
  };

  // Log the full error for debugging
  console.error(`[Chat API] ${error.type}:`, {
    message: error.message,
    details: error.details,
    recoverable: error.recoverable,
  });

  // For recoverable errors, return a 200 with the fallback message
  // This prevents the UI from showing a hard error
  if (error.recoverable) {
    return Response.json(fallbackResponse);
  }

  // For non-recoverable errors, return 500 with error info
  return Response.json({ error: error.message, details: error.details }, { status: 500 });
}

// Try to extract a usable message from a non-JSON response
function extractFallbackMessage(rawText: string): string | null {
  // If it looks like prose (no JSON-like characters at the start), use it
  if (!rawText.startsWith("{") && !rawText.startsWith("[")) {
    // Clean up common LLM artifacts
    const cleaned = rawText.replace(/^(Sure|Okay|Alright|Let me)[,!.]?\s*/i, "").trim();

    if (cleaned.length > 0 && cleaned.length < 1000) {
      return cleaned;
    }
  }
  return null;
}

// Detect if validation failed due to exceeding limits
function detectLimitExceeded(
  issues: z.ZodIssue[],
  parsed: unknown
): { warning: string; suggestion: string } | null {
  if (!parsed || typeof parsed !== "object") return null;
  const data = parsed as Record<string, unknown>;

  // Check for "too_big" errors which indicate array size limits exceeded
  const sizeIssues = issues.filter((i) => i.code === "too_big");
  if (sizeIssues.length === 0) {
    // Also check raw data for arrays that exceed limits
    const exceedsLimits: string[] = [];
    if (Array.isArray(data.forks) && data.forks.length > LIMITS.MAX_FORKS) {
      exceedsLimits.push(`${data.forks.length} decision points`);
    }
    if (Array.isArray(data.obligations) && data.obligations.length > LIMITS.MAX_OBLIGATIONS) {
      exceedsLimits.push(`${data.obligations.length} obligations`);
    }

    // Check paths within forks
    if (Array.isArray(data.forks)) {
      for (const fork of data.forks) {
        if (
          fork &&
          typeof fork === "object" &&
          Array.isArray((fork as Record<string, unknown>).paths)
        ) {
          const paths = (fork as Record<string, unknown>).paths as unknown[];
          if (paths.length > LIMITS.MAX_PATHS_PER_FORK) {
            exceedsLimits.push(`a decision with ${paths.length} options`);
            break;
          }
        }
      }
    }

    if (exceedsLimits.length === 0) return null;

    return {
      warning: `Response contained too much: ${exceedsLimits.join(", ")}`,
      suggestion:
        "That covers a lot of ground! Let's break it down - could you focus on just one specific aspect or decision at a time?",
    };
  }

  // Analyze the size issues to give specific feedback
  const affectedFields = sizeIssues.map((i) => i.path[0]).filter(Boolean);
  const uniqueFields = Array.from(new Set(affectedFields));

  const fieldDescriptions: Record<string, string> = {
    forks: "decision points",
    obligations: "action items",
    paths: "options for a decision",
  };

  const readable = uniqueFields.map((f) => fieldDescriptions[String(f)] || String(f)).join(", ");

  return {
    warning: `Too many ${readable} in response`,
    suggestion: `That's quite broad! I found too many ${readable} to process at once. Could you focus on one specific area or decision? For example, pick the most important topic and let's start there.`,
  };
}

// Try to salvage a partial response when validation fails
function salvagePartialResponse(parsed: unknown, truncate = false): LLMResponse | null {
  if (!parsed || typeof parsed !== "object") return null;

  const data = parsed as Record<string, unknown>;
  const salvaged: LLMResponse = {};

  // Try to salvage the assistant message at minimum
  if (typeof data.assistant_message === "string") {
    salvaged.assistant_message = data.assistant_message;
  }

  // Field limits for truncation
  const fieldLimits: Record<string, number> = {
    forks: LIMITS.MAX_FORKS,
    obligations: LIMITS.MAX_OBLIGATIONS,
  };

  // Try to salvage arrays that look valid
  const arrayFields = ["forks", "obligations"] as const;

  for (const field of arrayFields) {
    if (Array.isArray(data[field]) && data[field].length > 0) {
      // Use partial validation - keep items that pass
      let items = data[field] as unknown[];

      // Truncate if requested
      if (truncate && fieldLimits[field]) {
        items = items.slice(0, fieldLimits[field]);
      }

      const validItems = items.filter((item) => {
        // Basic sanity check - must be an object with expected fields
        if (!item || typeof item !== "object") return false;
        const obj = item as Record<string, unknown>;

        // Field-specific checks
        if (field === "forks") {
          // Also truncate paths within forks if needed
          if (truncate && Array.isArray(obj.paths)) {
            obj.paths = (obj.paths as unknown[]).slice(0, LIMITS.MAX_PATHS_PER_FORK);
          }
          return typeof obj.title === "string";
        }
        if (field === "obligations") {
          return typeof obj.title === "string";
        }
        return false;
      });

      if (validItems.length > 0) {
        (salvaged as Record<string, unknown>)[field] = validItems;
      }
    }
  }

  // Only return if we salvaged something useful
  if (Object.keys(salvaged).length > 0) {
    // Add a note that this was salvaged (but don't override if already set)
    if (!salvaged.assistant_message) {
      salvaged.assistant_message = truncate
        ? "I had to trim down my response - there was a lot to cover!"
        : "I processed your message but had some trouble with the details. Here's what I could understand.";
    }
    return salvaged;
  }

  return null;
}
