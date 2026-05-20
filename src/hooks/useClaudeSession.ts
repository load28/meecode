/* eslint-disable react-hooks/exhaustive-deps */
import { useCallback, useEffect, useRef, useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import type { Mode, QaPair, SlashCommand, ToolRequest } from '../types'
import {
  getTabSnapshot,
  setTab,
  subscribeTab,
  type AgentInfo,
  type McpServerInfo,
  type QueuedMessage,
  type TaskActivity,
  type UsageStats,
} from '../state/sessionStore'
import { dispatchClientSlash, modeToClaude } from './clientSlash'

export type { AgentInfo, McpServerInfo, TaskActivity, UsageStats }

export interface UseClaudeSessionResult {
  pairs: QaPair[]
  sessionTitle: string | null
  pendingTool: ToolRequest | null
  mode: Mode
  hookActivity: string | null
  taskActivity: TaskActivity | null
  rateLimit: string | null
  turnError: string | null
  turnInProgress: boolean
  slashCommands: SlashCommand[]
  model: string | null
  usage: UsageStats
  sessionId: string | null
  cwd: string | null
  mcpServers: McpServerInfo[]
  agents: AgentInfo[]
  tools: string[]
  queue: QueuedMessage[]
  sendUserMessage: (
    text: string,
    images?: Array<{ media_type: string; data: string }>,
  ) => Promise<void>
  respondTool: (
    requestId: string,
    allow: boolean,
    toolUseId: string | null,
    updatedInput?: unknown,
  ) => Promise<void>
  cycleMode: () => void
  dismissRateLimit: () => void
  interrupt: () => Promise<void>
  setModel: (model: string | null) => Promise<void>
  setThinkingLevel: (level: string) => Promise<void>
  clearConversation: () => void
  removeQueued: (id: string) => void
}

const MODE_CYCLE: Mode[] = ['default', 'plan', 'auto-accept']

export function useClaudeSession(
  tabId: string = 'main',
): UseClaudeSessionResult {
  const state = useSyncExternalStore(
    useCallback((cb: () => void) => subscribeTab(tabId, cb), [tabId]),
    useCallback(() => getTabSnapshot(tabId), [tabId]),
  )

  const flushOne = useCallback(
    async (
      text: string,
      images?: Array<{ media_type: string; data: string }>,
    ) => {
      const localId = `local-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 6)}`
      const imageSegments =
        images?.map((img) => ({
          kind: 'image' as const,
          media_type: img.media_type,
          data_url: `data:${img.media_type};base64,${img.data}`,
        })) ?? []
      setTab(tabId, (s) => ({
        ...s,
        pairs: [
          ...s.pairs,
          {
            id: localId,
            user_text: text || '',
            segments: imageSegments,
            timestamp: new Date().toISOString(),
          },
        ],
        currentId: localId,
        turnInProgress: true,
        turnError: null,
      }))
      // Tauri 2 maps individual command args camelCase -> snake_case by
      // default, so the frontend must send camelCase keys. The backend
      // parameter `tab_id` receives the value sent as `tabId`.
      await invoke('send_user_message', { text, images, tabId })
    },
    [tabId],
  )

  const sendUserMessage = useCallback(
    async (
      text: string,
      images?: Array<{ media_type: string; data: string }>,
    ) => {
      if (await dispatchClientSlash(text, images, { tabId })) return
      // CLI parity (REPL.onQueryImpl → queryGuard.tryStart() === null →
      // enqueue): when any query is already active, queue the message
      // instead of sending. The processor effect below drains it as soon
      // as the agent goes idle. `turnInProgress` is the queryGuard
      // analogue; `pendingTool` covers the tool-approval window where the
      // turn is technically active but the CLI is parked on user input.
      const snapshot = getTabSnapshot(tabId)
      if (snapshot.turnInProgress || snapshot.pendingTool) {
        setTab(tabId, (s) => ({
          ...s,
          queue: [
            ...s.queue,
            {
              id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              text,
              images,
            },
          ],
        }))
        return
      }
      await flushOne(text, images)
    },
    [tabId, flushOne],
  )

  const respondTool = useCallback(
    async (
      requestId: string,
      allow: boolean,
      toolUseId: string | null,
      updatedInput?: unknown,
    ) => {
      // The `args` wrapper is a single struct argument: Tauri passes the
      // struct to serde, whose default is snake_case field matching, so
      // inner keys stay snake_case. Only the *outer* command params
      // (here `args`) follow Tauri's camelCase convention.
      await invoke('send_tool_response', {
        args: {
          request_id: requestId,
          allow,
          tool_use_id: toolUseId,
          updated_input: updatedInput ?? null,
          tab_id: tabId,
        },
      })
      // Clear pendingTool — the queue-processor effect picks up the next
      // queued message automatically once turnInProgress is also false.
      setTab(tabId, (s) => ({ ...s, pendingTool: null }))
    },
    [tabId],
  )

  const cycleMode = useCallback(() => {
    const next =
      MODE_CYCLE[
        (MODE_CYCLE.indexOf(getTabSnapshot(tabId).mode) + 1) % MODE_CYCLE.length
      ]
    setTab(tabId, (s) => ({ ...s, mode: next }))
    invoke('set_permission_mode', {
      mode: modeToClaude(next),
      tabId,
    }).catch((e) =>
      console.warn('[meecode] set_permission_mode failed', e),
    )
  }, [tabId])

  const dismissRateLimit = useCallback(() => {
    setTab(tabId, (s) => ({ ...s, rateLimit: null }))
  }, [tabId])

  // Mirrors the CLI's CancelRequestHandler.handleCancel — Priority 1:
  // cancel the running task. The CLI's `setToolUseConfirmQueue(() => [])`
  // inside handleCancel maps to clearing `pendingTool` here. After cancel,
  // the queue-processor effect drains any pending queued messages — same
  // shape as the CLI where useQueueProcessor watches queryGuard idle. The
  // queue is intentionally left intact: user-removable via the queue UI.
  const interrupt = useCallback(async () => {
    const snap = getTabSnapshot(tabId)
    if (!snap.turnInProgress) return
    await invoke('interrupt_session', { tabId })
    setTab(tabId, (s) => ({
      ...s,
      turnInProgress: false,
      pendingTool: null,
      hookActivity: null,
      taskActivity: null,
    }))
  }, [tabId])

  const setModel = useCallback(
    async (model: string | null) => {
      await invoke('set_model', { model, tabId })
      setTab(tabId, (s) => ({ ...s, model: model ?? s.model }))
    },
    [tabId],
  )

  const setThinkingLevel = useCallback(
    async (level: string) => {
      await invoke('set_thinking_level', { level, tabId })
    },
    [tabId],
  )

  const clearConversation = useCallback(() => {
    setTab(tabId, (s) => ({ ...s, pairs: [], currentId: null }))
  }, [tabId])

  const removeQueued = useCallback(
    (id: string) => {
      setTab(tabId, (s) => ({
        ...s,
        queue: s.queue.filter((q) => q.id !== id),
      }))
    },
    [tabId],
  )

  // CLI parity (useQueueProcessor in src/hooks/useQueueProcessor.ts):
  // when the agent transitions to idle AND no tool approval is pending,
  // dequeue the head of the queue and flush it. The CLI's processor uses
  // an external store + useSyncExternalStore; we already get a re-render
  // whenever `state` changes, so a plain effect over the relevant fields
  // is equivalent. `isFlushingRef` debounces against a render storm
  // where flushOne triggers a setTab(turnInProgress=true) on the same
  // tick before the queue removal commits.
  const isFlushingRef = useRef(false)
  useEffect(() => {
    if (isFlushingRef.current) return
    if (state.turnInProgress || state.pendingTool) return
    if (state.queue.length === 0) return
    const next = state.queue[0]
    isFlushingRef.current = true
    setTab(tabId, (s) => ({ ...s, queue: s.queue.slice(1) }))
    flushOne(next.text, next.images)
      .catch((e) => console.error('[meecode] queued flush failed', e))
      .finally(() => {
        isFlushingRef.current = false
      })
  }, [state.turnInProgress, state.pendingTool, state.queue, tabId, flushOne])

  const sessionTitle =
    state.pairs.find((p) => p.user_text && !p.user_text.startsWith('──'))
      ?.user_text ?? null

  return {
    pairs: state.pairs,
    sessionTitle,
    pendingTool: state.pendingTool,
    mode: state.mode,
    hookActivity: state.hookActivity,
    taskActivity: state.taskActivity,
    rateLimit: state.rateLimit,
    turnError: state.turnError,
    turnInProgress: state.turnInProgress,
    slashCommands: state.slashCommands,
    model: state.model,
    usage: state.usage,
    sessionId: state.sessionId,
    cwd: state.cwd,
    mcpServers: state.mcpServers,
    agents: state.agents,
    tools: state.tools,
    queue: state.queue,
    sendUserMessage,
    respondTool,
    cycleMode,
    dismissRateLimit,
    interrupt,
    setModel,
    setThinkingLevel,
    clearConversation,
    removeQueued,
  }
}
