import type { ToolRequest } from '../../types'

export type ApprovalKey = 'allow' | 'allow-always' | 'deny' | 'deny-with-message'

export interface ApprovalOption {
  key: ApprovalKey
  label: string
  description?: string
}

/**
 * 승인 카드에 노출할 옵션 목록을 빌드한다. "한 번 허용"은 항상, "항상
 * 허용"은 백엔드가 영구 규칙으로 승격 가능한 permission_suggestion을
 * 보냈을 때만 노출. "거부" / "거부 + 의견 전달"은 항상.
 */
export function buildOptions(request: ToolRequest): ApprovalOption[] {
  const opts: ApprovalOption[] = [
    { key: 'allow', label: '예 (한 번 허용)', description: '이번 호출만 진행한다.' },
  ]
  const suggestion = request.permission_suggestions?.find(
    (s) => s.type === 'addRules' || s.type === 'allow' || s.type === 'session',
  )
  if (suggestion) {
    opts.push({
      key: 'allow-always',
      label:
        suggestion.label ||
        `예 + 다시 묻지 않음 (${request.tool_name})`,
      description:
        suggestion.reason ||
        suggestion.ruleContent ||
        '이 도구에 대해 항상 허용한다.',
    })
  }
  opts.push({
    key: 'deny',
    label: '거부',
    description: 'Claude에게 이 작업을 취소하라고 알린다.',
  })
  // CLI의 "No, and tell Claude what to do differently"와 동일 — 사용자가
  // 이유를 적으면 Claude가 그 텍스트를 거부 사유로 받는다.
  opts.push({
    key: 'deny-with-message',
    label: '거부 + 의견 전달',
    description: 'Claude에게 다르게 해야 할 점을 설명한다.',
  })
  return opts
}
