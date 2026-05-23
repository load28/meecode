import { useEffect, useState } from 'react'

/**
 * Pared-down gerund list lifted from the VS Code Claude extension's
 * `spinnerVerbsConfig` (sampled, not exhaustive — the original ships ~90).
 * Picking a smaller set keeps the rotation feeling intentional rather than
 * random while still avoiding the static "Thinking" label.
 */
export const SPINNER_VERBS = [
  'Thinking',
  'Reasoning',
  'Pondering',
  'Mulling',
  'Considering',
  'Crunching',
  'Ruminating',
  'Cogitating',
  'Brewing',
  'Concocting',
  'Cooking',
  'Crafting',
  'Forging',
  'Synthesizing',
  'Noodling',
  'Spelunking',
  'Wrangling',
  'Working',
] as const

const STATIC_OVERRIDES: Record<string, string> = {
  // Map known phase strings to non-rotating labels.
  compacting: 'Compacting',
  initializing: 'Loading',
}

/** 기본 회전 주기 — 사람이 읽고 다음으로 자연스럽게 넘어갈 만큼의 시간. */
const DEFAULT_ROTATION_MS = 2500

export interface SpinnerVerbOptions {
  /** Override label that suppresses rotation. e.g. tool name, "Compacting". */
  override?: string | null
  /** Rotation interval in milliseconds. Default ~2.5s. */
  intervalMs?: number
}

export function useSpinnerVerb({
  override,
  intervalMs = DEFAULT_ROTATION_MS,
}: SpinnerVerbOptions = {}): string {
  const forced = override ? STATIC_OVERRIDES[override] ?? override : null
  const [index, setIndex] = useState(() => Math.floor(Math.random() * SPINNER_VERBS.length))
  useEffect(() => {
    if (forced) return
    const t = setInterval(() => {
      setIndex((i) => (i + 1 + Math.floor(Math.random() * (SPINNER_VERBS.length - 1))) % SPINNER_VERBS.length)
    }, intervalMs)
    return () => clearInterval(t)
  }, [forced, intervalMs])
  return forced ?? SPINNER_VERBS[index]
}
