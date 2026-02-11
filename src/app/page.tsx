"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { AnimatePresence } from "framer-motion";
import { Timeline } from "@/components/Timeline";
import { ChatSidebar } from "@/components/ChatSidebar";
import { DecisionLog } from "@/components/DecisionLog";
import { ExportModal } from "@/components/ExportModal";
import { ImportModal } from "@/components/ImportModal";
import type { LedgerExport } from "@/components/ExportModal";
import { LedgerPicker } from "@/components/LedgerPicker";
import { SettingsModal, getSettings, hasApiKey } from "@/components/SettingsModal";
import type { CorvusSettings } from "@/components/SettingsModal";
import { ConversationPicker } from "@/components/ConversationPicker";
import { TimeTravelBar, ClockIcon } from "@/components/TimeTravelBar";
import { reconstructStateAtTime, getEventTimestamps, findEventIndexAtTime } from "@/lib/timeTravel";
import { parseFuzzyDateOrNow } from "@/lib/dateParser";
import {
  getState,
  getAppState,
  subscribe,
  subscribeToApp,
  addMessage,
  removeMessage,
  createFork,
  createObligation,
  createResolvedFork,
  createResolvedObligation,
  choosePath,
  dismissPath,
  reopenPath,
  changeObligationState,
  updateObligationNotes,
  findForkByTitle,
  findPathByTitle,
  linkMessageToEntries,
  getCurrentChatMessages,
  createLedger,
  selectLedger,
  renameLedger,
  deleteLedger,
  changeLedgerPersona,
  getCurrentLedger,
  importAsNewLedger,
  replaceCurrentLedgerData,
  createConversation,
  selectConversation,
  renameConversation,
  deleteConversation,
  getCurrentConversation,
  getConversations,
  createBranch,
  createBranchFromMessage,
  getEffectiveEntries,
  getEffectiveDecisions,
  withConversationContext,
  getBranchChangeCount,
  isBranchMerged,
  mergeBranch,
  getEventCount,
  getEventIdsSince,
  recordLlmInteraction,
  updateDecisionDecidedAt,
  loadSampleLedger,
  isCurrentLedgerSample,
  isLedgerQuarantined,
} from "@/store/ledger";
import type {
  LedgerState,
  AppState,
  LLMResponse,
  DecisionRecord,
  ObligationState,
  Persona,
  Entry,
  Fork,
} from "@/types";
import { isFork, isPathDecision, isObligationDecision, isObligation } from "@/types";

/*
 * DEMO SCRIPT
 * -----------
 * Recommended interaction path to demonstrate Corvus Ledger:
 *
 * 1. Start with: "I want to build something small I can sell. Probably a mobile app. I'm solo."
 *    - Watch timeline populate with inferred obligations and speculative framework options
 *    - Huginn should ask about iOS/Android targets
 *
 * 2. Clarify: "Both stores eventually, but I'd like to start with Android first."
 *    - Android obligations become prominent (Now phase)
 *    - iOS obligations move to Later phase
 *    - Framework options remain speculative
 *
 * 3. Commit: "React Native with Expo."
 *    - Framework decision locks in Muninn
 *    - Other framework options collapse/fade away
 *    - Expo-specific obligations appear
 *
 * 4. Add context: "I already created an LLC because I want this to be a real business."
 *    - LLC-related obligations appear (bookkeeping, compliance, public address)
 *    - Legal category expands
 *
 * Throughout: Notice how confidence levels change, animations are smooth, and the
 * timeline visually reflects certainty vs speculation.
 */

type LayoutMode = "stacked" | "columns";

export default function Home() {
  const [mounted, setMounted] = useState(false);
  const [state, setState] = useState<LedgerState>(getState);
  const [appState, setAppState] = useState<AppState>(getAppState);
  const [isLoading, setIsLoading] = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [settings, setSettings] = useState<CorvusSettings>({ apiKey: "", model: "" });
  const [layout, setLayout] = useState<LayoutMode>("stacked");
  const [wideChat, setWideChat] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);

  // Time travel state
  const [isTimeTraveling, setIsTimeTraveling] = useState(false);
  const [timeTravelTimestamp, setTimeTravelTimestamp] = useState<number>(Date.now());

  // Compute reconstructed state when time traveling
  const reconstructedState = useMemo(() => {
    if (!isTimeTraveling) return null;
    return reconstructStateAtTime(state.events, timeTravelTimestamp);
  }, [isTimeTraveling, timeTravelTimestamp, state.events]);

  // Get event timestamps for navigation
  const _eventTimestamps = useMemo(() => {
    return getEventTimestamps(state.events);
  }, [state.events]);

  // Time travel handlers
  const handleEnterTimeTravel = useCallback(() => {
    // Start at the most recent event, or now if no events
    const latestTimestamp =
      state.events.length > 0 ? state.events[state.events.length - 1].recordedAt : Date.now();
    setTimeTravelTimestamp(latestTimestamp);
    setIsTimeTraveling(true);
  }, [state.events]);

  const handleExitTimeTravel = useCallback(() => {
    setIsTimeTraveling(false);
  }, []);

  const handleTimeTravelPrev = useCallback(() => {
    const currentIndex = findEventIndexAtTime(state.events, timeTravelTimestamp);
    if (currentIndex > 0) {
      setTimeTravelTimestamp(state.events[currentIndex - 1].recordedAt);
    }
  }, [state.events, timeTravelTimestamp]);

  const handleTimeTravelNext = useCallback(() => {
    const currentIndex = findEventIndexAtTime(state.events, timeTravelTimestamp);
    if (currentIndex < state.events.length - 1) {
      setTimeTravelTimestamp(state.events[currentIndex + 1].recordedAt);
    }
  }, [state.events, timeTravelTimestamp]);

  // Load settings and show settings modal if no API key configured
  useEffect(() => {
    const current = getSettings();
    setSettings(current);
    // Auto-open settings if no API key is set (demo mode)
    if (!current.apiKey) {
      setShowSettings(true);
    }
  }, []);

  const handleSettingsSave = useCallback((newSettings: CorvusSettings) => {
    setSettings(newSettings);
  }, []);

  // Mark as mounted after hydration to avoid SSR mismatch
  useEffect(() => {
    setMounted(true);
  }, []);

  // Subscribe to store changes
  useEffect(() => {
    const unsubLedger = subscribe(setState);
    const unsubApp = subscribeToApp(setAppState);
    return () => {
      unsubLedger();
      unsubApp();
    };
  }, []);

  // Ledger management handlers
  const handleCreateLedger = useCallback((name: string, persona: Persona) => {
    createLedger(name, persona);
  }, []);

  const handleSelectLedger = useCallback((ledgerId: string) => {
    selectLedger(ledgerId);
  }, []);

  const handleRenameLedger = useCallback((ledgerId: string, newName: string) => {
    renameLedger(ledgerId, newName);
  }, []);

  const handleDeleteLedger = useCallback((ledgerId: string) => {
    deleteLedger(ledgerId);
  }, []);

  const handleChangePersona = useCallback((persona: Persona) => {
    const currentLedger = getCurrentLedger();
    if (currentLedger) {
      changeLedgerPersona(currentLedger.id, persona);
    }
  }, []);

  // Conversation management handlers
  const handleCreateConversation = useCallback((name?: string) => {
    createConversation(name);
  }, []);

  const handleSelectConversation = useCallback((conversationId: string) => {
    selectConversation(conversationId);
  }, []);

  const handleRenameConversation = useCallback((conversationId: string, newName: string) => {
    renameConversation(conversationId, newName);
  }, []);

  const handleDeleteConversation = useCallback((conversationId: string) => {
    deleteConversation(conversationId);
  }, []);

  const handleCreateBranch = useCallback((name?: string) => {
    createBranch(name);
  }, []);

  const handleMergeBranch = useCallback(() => {
    mergeBranch();
  }, []);

  const handleBranchFromMessage = useCallback((messageId: string) => {
    const branch = createBranchFromMessage(messageId);
    if (!branch) return;

    // Switch to Thinking Partner for exploration
    const ledger = getCurrentLedger();
    if (ledger && ledger.persona !== "thinking-partner") {
      changeLedgerPersona(ledger.id, "thinking-partner");
    }
  }, []);

  // Entry interaction handlers
  // Note: These need to be defined after handleSendMessage, so we use a ref pattern
  const sendMessageRef = useRef<(content: string) => Promise<void>>();

  const handleAskAbout = useCallback((entry: Entry) => {
    // Add a focused message to the current conversation about this entry
    const entryType = isFork(entry) ? "fork" : "obligation";
    const prompt = `I'd like to discuss the ${entryType} "${entry.title}". ${entry.why}`;
    sendMessageRef.current?.(prompt);
  }, []);

  const handleNewDiscussion = useCallback((entry: Entry) => {
    // Create a new conversation focused on this entry
    const entryType = isFork(entry) ? "fork" : "obligation";
    createConversation(`Discussion: ${entry.title}`);

    // Switch to Thinking Partner persona for exploration
    const ledger = getCurrentLedger();
    if (ledger && ledger.persona !== "thinking-partner") {
      changeLedgerPersona(ledger.id, "thinking-partner");
    }

    // Add initial context message after a tick to ensure conversation is created
    setTimeout(() => {
      const prompt = `Let's discuss the ${entryType} "${entry.title}". ${entry.why}`;
      sendMessageRef.current?.(prompt);
    }, 0);
  }, []);

  const handleWhatIf = useCallback((fork: Fork) => {
    // Create an isolated branch to explore alternatives
    const chosenPath = fork.paths.find((p) => p.state === "chosen");
    const dismissedPaths = fork.paths.filter((p) => p.state === "dismissed" || p.state === "open");
    const alternatives = dismissedPaths.map((p) => p.title).join(", ");

    createBranch(`What if: ${fork.title}`);

    // Switch to Thinking Partner persona for exploration
    const ledger = getCurrentLedger();
    if (ledger && ledger.persona !== "thinking-partner") {
      changeLedgerPersona(ledger.id, "thinking-partner");
    }

    // Add context about exploring alternatives after a tick to ensure branch is created
    setTimeout(() => {
      const prompt = chosenPath
        ? `Let's explore what would have happened if we had chosen differently for "${fork.title}". We chose "${chosenPath.title}", but what if we had gone with ${alternatives || "a different option"}?`
        : `Let's explore the options for "${fork.title}" in this isolated branch.`;
      sendMessageRef.current?.(prompt);
    }, 0);
  }, []);

  // Handle importing a ledger
  const handleImport = useCallback((data: LedgerExport, mode: "replace" | "copy") => {
    if (mode === "copy") {
      importAsNewLedger(data.ledger, data.state);
    } else {
      replaceCurrentLedgerData(data.state);
    }
  }, []);

  // Handle loading the sample ledger
  const handleLoadSample = useCallback(() => {
    loadSampleLedger();
  }, []);

  // Handle choosing a path within a fork
  const handleChoosePath = useCallback((forkId: string, pathId: string) => {
    // For now, use a simple rationale - in the future, could prompt user
    choosePath(forkId, pathId, "User selected this option");
  }, []);

  // Handle dismissing a path
  const handleDismissPath = useCallback((forkId: string, pathId: string) => {
    dismissPath(forkId, pathId);
  }, []);

  // Handle reopening a dismissed path
  const handleReopenPath = useCallback((forkId: string, pathId: string) => {
    reopenPath(forkId, pathId);
  }, []);

  // Handle changing obligation state
  const handleChangeObligationState = useCallback(
    (obligationId: string, newState: ObligationState, notes?: string) => {
      changeObligationState(obligationId, newState, { notes });
    },
    []
  );

  // Handle updating obligation notes
  const handleUpdateObligationNotes = useCallback((obligationId: string, notes: string) => {
    updateObligationNotes(obligationId, notes);
  }, []);

  // Handle editing decision date
  const handleEditDecisionDate = useCallback((decisionId: string, newDate: number) => {
    updateDecisionDecidedAt(decisionId, newDate);
  }, []);

  // Handle clicking a decision in Muninn - scroll to related chat message
  const handleHighlightDecision = useCallback(
    (decision: DecisionRecord) => {
      // Use the decision's linked message if available
      if (decision.linkedMessageId) {
        setHighlightedMessageId(decision.linkedMessageId);
        setTimeout(() => setHighlightedMessageId(null), 3000);
        return;
      }

      // Fallback: look for linked messages on the entry
      if (isPathDecision(decision)) {
        const fork = state.entries.find((e) => e.id === decision.forkId && isFork(e));
        if (!fork || !isFork(fork)) return;

        const path = fork.paths.find((p) => p.id === decision.pathId);
        const linkedMessages = path?.linkedMessageIds ?? fork.linkedMessageIds ?? [];

        if (linkedMessages.length > 0) {
          setHighlightedMessageId(linkedMessages[linkedMessages.length - 1]);
          setTimeout(() => setHighlightedMessageId(null), 3000);
        }
      } else if (isObligationDecision(decision)) {
        const obligation = state.entries.find(
          (e) => e.id === decision.obligationId && isObligation(e)
        );
        const linkedMessages = obligation?.linkedMessageIds ?? [];

        if (linkedMessages.length > 0) {
          setHighlightedMessageId(linkedMessages[linkedMessages.length - 1]);
          setTimeout(() => setHighlightedMessageId(null), 3000);
        }
      }
    },
    [state.entries]
  );

  // Send message to Huginn
  const handleSendMessage = useCallback(
    async (content: string) => {
      // Get parent ID from current chat path (last message if any)
      const currentConv = getCurrentConversation();
      const currentPath = currentConv?.currentChatPath ?? [];
      const parentId = currentPath.length > 0 ? currentPath[currentPath.length - 1] : undefined;

      // Capture conversation ID BEFORE the await - this ensures responses go to the
      // correct conversation even if the user switches conversations during the API call
      const targetConversationId = currentConv?.id;

      const userMessage = addMessage("user", content, parentId);
      setIsLoading(true);

      try {
        // Get current chat thread for context
        const chatHistory = getCurrentChatMessages().map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Get current entries for LLM context (so it doesn't create duplicates)
        // Use getEffectiveEntries() to respect branch context
        const existingEntries = getEffectiveEntries().map((e) => {
          if (isFork(e)) {
            const chosenPath = e.paths.find((p) => p.state === "chosen");
            return {
              type: "fork" as const,
              title: e.title,
              decided: !!chosenPath,
              chosenPath: chosenPath?.title,
              openPaths: e.paths.filter((p) => p.state === "open").map((p) => p.title),
            };
          } else {
            return {
              type: "obligation" as const,
              title: e.title,
            };
          }
        });

        // Get current ledger persona
        const ledger = getCurrentLedger();
        const persona = ledger?.persona ?? "thinking-partner";

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: content,
            messageHistory: chatHistory,
            existingEntries,
            persona,
            apiKey: settings.apiKey || undefined,
            model: settings.model || undefined,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to get response");
        }

        const data: LLMResponse = await response.json();

        // Track events spawned by this LLM interaction
        const eventCountBefore = getEventCount();

        // Capture request context for LLM interaction event
        const llmRequestContext = {
          message: content,
          messageHistory: chatHistory,
          existingEntries,
          persona,
        };

        // Track the assistant message ID (will be set when we create it)
        let assistantMessageId: string | undefined;

        // Apply the response in the context of the conversation that initiated the request.
        // This prevents race conditions if the user switches conversations during the API call.
        withConversationContext(targetConversationId!, () => {
          const createdEntryIds: string[] = [];

          // Create new forks (deduped - may return existing fork)
          if (data.forks) {
            data.forks.forEach((f) => {
              const fork = createFork(f.title, f.why, f.paths, {
                category: f.category,
                phase: f.phase,
                isBinary: f.isBinary,
                linkedMessageId: userMessage.id,
              });
              if (fork) {
                createdEntryIds.push(fork.id);
              }
            });
          }

          // Create new obligations (deduped - may return existing obligation)
          if (data.obligations) {
            data.obligations.forEach((o) => {
              const obligation = createObligation(o.title, o.why, {
                category: o.category,
                phase: o.phase,
                linkedMessageId: userMessage.id,
              });
              if (obligation) {
                createdEntryIds.push(obligation.id);
              }
            });
          }

          // Process path selections (when LLM interprets user's choice)
          if (data.selections) {
            data.selections.forEach((sel) => {
              const fork = findForkByTitle(sel.forkTitle);
              if (fork) {
                const path = findPathByTitle(fork, sel.chosenPathTitle);
                if (path) {
                  choosePath(fork.id, path.id, sel.rationale, {
                    linkedMessageId: userMessage.id,
                  });
                }
              }
            });
          }

          // Process path dismissals
          if (data.dismissals) {
            data.dismissals.forEach((d) => {
              const fork = findForkByTitle(d.forkTitle);
              if (fork) {
                const path = findPathByTitle(fork, d.pathTitle);
                if (path) {
                  dismissPath(fork.id, path.id);
                }
              }
            });
          }

          // Create resolved forks (reconstruction mode)
          if (data.forks_resolved) {
            data.forks_resolved.forEach((f) => {
              const result = createResolvedFork(
                f.title,
                f.why,
                f.paths,
                f.chosenPathTitle,
                f.rationale,
                {
                  category: f.category,
                  linkedMessageId: userMessage.id,
                  decidedAt: parseFuzzyDateOrNow(f.decidedAt),
                }
              );
              if (result) {
                createdEntryIds.push(result.fork.id);
              }
            });
          }

          // Create resolved obligations (reconstruction mode)
          if (data.obligations_resolved) {
            data.obligations_resolved.forEach((o) => {
              const result = createResolvedObligation(o.title, o.why, o.state, {
                category: o.category,
                notes: o.notes,
                linkedMessageId: userMessage.id,
                completedAt: parseFuzzyDateOrNow(o.completedAt),
              });
              if (result) {
                createdEntryIds.push(result.obligation.id);
              }
            });
          }

          // Link user message to created entries
          if (createdEntryIds.length > 0) {
            linkMessageToEntries(userMessage.id, createdEntryIds);
          }

          // Build assistant message
          let assistantContent = data.assistant_message || "";

          // Add warning indicator if response was degraded
          if (data._warning) {
            console.warn("[Chat] Response warning:", data._warning);
            // Prepend a subtle indicator to the message
            assistantContent = `⚠️ ${assistantContent}`;
          }

          if (assistantContent) {
            const assistantMsg = addMessage("assistant", assistantContent, userMessage.id);
            assistantMessageId = assistantMsg.id;
          }
        });

        // Record the LLM interaction for replay/debugging
        const spawnedEventIds = getEventIdsSince(eventCountBefore);
        recordLlmInteraction({
          userMessageId: userMessage.id,
          assistantMessageId,
          request: llmRequestContext,
          response: data,
          spawnedEventIds,
        });
      } catch (error) {
        console.error("Failed to send message:", error);
        // Error handling also needs conversation context
        withConversationContext(targetConversationId!, () => {
          addMessage(
            "assistant",
            "Sorry, I encountered an error. Please try again.",
            userMessage.id,
            {
              isError: true,
            }
          );
        });
      } finally {
        setIsLoading(false);
      }
    },
    [settings]
  );

  // Handle retrying a failed message
  const handleRetryMessage = useCallback(
    async (userMessageId: string) => {
      // Find the user message and its error child
      const currentConv = getCurrentConversation();
      if (!currentConv) return;

      const userMessage = currentConv.messages.find((m) => m.id === userMessageId);
      if (!userMessage || userMessage.role !== "user") return;

      // Find the error message (child of this user message with isError=true)
      const errorMessage = currentConv.messages.find(
        (m) => m.parentId === userMessageId && m.isError
      );
      if (!errorMessage) return;

      const targetConversationId = currentConv.id;
      setIsLoading(true);

      try {
        // Get chat history up to (but not including) the failed user message
        // We need to rebuild the context as it was when the message was first sent
        const allMessages = getCurrentChatMessages();
        const userMsgIndex = allMessages.findIndex((m) => m.id === userMessageId);
        const messagesBeforeRetry = userMsgIndex > 0 ? allMessages.slice(0, userMsgIndex) : [];

        const chatHistory = messagesBeforeRetry.map((m) => ({
          role: m.role,
          content: m.content,
        }));

        // Get current entries for LLM context
        // Use getEffectiveEntries() to respect branch context
        const existingEntries = getEffectiveEntries().map((e) => {
          if (isFork(e)) {
            const chosenPath = e.paths.find((p) => p.state === "chosen");
            return {
              type: "fork" as const,
              title: e.title,
              decided: !!chosenPath,
              chosenPath: chosenPath?.title,
              openPaths: e.paths.filter((p) => p.state === "open").map((p) => p.title),
            };
          } else {
            return {
              type: "obligation" as const,
              title: e.title,
            };
          }
        });

        // Get current ledger persona
        const ledger = getCurrentLedger();
        const persona = ledger?.persona ?? "thinking-partner";

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            message: userMessage.content,
            messageHistory: chatHistory,
            existingEntries,
            persona,
            apiKey: settings.apiKey || undefined,
            model: settings.model || undefined,
          }),
        });

        if (!response.ok) {
          throw new Error("Failed to get response");
        }

        const data: LLMResponse = await response.json();

        // Track events spawned by this LLM interaction
        const eventCountBefore = getEventCount();

        // Capture request context for LLM interaction event
        const llmRequestContext = {
          message: userMessage.content,
          messageHistory: chatHistory,
          existingEntries,
          persona,
        };

        let assistantMessageId: string | undefined;

        // Apply the response - on success, remove the error message first
        withConversationContext(targetConversationId, () => {
          // Remove the error message
          removeMessage(errorMessage.id);

          const createdEntryIds: string[] = [];

          // Create new forks
          if (data.forks) {
            data.forks.forEach((f) => {
              const fork = createFork(f.title, f.why, f.paths, {
                category: f.category,
                phase: f.phase,
                isBinary: f.isBinary,
                linkedMessageId: userMessage.id,
              });
              if (fork) {
                createdEntryIds.push(fork.id);
              }
            });
          }

          // Create new obligations
          if (data.obligations) {
            data.obligations.forEach((o) => {
              const obligation = createObligation(o.title, o.why, {
                category: o.category,
                phase: o.phase,
                linkedMessageId: userMessage.id,
              });
              if (obligation) {
                createdEntryIds.push(obligation.id);
              }
            });
          }

          // Process path selections
          if (data.selections) {
            data.selections.forEach((sel) => {
              const fork = findForkByTitle(sel.forkTitle);
              if (fork) {
                const path = findPathByTitle(fork, sel.chosenPathTitle);
                if (path) {
                  choosePath(fork.id, path.id, sel.rationale, {
                    linkedMessageId: userMessage.id,
                  });
                }
              }
            });
          }

          // Process path dismissals
          if (data.dismissals) {
            data.dismissals.forEach((d) => {
              const fork = findForkByTitle(d.forkTitle);
              if (fork) {
                const path = findPathByTitle(fork, d.pathTitle);
                if (path) {
                  dismissPath(fork.id, path.id);
                }
              }
            });
          }

          // Create resolved forks (reconstruction mode)
          if (data.forks_resolved) {
            data.forks_resolved.forEach((f) => {
              const result = createResolvedFork(
                f.title,
                f.why,
                f.paths,
                f.chosenPathTitle,
                f.rationale,
                {
                  category: f.category,
                  linkedMessageId: userMessage.id,
                  decidedAt: parseFuzzyDateOrNow(f.decidedAt),
                }
              );
              if (result) {
                createdEntryIds.push(result.fork.id);
              }
            });
          }

          // Create resolved obligations (reconstruction mode)
          if (data.obligations_resolved) {
            data.obligations_resolved.forEach((o) => {
              const result = createResolvedObligation(o.title, o.why, o.state, {
                category: o.category,
                notes: o.notes,
                linkedMessageId: userMessage.id,
                completedAt: parseFuzzyDateOrNow(o.completedAt),
              });
              if (result) {
                createdEntryIds.push(result.obligation.id);
              }
            });
          }

          // Link user message to created entries
          if (createdEntryIds.length > 0) {
            linkMessageToEntries(userMessage.id, createdEntryIds);
          }

          // Build assistant message
          let assistantContent = data.assistant_message || "";

          if (data._warning) {
            console.warn("[Chat] Response warning:", data._warning);
            assistantContent = `⚠️ ${assistantContent}`;
          }

          if (assistantContent) {
            const assistantMsg = addMessage("assistant", assistantContent, userMessage.id);
            assistantMessageId = assistantMsg.id;
          }
        });

        // Record the LLM interaction
        const spawnedEventIds = getEventIdsSince(eventCountBefore);
        recordLlmInteraction({
          userMessageId: userMessage.id,
          assistantMessageId,
          request: llmRequestContext,
          response: data,
          spawnedEventIds,
        });
      } catch (error) {
        console.error("Retry failed:", error);
        // Keep the existing error message - don't add another one
      } finally {
        setIsLoading(false);
      }
    },
    [settings]
  );

  // Assign ref so entry interaction handlers can call handleSendMessage
  sendMessageRef.current = handleSendMessage;

  // Show loading skeleton until client-side hydration completes
  if (!mounted) {
    return (
      <main className="h-screen flex bg-corvus-bg items-center justify-center">
        <div className="text-corvus-muted">Loading...</div>
      </main>
    );
  }

  // Check if current ledger is read-only (sample or quarantined)
  const isSample = isCurrentLedgerSample();
  const isQuarantined = isLedgerQuarantined();

  // Get display data - reconstructed when time traveling, current otherwise
  const displayEntries =
    isTimeTraveling && reconstructedState ? reconstructedState.entries : getEffectiveEntries();

  const displayDecisions =
    isTimeTraveling && reconstructedState ? reconstructedState.decisions : getEffectiveDecisions();

  const displayMessages = (() => {
    if (isTimeTraveling && reconstructedState) {
      // Try to get messages from the reconstructed active conversation
      // Fall back to lastActivityConversationId, then to any available conversation
      let activeConv = reconstructedState.conversations.get(
        reconstructedState.activeConversationId
      );
      if (!activeConv && reconstructedState.lastActivityConversationId) {
        activeConv = reconstructedState.conversations.get(
          reconstructedState.lastActivityConversationId
        );
      }
      if (!activeConv && reconstructedState.conversations.size > 0) {
        // Use the first available conversation as last resort
        activeConv = Array.from(reconstructedState.conversations.values())[0];
      }
      if (activeConv) {
        // Return messages in current path order
        return activeConv.currentChatPath
          .map((id) => activeConv!.messages.find((m) => m.id === id))
          .filter((m): m is NonNullable<typeof m> => m !== undefined);
      }
      return [];
    }
    return getCurrentChatMessages();
  })();

  return (
    <main className={`h-screen flex bg-corvus-bg ${isTimeTraveling ? "time-travel-active" : ""}`}>
      {/* Amber overlay for time travel mode */}
      {isTimeTraveling && <div className="fixed inset-0 bg-amber-500/5 pointer-events-none z-30" />}
      {/* Timeline Canvas (main area) */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <header className="p-4 border-b border-corvus-border flex items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div>
              <h1 className="text-xl font-bold text-corvus-text">Corvus Ledger</h1>
            </div>
            {/* Ledger Picker */}
            <LedgerPicker
              ledgers={appState.ledgers}
              currentLedger={getCurrentLedger()}
              onSelect={handleSelectLedger}
              onCreate={handleCreateLedger}
              onRename={handleRenameLedger}
              onDelete={handleDeleteLedger}
            />
          </div>
          <div className="flex items-center gap-2">
            {/* Layout Toggle */}
            <div className="flex items-center bg-corvus-border/30 rounded-md p-0.5">
              <button
                onClick={() => setLayout("stacked")}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  layout === "stacked"
                    ? "bg-corvus-surface text-corvus-text"
                    : "text-corvus-muted hover:text-corvus-text"
                }`}
                title="Stacked layout"
              >
                <StackedIcon />
              </button>
              <button
                onClick={() => setLayout("columns")}
                className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                  layout === "columns"
                    ? "bg-corvus-surface text-corvus-text"
                    : "text-corvus-muted hover:text-corvus-text"
                }`}
                title="Columns layout"
              >
                <ColumnsIcon />
              </button>
            </div>
            {/* Wide Chat Toggle */}
            <button
              onClick={() => setWideChat(!wideChat)}
              className={`px-2 py-1 text-xs font-medium rounded transition-colors ${
                wideChat
                  ? "bg-corvus-accent/20 text-corvus-accent"
                  : "bg-corvus-border/30 text-corvus-muted hover:text-corvus-text"
              }`}
              title={wideChat ? "Narrow chat panel" : "Wide chat panel"}
            >
              <ExpandChatIcon />
            </button>
            <button
              onClick={handleLoadSample}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-corvus-accent/20 text-corvus-accent hover:bg-corvus-accent/30 transition-colors"
            >
              View Sample
            </button>
            <button
              onClick={() => setShowImport(true)}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-corvus-border/50 text-corvus-muted hover:bg-corvus-border hover:text-corvus-text transition-colors"
            >
              Import
            </button>
            <button
              onClick={() => setShowExport(true)}
              className="px-3 py-1.5 text-sm font-medium rounded-md bg-corvus-border/50 text-corvus-muted hover:bg-corvus-border hover:text-corvus-text transition-colors"
            >
              Export
            </button>
            <button
              onClick={() => setShowSettings(true)}
              className={`px-3 py-1.5 text-sm font-medium rounded-md transition-colors ${
                hasApiKey()
                  ? "bg-corvus-border/50 text-corvus-muted hover:bg-corvus-border hover:text-corvus-text"
                  : "bg-amber-500/20 text-amber-400 hover:bg-amber-500/30"
              }`}
            >
              Settings
            </button>
          </div>
        </header>

        {/* Stacked Layout: Timeline above, Decision Log below */}
        {layout === "stacked" && (
          <>
            <Timeline
              entries={displayEntries}
              onChoosePath={
                isTimeTraveling || isSample || isQuarantined ? undefined : handleChoosePath
              }
              onDismissPath={
                isTimeTraveling || isSample || isQuarantined ? undefined : handleDismissPath
              }
              onReopenPath={
                isTimeTraveling || isSample || isQuarantined ? undefined : handleReopenPath
              }
              onChangeObligationState={
                isTimeTraveling || isSample || isQuarantined
                  ? undefined
                  : handleChangeObligationState
              }
              onUpdateObligationNotes={
                isTimeTraveling || isSample || isQuarantined
                  ? undefined
                  : handleUpdateObligationNotes
              }
              onAskAbout={isTimeTraveling || isSample || isQuarantined ? undefined : handleAskAbout}
              onNewDiscussion={
                isTimeTraveling || isSample || isQuarantined ? undefined : handleNewDiscussion
              }
              onWhatIf={isTimeTraveling || isSample || isQuarantined ? undefined : handleWhatIf}
            />
            <DecisionLog
              decisions={displayDecisions}
              maxHeight="40vh"
              onHighlight={isTimeTraveling ? undefined : handleHighlightDecision}
              onEditDate={
                isTimeTraveling || isSample || isQuarantined ? undefined : handleEditDecisionDate
              }
            />
          </>
        )}

        {/* Columns Layout: Timeline only in main area */}
        {layout === "columns" && (
          <Timeline
            entries={displayEntries}
            onChoosePath={
              isTimeTraveling || isSample || isQuarantined ? undefined : handleChoosePath
            }
            onDismissPath={
              isTimeTraveling || isSample || isQuarantined ? undefined : handleDismissPath
            }
            onReopenPath={
              isTimeTraveling || isSample || isQuarantined ? undefined : handleReopenPath
            }
            onChangeObligationState={
              isTimeTraveling || isSample || isQuarantined ? undefined : handleChangeObligationState
            }
            onUpdateObligationNotes={
              isTimeTraveling || isSample || isQuarantined ? undefined : handleUpdateObligationNotes
            }
            onAskAbout={isTimeTraveling || isSample || isQuarantined ? undefined : handleAskAbout}
            onNewDiscussion={
              isTimeTraveling || isSample || isQuarantined ? undefined : handleNewDiscussion
            }
            onWhatIf={isTimeTraveling || isSample || isQuarantined ? undefined : handleWhatIf}
          />
        )}
      </div>

      {/* Columns Layout: Decision Log as middle column */}
      {layout === "columns" && (
        <div className="w-80 border-l border-corvus-border flex flex-col">
          <DecisionLog
            decisions={displayDecisions}
            isColumn
            onHighlight={isTimeTraveling ? undefined : handleHighlightDecision}
            onEditDate={
              isTimeTraveling || isSample || isQuarantined ? undefined : handleEditDecisionDate
            }
          />
        </div>
      )}

      {/* Chat Sidebar (Huginn) with Conversation Picker */}
      <div
        className={`${wideChat ? "w-[600px]" : "w-96"} border-l border-corvus-border flex flex-col h-full transition-all duration-200`}
      >
        {!isTimeTraveling && !isSample && (
          <ConversationPicker
            conversations={getConversations()}
            currentConversation={getCurrentConversation()}
            onSelect={handleSelectConversation}
            onCreate={handleCreateConversation}
            onRename={handleRenameConversation}
            onDelete={handleDeleteConversation}
            onBranch={handleCreateBranch}
          />
        )}
        <ChatSidebar
          messages={displayMessages}
          conversationId={getCurrentConversation()?.id}
          onSendMessage={handleSendMessage}
          onRetryMessage={
            isTimeTraveling || isSample || isQuarantined ? undefined : handleRetryMessage
          }
          isLoading={isLoading}
          highlightedMessageId={highlightedMessageId}
          persona={getCurrentLedger()?.persona}
          onChangePersona={
            isTimeTraveling || isSample || isQuarantined ? undefined : handleChangePersona
          }
          isBranch={getCurrentConversation()?.type === "isolated"}
          branchChangeCount={getBranchChangeCount()}
          isBranchMerged={isBranchMerged()}
          onMergeBranch={
            isTimeTraveling || isSample || isQuarantined ? undefined : handleMergeBranch
          }
          readOnly={isTimeTraveling || isSample || isQuarantined}
          isSampleLedger={isSample}
          onBranchFromMessage={
            isTimeTraveling || isSample || isQuarantined ? undefined : handleBranchFromMessage
          }
        />
      </div>

      {/* Time Travel FAB (bottom-left) */}
      {!isTimeTraveling && state.events.length > 0 && (
        <button
          onClick={handleEnterTimeTravel}
          className="fixed bottom-6 left-6 z-40 p-4 bg-corvus-surface border border-corvus-border rounded-full shadow-lg hover:bg-corvus-border/50 hover:border-corvus-accent/50 transition-all group"
          title="View history"
        >
          <ClockIcon className="w-5 h-5 text-corvus-muted group-hover:text-corvus-accent transition-colors" />
        </button>
      )}

      {/* Time Travel Bar */}
      <AnimatePresence>
        {isTimeTraveling && (
          <TimeTravelBar
            events={state.events}
            currentTimestamp={timeTravelTimestamp}
            onTimestampChange={setTimeTravelTimestamp}
            onExit={handleExitTimeTravel}
            onPrev={handleTimeTravelPrev}
            onNext={handleTimeTravelNext}
          />
        )}
      </AnimatePresence>

      {/* Export Modal */}
      <ExportModal
        isOpen={showExport}
        onClose={() => setShowExport(false)}
        state={state}
        currentLedger={getCurrentLedger()}
      />

      {/* Import Modal */}
      <ImportModal
        isOpen={showImport}
        onClose={() => setShowImport(false)}
        onImport={handleImport}
        currentLedgerName={getCurrentLedger()?.name ?? null}
      />

      {/* Settings Modal */}
      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        onSave={handleSettingsSave}
      />
    </main>
  );
}

// Layout toggle icons
function StackedIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2" y="2" width="12" height="6" rx="1" />
      <rect x="2" y="10" width="12" height="4" rx="1" />
    </svg>
  );
}

function ColumnsIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      <rect x="2" y="2" width="5" height="12" rx="1" />
      <rect x="9" y="2" width="5" height="12" rx="1" />
    </svg>
  );
}

function ExpandChatIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
    >
      {/* Left arrow */}
      <path d="M6 4L2 8L6 12" />
      {/* Chat bubble */}
      <rect x="8" y="3" width="6" height="10" rx="1" />
    </svg>
  );
}
