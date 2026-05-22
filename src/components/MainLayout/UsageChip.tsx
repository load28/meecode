import type { UsageStats } from '../../hooks/useClaudeSession'

const COST_DECIMALS = 4
const DURATION_DECIMALS = 1
const MS_PER_SECOND = 1000

function buildTooltip(u: UsageStats): string {
  const base = `${u.turnCount} turns · ${u.inputTokens}↑ ${u.outputTokens}↓ tokens`
  if (!u.cacheReadTokens && !u.cacheCreationTokens) return base
  return `${base} · cache ${u.cacheReadTokens}↺/${u.cacheCreationTokens}✦`
}

interface Props {
  usage: UsageStats
}

/**
 * 헤더의 누적 사용량 칩 — turnCount가 0이면 자기 자신을 안 그린다.
 * 표시: `$0.0000 · 0.0s`. tooltip은 turns/tokens/cache 합산까지.
 */
export function UsageChip({ usage }: Props) {
  if (usage.turnCount === 0) return null
  return (
    <span className="app__usage" title={buildTooltip(usage)}>
      ${usage.totalCostUsd.toFixed(COST_DECIMALS)} ·{' '}
      {(usage.totalDurationMs / MS_PER_SECOND).toFixed(DURATION_DECIMALS)}s
    </span>
  )
}
