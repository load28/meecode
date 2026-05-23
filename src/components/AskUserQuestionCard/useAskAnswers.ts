import { useEffect, useRef, useState } from 'react'
import type { AskQuestion } from './index'

/**
 * single-select에서 옵션 하나를 고르면 다음 질문으로 자동 전환되는 시간(ms).
 * 사용자가 잘못 누른 직후 빠르게 다른 선택을 하려는 경우를 위해 한 박자를
 * 둔다. 마지막 질문에서는 자동 submit하지 않는다 — 전체를 보고 명시적으로
 * 답변 전송을 누르도록.
 */
const AUTO_ADVANCE_MS = 220

export interface QuestionAnswer {
  picks: Set<string>
  otherText: string
}

export type AnswersState = Record<string, QuestionAnswer>

function blankAnswers(qs: AskQuestion[]): AnswersState {
  const out: AnswersState = {}
  for (const q of qs) out[q.question] = { picks: new Set(), otherText: '' }
  return out
}

function joinAnswer(a: QuestionAnswer): string {
  const arr = Array.from(a.picks)
  if (arr.includes('Other') && a.otherText.trim()) {
    const rest = arr.filter((x) => x !== 'Other')
    rest.push(a.otherText.trim())
    return rest.join(', ')
  }
  return arr.join(', ')
}

export interface UseAskAnswersResult {
  answers: AnswersState
  active: number
  /** 현재 활성 질문의 응답 슬롯 — picks/otherText를 들고 있다. */
  current: QuestionAnswer
  isLast: boolean
  everyAnswered: boolean
  currentAnswered: boolean
  /** 질문 i로 점프 (네비 탭 클릭). */
  goTo: (index: number) => void
  /** 다음 질문으로 (마지막이면 no-op). */
  goNext: () => void
  /** 옵션 라벨을 토글. single-select에서는 자동 다음 질문 이동을 스케줄. */
  toggle: (label: string) => void
  /** 'Other' 입력값 갱신. */
  setOther: (text: string) => void
  /** picks/otherText를 직렬화한 answers 페이로드. */
  buildPayload: () => Record<string, string>
}

/**
 * AskUserQuestionCard의 응답 누적 상태 + 자동 다음 질문 이동 로직.
 *
 * single-select에서 'Other'가 아닌 옵션을 고르면 AUTO_ADVANCE_MS 뒤
 * goNext가 호출된다. 사용자가 그 사이 다른 액션을 하면 clearAdvance()로
 * 타이머가 취소된다(질문 탭 클릭, 다음/건너뛰기 버튼 등).
 */
export function useAskAnswers(questions: AskQuestion[]): UseAskAnswersResult {
  const [active, setActive] = useState(0)
  const [answers, setAnswers] = useState<AnswersState>(() =>
    blankAnswers(questions),
  )
  const advanceTimer = useRef<number | null>(null)

  const clearAdvance = () => {
    if (advanceTimer.current !== null) {
      window.clearTimeout(advanceTimer.current)
      advanceTimer.current = null
    }
  }
  useEffect(() => clearAdvance, [])

  const isLast = active === questions.length - 1
  const q = questions[active]
  const current: QuestionAnswer =
    answers[q?.question ?? ''] ?? { picks: new Set(), otherText: '' }
  const currentAnswered = current.picks.size > 0
  const everyAnswered = questions.every(
    (qq) => (answers[qq.question]?.picks.size ?? 0) > 0,
  )

  const goTo = (i: number) => {
    clearAdvance()
    setActive(i)
  }
  const goNext = () => {
    if (!isLast) setActive(active + 1)
  }

  const toggle = (label: string) => {
    clearAdvance()
    setAnswers((prev) => {
      const next = { ...prev }
      const slot = { ...next[q.question], picks: new Set(next[q.question].picks) }
      if (q.multiSelect) {
        if (slot.picks.has(label)) slot.picks.delete(label)
        else slot.picks.add(label)
      } else {
        slot.picks = new Set([label])
      }
      next[q.question] = slot
      return next
    })

    // 자동 이동은 'Other' 옵션이 아닐 때만 — 'Other'는 인라인 텍스트
    // 입력을 펼치므로 포커스를 옮기지 않는다. multi-select는 사용자가
    // 끝났는지 신호가 없으니 수동으로.
    if (!isLast && !q.multiSelect && label !== 'Other') {
      advanceTimer.current = window.setTimeout(() => {
        advanceTimer.current = null
        goNext()
      }, AUTO_ADVANCE_MS)
    }
  }

  const setOther = (text: string) => {
    setAnswers((prev) => ({
      ...prev,
      [q.question]: { ...prev[q.question], otherText: text },
    }))
  }

  const buildPayload = (): Record<string, string> => {
    const out: Record<string, string> = {}
    for (const qq of questions) {
      const s = answers[qq.question]
      if (s && s.picks.size > 0) {
        out[qq.question] = joinAnswer(s)
      }
    }
    return out
  }

  return {
    answers,
    active,
    current,
    isLast,
    everyAnswered,
    currentAnswered,
    goTo,
    goNext,
    toggle,
    setOther,
    buildPayload,
  }
}
