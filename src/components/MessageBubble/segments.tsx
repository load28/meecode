import type { AssistantSegment } from '../../types'
import { useSmoothedText } from '../../hooks/useSmoothedText'
import { MarkdownContent } from './MarkdownContent'

const TOOL_RESULT_PREVIEW_CHARS = 400

/**
 * 스트리밍 중 캐릭터 단위로 부드럽게 노출되는 텍스트 세그먼트.
 *
 * useSmoothedText는 text 세그먼트에서만 의미가 있으므로 별도 컴포넌트로
 * 추출 — 같은 kind 위치에 인라인으로 두면 다른 kind로 바뀌었을 때
 * 훅 호출 순서가 깨질 수 있다. partial이 false가 되는 순간 displayed가
 * 전체 텍스트로 스냅된다.
 */
export function TextSegment({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'text' }>
}) {
  const displayed = useSmoothedText(segment.text, segment.partial === true)
  return (
    <MarkdownContent className="message-bubble__content" source={displayed} />
  )
}

export function PlanSegment({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'plan' }>
}) {
  return (
    <div className="message-bubble__plan">
      <div className="message-bubble__plan-label">📋 Plan</div>
      <MarkdownContent
        className="message-bubble__content"
        source={segment.text}
      />
    </div>
  )
}

function thinkingHeaderLabel(
  segment: Extract<AssistantSegment, { kind: 'thinking' }>,
): string {
  if (segment.partial) return 'Thinking…'
  if (typeof segment.duration_ms === 'number') {
    return `Thought for ${Math.max(1, Math.round(segment.duration_ms / 1000))}s`
  }
  return 'Thinking'
}

export function ThinkingSegment({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'thinking' }>
}) {
  const label = thinkingHeaderLabel(segment)
  const hasBody = segment.text.length > 0
  const containerCls = segment.partial
    ? 'message-bubble__thinking message-bubble__thinking--live'
    : 'message-bubble__thinking'
  const header = (
    <div className="message-bubble__thinking-summary">
      <span className="message-bubble__thinking-icon" aria-hidden="true">
        💭
      </span>
      <span>{label}</span>
      {segment.partial && (
        <span className="message-bubble__thinking-dots" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      )}
    </div>
  )
  // body가 없으면 한 줄짜리 배지로 줄인다 — signature만 받은 thinking에서 빈
  // 컨테이너가 남는 걸 막는다.
  if (!hasBody) {
    return (
      <div className={`${containerCls} message-bubble__thinking--badge`}>
        {header}
      </div>
    )
  }
  return (
    <div className={containerCls}>
      {header}
      <MarkdownContent
        className="message-bubble__thinking-text"
        source={segment.text}
      />
    </div>
  )
}

export function SkillBodySegment({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'skill_body' }>
}) {
  return (
    <details className="message-bubble__skill-body">
      <summary className="message-bubble__skill-body-summary">
        <span aria-hidden="true">📚</span>
        <span>Skill 본문</span>
        <span className="message-bubble__skill-body-name">{segment.skill}</span>
      </summary>
      <MarkdownContent
        className="message-bubble__skill-body-text"
        source={segment.text}
      />
    </details>
  )
}

export function InterruptedSegment() {
  return (
    <div className="message-bubble__interrupted" role="note">
      <span aria-hidden="true">⛔</span>
      <span>사용자에 의해 응답이 중단됨</span>
    </div>
  )
}

export function RedactedThinkingSegment() {
  return (
    <div className="message-bubble__redacted" aria-label="가려진 추론">
      🔒 가려진 추론 (안전상 본문이 노출되지 않음)
    </div>
  )
}

export function ImageSegment({
  segment,
}: {
  segment: Extract<AssistantSegment, { kind: 'image' }>
}) {
  if (segment.data_url) {
    return (
      <div className="message-bubble__image">
        <img src={segment.data_url} alt={segment.media_type} />
      </div>
    )
  }
  return (
    <div className="message-bubble__image-placeholder" aria-label="이미지">
      🖼 이미지 ({segment.media_type})
    </div>
  )
}

export function ToolResultSegment({
  segment,
  defaultOpen,
}: {
  segment: Extract<AssistantSegment, { kind: 'tool_result' }>
  defaultOpen?: boolean
}) {
  const cls = segment.is_error
    ? 'message-bubble__tool-result is-error'
    : 'message-bubble__tool-result'
  const label = segment.is_error ? '❌ 도구 실패' : '✓ 도구 결과'
  return (
    <details className={cls} open={defaultOpen}>
      <summary className="message-bubble__tool-result-summary">
        <span className="message-bubble__tool-result-label">{label}</span>
        {segment.text && (
          <span className="message-bubble__tool-result-preview">
            {/*
              CSS line-clamp가 처음 ~3줄을 보여주므로 단순 substring 컷
              대신 충분한 길이(400자)만 넘긴다. 너무 짧게 자르면 줄임표가
              너무 자주 보이고 길게 두면 collapse 시 layout이 뒤로 무거워짐.
            */}
            {segment.text.slice(0, TOOL_RESULT_PREVIEW_CHARS)}
          </span>
        )}
      </summary>
      {segment.text && (
        <pre className="message-bubble__tool-result-body">{segment.text}</pre>
      )}
    </details>
  )
}
