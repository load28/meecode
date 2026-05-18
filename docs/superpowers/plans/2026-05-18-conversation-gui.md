# Conversation GUI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tauri 데스크탑 앱 MeeCode의 좌측 터미널 노출을 폐기하고, jsonl에서 추출한 `QaPair[]`만으로 ChatGPT/opcode 스타일 대화형 GUI를 구성한다. 답변 길이에 따라 폴드/펼쳐보기 패널을 분리하고, 자동 전환 옵션을 제공한다.

**Architecture:** 가상 스크롤 기반 `ChatStream` + `QaCard`로 메인 대화 영역을, `ExpandPane`으로 단일 답변 펼쳐보기를 구성. PTY는 백그라운드에서 그대로 돌고 프론트는 `pty:data` 구독을 끊고 `write_input`만 사용. 자동 전환 상태는 `useExpandPanel` 훅이 관장하며 옵션은 localStorage에 저장.

**Tech Stack:** React 18, TypeScript, Tauri 2, `@tanstack/react-virtual` (신규), `framer-motion` (신규), `marked` + `DOMPurify`, Vitest + Testing Library.

**Spec reference:** `docs/superpowers/specs/2026-05-18-conversation-gui-design.md`

---

## File Structure

**Create:**
- `src/utils/segmentHelpers.ts` — `totalTextChars`, `makePreview` 순수 함수
- `src/utils/segmentHelpers.test.ts`
- `src/hooks/useExpandPanel.ts` — 펼쳐보기 패널 상태 + 자동 전환
- `src/hooks/useExpandPanel.test.ts`
- `src/components/MessageBubble/index.tsx` — 공유 마크다운/segment 렌더 유틸 (named export `renderMarkdown`, `SegmentView`)
- `src/components/MessageBubble/MessageBubble.css`
- `src/components/MessageBubble/MessageBubble.test.tsx`
- `src/components/QaCard/index.tsx`
- `src/components/QaCard/QaCard.css`
- `src/components/QaCard/QaCard.test.tsx`
- `src/components/ChatComposer/index.tsx`
- `src/components/ChatComposer/ChatComposer.css`
- `src/components/ChatComposer/ChatComposer.test.tsx`
- `src/components/ChatStream/index.tsx`
- `src/components/ChatStream/ChatStream.css`
- `src/components/ChatStream/ChatStream.test.tsx`
- `src/components/ExpandPane/index.tsx`
- `src/components/ExpandPane/ExpandPane.css`
- `src/components/ExpandPane/ExpandPane.test.tsx`

**Modify:**
- `package.json` — `@tanstack/react-virtual`, `framer-motion` 추가
- `src/hooks/usePtyStream.ts` — `selectedId`, `isVisible`, `selectPair` 제거. 반환은 `{ pairs }`만.
- `src/hooks/usePtyStream.test.ts` — 축소된 반환에 맞게 갱신
- `src/App.tsx` — TerminalPane/MarkdownPane 제거, 신규 컴포넌트 와이어링
- `src/App.css` — 헤더에 autoExpand 토글 스타일 추가

**Delete:**
- `src/components/TerminalPane/` (index.tsx, TerminalPane.css, TerminalPane.test.tsx 전부)
- `src/components/MarkdownPane/` (index.tsx, MarkdownPane.css, MarkdownPane.test.tsx 전부)
- `src/components/MessageList/` (index.tsx, MessageList.css 전부)

---

## Task 1: Add dependencies

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install libraries**

Run from project root:
```bash
npm install @tanstack/react-virtual@^3.10.0 framer-motion@^11.0.0
```

Expected: 두 패키지가 `dependencies`에 추가, `package-lock.json` 갱신.

- [ ] **Step 2: Verify install**

```bash
npm ls @tanstack/react-virtual framer-motion
```
Expected: 두 라이브러리 버전이 출력되고 에러 없음.

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "$(cat <<'EOF'
chore(deps): add react-virtual and framer-motion

대화 GUI 재설계를 위한 가상 스크롤과 메시지 등장 애니메이션 의존성을 추가한다.
EOF
)"
```

---

## Task 2: `segmentHelpers` utility (TDD)

**Files:**
- Create: `src/utils/segmentHelpers.ts`
- Test: `src/utils/segmentHelpers.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/utils/segmentHelpers.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { totalTextChars, makePreview } from './segmentHelpers'
import type { AssistantSegment } from '../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const plan = (s: string): AssistantSegment => ({ kind: 'plan', text: s })
const tool = (name: string, summary = ''): AssistantSegment => ({
  kind: 'tool_use',
  name,
  summary,
})

describe('totalTextChars', () => {
  it('text와 plan 세그먼트의 길이만 합산', () => {
    const segs = [text('hello'), tool('Bash', 'ls'), plan('plan body')]
    expect(totalTextChars(segs)).toBe('hello'.length + 'plan body'.length)
  })

  it('빈 배열은 0', () => {
    expect(totalTextChars([])).toBe(0)
  })

  it('tool_use만 있으면 0', () => {
    expect(totalTextChars([tool('Bash', 'ls')])).toBe(0)
  })

  it('한글 문자 수를 정확히 카운트', () => {
    expect(totalTextChars([text('안녕하세요')])).toBe(5)
  })
})

describe('makePreview', () => {
  it('짧은 문자열은 그대로 반환', () => {
    expect(makePreview('hello')).toBe('hello')
  })

  it('240자 초과 시 240자에서 자르고 말줄임표', () => {
    const long = 'a'.repeat(300)
    const out = makePreview(long)
    expect(out.length).toBe(241) // 240 + '…'
    expect(out.endsWith('…')).toBe(true)
  })

  it('4줄 이상이면 3줄까지만 + 말줄임표', () => {
    const four = 'line1\nline2\nline3\nline4'
    expect(makePreview(four)).toBe('line1\nline2\nline3…')
  })

  it('3줄이지만 240자 초과면 240자 우선', () => {
    const huge = 'a'.repeat(250) + '\nline2'
    const out = makePreview(huge)
    expect(out.length).toBe(241)
    expect(out.endsWith('…')).toBe(true)
  })

  it('text와 plan 세그먼트를 줄바꿈 두 칸으로 결합', () => {
    // makePreview는 string을 받지만 결합 책임은 호출자에게 둔다 — 헬퍼는 순수.
    // 이 케이스는 결합 컨벤션을 확인하는 사용 예시.
    const combined = ['first text', 'plan body'].join('\n\n')
    expect(makePreview(combined)).toBe('first text\n\nplan body')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/utils/segmentHelpers.test.ts`
Expected: FAIL — `Cannot find module './segmentHelpers'`.

- [ ] **Step 3: Implement minimal code to pass**

Create `src/utils/segmentHelpers.ts`:
```ts
import type { AssistantSegment } from '../types'

const PREVIEW_MAX_CHARS = 240
const PREVIEW_MAX_LINES = 3
const ELLIPSIS = '…'

export function totalTextChars(segments: AssistantSegment[]): number {
  let total = 0
  for (const seg of segments) {
    if (seg.kind === 'text' || seg.kind === 'plan') {
      total += [...seg.text].length
    }
  }
  return total
}

export function makePreview(src: string): string {
  const lines = src.split('\n')
  let preview = lines.length > PREVIEW_MAX_LINES
    ? lines.slice(0, PREVIEW_MAX_LINES).join('\n')
    : src
  let truncated = preview !== src

  if (preview.length > PREVIEW_MAX_CHARS) {
    preview = preview.slice(0, PREVIEW_MAX_CHARS)
    truncated = true
  }

  return truncated ? preview + ELLIPSIS : preview
}
```

> Note: `[...seg.text].length`는 코드포인트 단위 길이 — 한글/이모지 안전.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/utils/segmentHelpers.test.ts`
Expected: 모든 케이스 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/utils/segmentHelpers.ts src/utils/segmentHelpers.test.ts
git commit -m "$(cat <<'EOF'
feat(utils): add segment text counting and preview helpers

QaPair의 text/plan 세그먼트 합산 길이와 미리보기(앞 3줄 또는 240자) 헬퍼를 추가한다.
EOF
)"
```

---

## Task 3: `useExpandPanel` hook (TDD)

**Files:**
- Create: `src/hooks/useExpandPanel.ts`
- Test: `src/hooks/useExpandPanel.test.ts`

- [ ] **Step 1: Write the failing test**

Create `src/hooks/useExpandPanel.test.ts`:
```ts
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useExpandPanel } from './useExpandPanel'
import type { QaPair, AssistantSegment } from '../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const pair = (id: string, segs: AssistantSegment[]): QaPair => ({
  id,
  user_text: 'q',
  segments: segs,
  timestamp: '2026-05-18T00:00:00Z',
})

const LONG = 'a'.repeat(600)
const SHORT = 'hi'

describe('useExpandPanel', () => {
  beforeEach(() => {
    localStorage.clear()
  })

  it('초기 상태: 펼쳐진 페어 없음, 패널 닫힘, autoExpand 기본 true', () => {
    const { result } = renderHook(() => useExpandPanel([]))
    expect(result.current.expandedId).toBeNull()
    expect(result.current.isOpen).toBe(false)
    expect(result.current.autoExpand).toBe(true)
  })

  it('localStorage 값으로 autoExpand 초기화', () => {
    localStorage.setItem('meecode.autoExpand', 'false')
    const { result } = renderHook(() => useExpandPanel([]))
    expect(result.current.autoExpand).toBe(false)
  })

  it('setAutoExpand는 localStorage에도 저장', () => {
    const { result } = renderHook(() => useExpandPanel([]))
    act(() => result.current.setAutoExpand(false))
    expect(result.current.autoExpand).toBe(false)
    expect(localStorage.getItem('meecode.autoExpand')).toBe('false')
  })

  it('긴 답변이 도착하면 자동으로 펼침', () => {
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [] as QaPair[] },
    })
    rerender({ pairs: [pair('a', [text(LONG)])] })
    expect(result.current.expandedId).toBe('a')
    expect(result.current.isOpen).toBe(true)
  })

  it('짧은 답변은 자동 전환 안 함', () => {
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [] as QaPair[] },
    })
    rerender({ pairs: [pair('a', [text(SHORT)])] })
    expect(result.current.expandedId).toBeNull()
    expect(result.current.isOpen).toBe(false)
  })

  it('autoExpand=false면 긴 답변도 자동 전환 안 함', () => {
    localStorage.setItem('meecode.autoExpand', 'false')
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [] as QaPair[] },
    })
    rerender({ pairs: [pair('a', [text(LONG)])] })
    expect(result.current.expandedId).toBeNull()
  })

  it('같은 페어가 segments 누적으로 여러 번 갱신돼도 자동 전환은 1회만', () => {
    const { result, rerender } = renderHook(({ pairs }) => useExpandPanel(pairs), {
      initialProps: { pairs: [pair('a', [text(LONG)])] as QaPair[] },
    })
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.toggleOpen()) // 사용자가 닫음
    expect(result.current.isOpen).toBe(false)
    rerender({ pairs: [pair('a', [text(LONG), text(' more')])] })
    expect(result.current.isOpen).toBe(false) // 같은 id면 재오픈 안 함
  })

  it('setExpandedId/toggleOpen 수동 조작', () => {
    const { result } = renderHook(() => useExpandPanel([pair('a', [text('hi')])]))
    act(() => result.current.setExpandedId('a'))
    expect(result.current.expandedId).toBe('a')
    act(() => result.current.toggleOpen())
    expect(result.current.isOpen).toBe(true)
    act(() => result.current.toggleOpen())
    expect(result.current.isOpen).toBe(false)
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/hooks/useExpandPanel.test.ts`
Expected: FAIL — `Cannot find module './useExpandPanel'`.

- [ ] **Step 3: Implement the hook**

Create `src/hooks/useExpandPanel.ts`:
```ts
import { useCallback, useEffect, useRef, useState } from 'react'
import type { QaPair } from '../types'
import { totalTextChars } from '../utils/segmentHelpers'

const STORAGE_KEY = 'meecode.autoExpand'
const AUTO_THRESHOLD = 500

interface UseExpandPanelReturn {
  expandedId: string | null
  setExpandedId: (id: string | null) => void
  isOpen: boolean
  toggleOpen: () => void
  autoExpand: boolean
  setAutoExpand: (v: boolean) => void
}

function readAutoExpand(): boolean {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === null) return true
  return stored !== 'false'
}

export function useExpandPanel(pairs: QaPair[]): UseExpandPanelReturn {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [isOpen, setIsOpen] = useState(false)
  const [autoExpand, setAutoExpandState] = useState<boolean>(readAutoExpand)
  const lastSeenRef = useRef<string | null>(null)

  const setAutoExpand = useCallback((v: boolean) => {
    setAutoExpandState(v)
    localStorage.setItem(STORAGE_KEY, String(v))
  }, [])

  const toggleOpen = useCallback(() => {
    setIsOpen((prev) => !prev)
  }, [])

  useEffect(() => {
    if (!autoExpand) return
    if (pairs.length === 0) return
    const newest = pairs[pairs.length - 1]
    if (lastSeenRef.current === newest.id) return
    lastSeenRef.current = newest.id
    if (totalTextChars(newest.segments) > AUTO_THRESHOLD) {
      setExpandedId(newest.id)
      setIsOpen(true)
    }
  }, [pairs, autoExpand])

  return {
    expandedId,
    setExpandedId,
    isOpen,
    toggleOpen,
    autoExpand,
    setAutoExpand,
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/hooks/useExpandPanel.test.ts`
Expected: 모든 케이스 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/useExpandPanel.ts src/hooks/useExpandPanel.test.ts
git commit -m "$(cat <<'EOF'
feat(hooks): add useExpandPanel for right-panel state

펼쳐보기 패널의 선택/열림 상태와 긴 답변 자동 전환(autoExpand 옵션, localStorage 영속화)을 관리하는 훅을 추가한다.
EOF
)"
```

---

## Task 4: `MessageBubble` shared module (TDD)

**Files:**
- Create: `src/components/MessageBubble/index.tsx`
- Create: `src/components/MessageBubble/MessageBubble.css`
- Test: `src/components/MessageBubble/MessageBubble.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/MessageBubble/MessageBubble.test.tsx`:
```tsx
import { render, screen } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { renderMarkdown, SegmentView } from './index'
import type { AssistantSegment } from '../../types'

describe('renderMarkdown', () => {
  it('마크다운을 안전한 HTML로 변환', () => {
    const html = renderMarkdown('# Title\n\n**bold**')
    expect(html).toContain('<h1>Title</h1>')
    expect(html).toContain('<strong>bold</strong>')
  })

  it('XSS 스크립트를 sanitize', () => {
    const html = renderMarkdown('<script>alert(1)</script>')
    expect(html).not.toContain('<script>')
  })
})

describe('SegmentView', () => {
  it('text 세그먼트를 마크다운으로 렌더', () => {
    const seg: AssistantSegment = { kind: 'text', text: '# Hello' }
    render(<SegmentView segment={seg} />)
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('Hello')
  })

  it('plan 세그먼트를 라벨과 함께 렌더', () => {
    const seg: AssistantSegment = { kind: 'plan', text: '# Plan body' }
    const { container } = render(<SegmentView segment={seg} />)
    expect(screen.getByText('📋 Plan')).toBeInTheDocument()
    expect(container.querySelector('.message-bubble__plan')).toBeInTheDocument()
  })

  it('tool_use 세그먼트를 details로 렌더 (기본 닫힘)', () => {
    const seg: AssistantSegment = { kind: 'tool_use', name: 'Bash', summary: 'ls -la' }
    const { container } = render(<SegmentView segment={seg} />)
    const det = container.querySelector('.message-bubble__tool') as HTMLDetailsElement
    expect(det).not.toBeNull()
    expect(det.open).toBe(false)
    expect(det.textContent).toContain('Bash')
    expect(det.textContent).toContain('ls -la')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/MessageBubble`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Implement the module**

Create `src/components/MessageBubble/index.tsx`:
```tsx
import { marked } from 'marked'
import DOMPurify from 'dompurify'
import type { AssistantSegment } from '../../types'
import './MessageBubble.css'

export function renderMarkdown(src: string): string {
  const raw = marked.parse(src, { async: false }) as string
  return DOMPurify.sanitize(raw)
}

interface SegmentViewProps {
  segment: AssistantSegment
}

export function SegmentView({ segment }: SegmentViewProps) {
  if (segment.kind === 'text') {
    return (
      <div
        className="message-bubble__content"
        dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.text) }}
      />
    )
  }
  if (segment.kind === 'plan') {
    return (
      <div className="message-bubble__plan">
        <div className="message-bubble__plan-label">📋 Plan</div>
        <div
          className="message-bubble__content"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(segment.text) }}
        />
      </div>
    )
  }
  return (
    <details className="message-bubble__tool">
      <summary className="message-bubble__tool-summary">
        <span className="message-bubble__tool-name">{segment.name}</span>
        {segment.summary && (
          <span className="message-bubble__tool-arg">{segment.summary}</span>
        )}
      </summary>
    </details>
  )
}
```

Create `src/components/MessageBubble/MessageBubble.css` (기존 MarkdownPane.css의 마크다운/세그먼트 스타일을 옮겨 클래스 prefix만 변경):
```css
.message-bubble__plan {
  border: 1px solid #30363d;
  border-left: 3px solid #d29922;
  border-radius: 8px;
  padding: 12px 16px;
  background: #161b22;
}

.message-bubble__plan-label {
  font-size: 11px;
  color: #d29922;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 8px;
}

.message-bubble__plan .message-bubble__content {
  font-size: 14px;
}

.message-bubble__tool {
  border: 1px solid #21262d;
  border-radius: 6px;
  background: #0f141b;
  font-size: 12px;
}

.message-bubble__tool[open] {
  background: #11161d;
}

.message-bubble__tool-summary {
  cursor: pointer;
  list-style: none;
  padding: 6px 10px;
  display: flex;
  align-items: center;
  gap: 8px;
  color: #8b949e;
  user-select: none;
}

.message-bubble__tool-summary::-webkit-details-marker {
  display: none;
}

.message-bubble__tool-summary::before {
  content: '▸';
  color: #6e7681;
  font-size: 10px;
  transition: transform 0.15s;
}

.message-bubble__tool[open] > .message-bubble__tool-summary::before {
  transform: rotate(90deg);
}

.message-bubble__tool-name {
  color: #79c0ff;
  font-family: 'Menlo', 'Monaco', monospace;
  font-weight: 600;
}

.message-bubble__tool-arg {
  color: #8b949e;
  font-family: 'Menlo', 'Monaco', monospace;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
  min-width: 0;
}

.message-bubble__content h1,
.message-bubble__content h2,
.message-bubble__content h3 {
  color: #e6edf3;
  border-bottom: 1px solid #21262d;
  padding-bottom: 8px;
  margin-top: 24px;
}

.message-bubble__content code {
  background: #161b22;
  padding: 2px 6px;
  border-radius: 4px;
  font-family: 'Menlo', 'Monaco', monospace;
  font-size: 13px;
  color: #79c0ff;
}

.message-bubble__content pre {
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 8px;
  padding: 16px;
  overflow-x: auto;
}

.message-bubble__content pre code {
  background: none;
  padding: 0;
  color: #c9d1d9;
}

.message-bubble__content blockquote {
  border-left: 4px solid #30363d;
  margin-left: 0;
  padding-left: 16px;
  color: #8b949e;
}

.message-bubble__content a {
  color: #58a6ff;
}

.message-bubble__content table {
  border-collapse: collapse;
  width: 100%;
  margin: 16px 0;
}

.message-bubble__content th,
.message-bubble__content td {
  border: 1px solid #30363d;
  padding: 8px 12px;
  text-align: left;
}

.message-bubble__content th {
  background: #161b22;
  color: #e6edf3;
}

.message-bubble__content ::selection {
  background: #264f78;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/MessageBubble`
Expected: 모든 케이스 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/MessageBubble/
git commit -m "$(cat <<'EOF'
feat(message-bubble): extract shared markdown and segment renderer

QaCard와 ExpandPane 양쪽이 공유할 마크다운 sanitize 렌더링과 text/plan/tool_use 세그먼트 컴포넌트를 추출한다.
EOF
)"
```

---

## Task 5: `QaCard` component (TDD)

**Files:**
- Create: `src/components/QaCard/index.tsx`
- Create: `src/components/QaCard/QaCard.css`
- Test: `src/components/QaCard/QaCard.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/QaCard/QaCard.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { QaCard } from './index'
import type { AssistantSegment, QaPair } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const tool = (name: string, summary = ''): AssistantSegment => ({
  kind: 'tool_use', name, summary,
})

const pair = (id: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: '내 질문', segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

const LONG = 'a'.repeat(600)

describe('QaCard', () => {
  it('짧은 답변은 전체 텍스트를 인라인 렌더', () => {
    const p = pair('a', [text('hello')])
    render(<QaCard pair={p} isExpandedInPane={false} onExpand={() => {}} />)
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /전체보기/ })).toBeNull()
  })

  it('질문 텍스트를 표시', () => {
    render(<QaCard pair={pair('a', [text('r')])} isExpandedInPane={false} onExpand={() => {}} />)
    expect(screen.getByText('내 질문')).toBeInTheDocument()
  })

  it('500자 초과 답변은 미리보기 + 전체보기 버튼', () => {
    render(
      <QaCard pair={pair('a', [text(LONG)])} isExpandedInPane={false} onExpand={() => {}} />
    )
    expect(screen.getByRole('button', { name: '답변 전체보기' })).toBeInTheDocument()
  })

  it('전체보기 버튼 클릭 시 onExpand 호출', () => {
    const onExpand = vi.fn()
    render(
      <QaCard pair={pair('a', [text(LONG)])} isExpandedInPane={false} onExpand={onExpand} />
    )
    fireEvent.click(screen.getByRole('button', { name: '답변 전체보기' }))
    expect(onExpand).toHaveBeenCalledTimes(1)
  })

  it('isExpandedInPane=true면 본문 자리에 안내 메시지', () => {
    const { container } = render(
      <QaCard pair={pair('a', [text(LONG)])} isExpandedInPane={true} onExpand={() => {}} />
    )
    expect(screen.getByText('오른쪽 패널에 펼쳐짐')).toBeInTheDocument()
    expect(container.querySelector('.qa-card__preview')).toBeNull()
  })

  it('segments가 비어 있으면 응답 대기 placeholder', () => {
    render(<QaCard pair={pair('a', [])} isExpandedInPane={false} onExpand={() => {}} />)
    expect(screen.getByText('응답 대기 중…')).toBeInTheDocument()
  })

  it('tool_use는 폴드 무관 항상 inline', () => {
    const p = pair('a', [text(LONG), tool('Bash', 'ls')])
    render(<QaCard pair={p} isExpandedInPane={false} onExpand={() => {}} />)
    // tool_use details는 폴드 모드에서도 별도로 노출
    expect(screen.getByText('Bash')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/QaCard`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Implement the component**

Create `src/components/QaCard/index.tsx`:
```tsx
import type { QaPair } from '../../types'
import { renderMarkdown, SegmentView } from '../MessageBubble'
import { totalTextChars, makePreview } from '../../utils/segmentHelpers'
import './QaCard.css'

const FOLD_THRESHOLD = 500

interface Props {
  pair: QaPair
  isExpandedInPane: boolean
  onExpand: () => void
}

function combineTextPlan(segments: QaPair['segments']): string {
  return segments
    .filter((s) => s.kind === 'text' || s.kind === 'plan')
    .map((s) => (s as { text: string }).text)
    .join('\n\n')
}

export function QaCard({ pair, isExpandedInPane, onExpand }: Props) {
  const totalChars = totalTextChars(pair.segments)
  const isFolded = totalChars > FOLD_THRESHOLD
  const toolSegments = pair.segments.filter((s) => s.kind === 'tool_use')
  const hasAnyContent = pair.segments.length > 0

  return (
    <article className="qa-card">
      <header className="qa-card__question">
        <span className="qa-card__question-label">Q</span>
        <span className="qa-card__question-text">{pair.user_text}</span>
      </header>

      {isExpandedInPane ? (
        <div className="qa-card__expanded-notice">오른쪽 패널에 펼쳐짐</div>
      ) : !hasAnyContent ? (
        <div className="qa-card__pending">응답 대기 중…</div>
      ) : isFolded ? (
        <div className="qa-card__answer qa-card__answer--folded">
          <div
            className="qa-card__preview"
            dangerouslySetInnerHTML={{
              __html: renderMarkdown(makePreview(combineTextPlan(pair.segments))),
            }}
          />
          <div className="qa-card__fade" aria-hidden="true" />
          {toolSegments.length > 0 && (
            <div className="qa-card__tools">
              {toolSegments.map((seg, i) => (
                <SegmentView key={i} segment={seg} />
              ))}
            </div>
          )}
          <button
            type="button"
            className="qa-card__expand-btn"
            aria-label="답변 전체보기"
            onClick={onExpand}
          >
            전체보기 →
          </button>
        </div>
      ) : (
        <div className="qa-card__answer">
          {pair.segments.map((seg, i) => (
            <SegmentView key={i} segment={seg} />
          ))}
        </div>
      )}
    </article>
  )
}
```

Create `src/components/QaCard/QaCard.css`:
```css
.qa-card {
  border: 1px solid #21262d;
  border-radius: 10px;
  background: #0d1117;
  padding: 14px 16px;
  margin: 8px 0;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.qa-card__question {
  display: flex;
  gap: 10px;
  align-items: baseline;
  padding-bottom: 8px;
  border-bottom: 1px solid #161b22;
}

.qa-card__question-label {
  color: #58a6ff;
  font-weight: 700;
  font-size: 12px;
  flex-shrink: 0;
}

.qa-card__question-text {
  color: #e6edf3;
  font-size: 14px;
  white-space: pre-wrap;
  word-break: break-word;
}

.qa-card__answer {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.qa-card__answer--folded {
  position: relative;
}

.qa-card__preview {
  max-height: 8em;
  overflow: hidden;
  color: #c9d1d9;
  font-size: 14px;
  line-height: 1.7;
  white-space: pre-wrap;
  user-select: none;
}

.qa-card__fade {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 36px;
  height: 48px;
  background: linear-gradient(to bottom, transparent, #0d1117);
  pointer-events: none;
}

.qa-card__tools {
  display: flex;
  flex-direction: column;
  gap: 6px;
  margin-top: 10px;
}

.qa-card__expand-btn {
  align-self: flex-start;
  background: #1f6feb;
  color: #fff;
  border: none;
  border-radius: 6px;
  padding: 6px 14px;
  font-size: 13px;
  cursor: pointer;
  margin-top: 8px;
}

.qa-card__expand-btn:hover {
  background: #388bfd;
}

.qa-card__expanded-notice {
  color: #6e7681;
  font-size: 13px;
  font-style: italic;
  padding: 16px 0;
  text-align: center;
}

.qa-card__pending {
  color: #6e7681;
  font-size: 13px;
  padding: 8px 0;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/QaCard`
Expected: 모든 케이스 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/QaCard/
git commit -m "$(cat <<'EOF'
feat(qa-card): add fold-aware Q&A card

답변 전체 텍스트 길이가 500자를 초과하면 앞 3줄(혹은 240자) 미리보기 + 전체보기 버튼으로 폴드하는 카드 컴포넌트를 추가한다.
EOF
)"
```

---

## Task 6: `ChatComposer` component (TDD)

**Files:**
- Create: `src/components/ChatComposer/index.tsx`
- Create: `src/components/ChatComposer/ChatComposer.css`
- Test: `src/components/ChatComposer/ChatComposer.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ChatComposer/ChatComposer.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ChatComposer } from './index'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined),
}))
import { invoke } from '@tauri-apps/api/core'

describe('ChatComposer', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('Enter 입력 시 write_input 호출, 텍스트 끝에 CR', async () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    expect(invoke).toHaveBeenCalledWith('write_input', { text: 'hello\r' })
  })

  it('Shift+Enter는 줄바꿈만, write_input 호출 안 함', () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'hello' } })
    fireEvent.keyDown(ta, { key: 'Enter', shiftKey: true })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('전송 후 textarea 비움', async () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await Promise.resolve()
    expect(ta.value).toBe('')
  })

  it('IME composition 중 Enter는 차단', () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.compositionStart(ta)
    fireEvent.change(ta, { target: { value: '한' } })
    fireEvent.keyDown(ta, { key: 'Enter', keyCode: 229 })
    expect(invoke).not.toHaveBeenCalled()
  })

  it('ESC 버튼은 \\x1b 전송', () => {
    render(<ChatComposer />)
    fireEvent.click(screen.getByRole('button', { name: 'ESC' }))
    expect(invoke).toHaveBeenCalledWith('write_input', { text: '\x1b' })
  })

  it('Shift+Tab 버튼은 \\x1b[Z 전송', () => {
    render(<ChatComposer />)
    fireEvent.click(screen.getByRole('button', { name: 'Shift+Tab' }))
    expect(invoke).toHaveBeenCalledWith('write_input', { text: '\x1b[Z' })
  })

  it('Ctrl+C 버튼은 \\x03 전송', () => {
    render(<ChatComposer />)
    fireEvent.click(screen.getByRole('button', { name: 'Ctrl+C' }))
    expect(invoke).toHaveBeenCalledWith('write_input', { text: '\x03' })
  })

  it('/ 입력 시 슬래시 명령 팝오버 표시', () => {
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: '/' } })
    expect(screen.getByText('/help')).toBeInTheDocument()
    expect(screen.getByText('/clear')).toBeInTheDocument()
  })

  it('write_input 실패 시 에러 메시지 표시, 텍스트 보존', async () => {
    ;(invoke as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('pty closed'))
    render(<ChatComposer />)
    const ta = screen.getByRole('textbox') as HTMLTextAreaElement
    fireEvent.change(ta, { target: { value: 'q' } })
    fireEvent.keyDown(ta, { key: 'Enter' })
    await new Promise((r) => setTimeout(r, 0))
    expect(screen.getByRole('alert').textContent).toContain('pty closed')
    expect(ta.value).toBe('q')
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/ChatComposer`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Implement the component**

Create `src/components/ChatComposer/index.tsx`:
```tsx
import { useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import './ChatComposer.css'

const SLASH_COMMANDS = ['/help', '/clear', '/model', '/cost', '/compact']

export function ChatComposer() {
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [showSlash, setShowSlash] = useState(false)
  const isComposingRef = useRef(false)

  const send = async (text: string) => {
    setError(null)
    try {
      await invoke('write_input', { text })
    } catch (e) {
      setError(String(e))
      throw e
    }
  }

  const submit = async () => {
    if (!value) return
    const toSend = value + '\r'
    const snapshot = value
    setValue('')
    try {
      await send(toSend)
    } catch {
      setValue(snapshot)
    }
  }

  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (isComposingRef.current || e.keyCode === 229 || (e.nativeEvent as KeyboardEvent).isComposing) {
      return
    }
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      submit()
    }
  }

  const onChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value
    setValue(v)
    setShowSlash(v.startsWith('/'))
  }

  const onSelectSlash = (cmd: string) => {
    setValue(cmd + ' ')
    setShowSlash(false)
  }

  const handleControl = (text: string) => {
    send(text).catch(() => {})
  }

  return (
    <div className="chat-composer">
      {error && (
        <div role="alert" className="chat-composer__error">
          {error}
        </div>
      )}
      {showSlash && (
        <ul className="chat-composer__slash" role="listbox">
          {SLASH_COMMANDS.filter((c) => c.startsWith(value)).map((c) => (
            <li key={c}>
              <button type="button" onClick={() => onSelectSlash(c)}>
                {c}
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="chat-composer__row">
        <textarea
          className="chat-composer__textarea"
          value={value}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onCompositionStart={() => { isComposingRef.current = true }}
          onCompositionEnd={() => { isComposingRef.current = false }}
          placeholder="메시지를 입력하세요 (Enter 전송 · Shift+Enter 줄바꿈)"
          rows={2}
        />
        <div className="chat-composer__buttons">
          <button type="button" onClick={() => handleControl('\x1b')}>ESC</button>
          <button type="button" onClick={() => handleControl('\x1b[Z')}>Shift+Tab</button>
          <button type="button" onClick={() => handleControl('\x03')}>Ctrl+C</button>
        </div>
      </div>
    </div>
  )
}
```

Create `src/components/ChatComposer/ChatComposer.css`:
```css
.chat-composer {
  border-top: 1px solid #21262d;
  background: #0d1117;
  padding: 10px 14px;
  display: flex;
  flex-direction: column;
  gap: 6px;
  position: relative;
}

.chat-composer__error {
  color: #f85149;
  font-size: 12px;
  padding: 4px 6px;
  background: #2b1416;
  border: 1px solid #5d1f23;
  border-radius: 4px;
}

.chat-composer__slash {
  list-style: none;
  margin: 0;
  padding: 4px 0;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  position: absolute;
  bottom: 100%;
  left: 14px;
  right: 14px;
  z-index: 10;
}

.chat-composer__slash button {
  width: 100%;
  text-align: left;
  background: transparent;
  border: none;
  color: #c9d1d9;
  font-family: 'Menlo', 'Monaco', monospace;
  padding: 6px 12px;
  cursor: pointer;
}

.chat-composer__slash button:hover {
  background: #1f6feb;
  color: #fff;
}

.chat-composer__row {
  display: flex;
  gap: 8px;
  align-items: stretch;
}

.chat-composer__textarea {
  flex: 1;
  background: #161b22;
  border: 1px solid #30363d;
  border-radius: 6px;
  color: #e6edf3;
  font-size: 14px;
  padding: 8px 10px;
  resize: vertical;
  min-height: 44px;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  outline: none;
}

.chat-composer__textarea:focus {
  border-color: #58a6ff;
}

.chat-composer__buttons {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.chat-composer__buttons button {
  background: #21262d;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 5px;
  padding: 4px 10px;
  font-size: 11px;
  cursor: pointer;
  font-family: 'Menlo', 'Monaco', monospace;
}

.chat-composer__buttons button:hover {
  background: #30363d;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/ChatComposer`
Expected: 모든 케이스 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatComposer/
git commit -m "$(cat <<'EOF'
feat(chat-composer): add chat input with control keys and slash hint

전송용 textarea, ESC/Shift+Tab/Ctrl+C 전용 버튼, 슬래시 명령 자동완성 팝오버를 갖춘 입력창 컴포넌트를 추가한다. IME composition 안전 처리와 전송 실패 시 텍스트 보존을 포함한다.
EOF
)"
```

---

## Task 7: `ChatStream` component (TDD)

**Files:**
- Create: `src/components/ChatStream/index.tsx`
- Create: `src/components/ChatStream/ChatStream.css`
- Test: `src/components/ChatStream/ChatStream.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ChatStream/ChatStream.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ChatStream } from './index'
import type { QaPair, AssistantSegment } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const pair = (id: string, q: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: q, segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

describe('ChatStream', () => {
  it('빈 pairs일 때 빈 상태 안내', () => {
    render(<ChatStream pairs={[]} expandedId={null} onExpand={() => {}} />)
    expect(screen.getByText(/첫 질문/)).toBeInTheDocument()
  })

  it('pairs를 시간순으로 카드 렌더', () => {
    const pairs = [
      pair('a', '첫째 질문', [text('첫 답변')]),
      pair('b', '둘째 질문', [text('둘째 답변')]),
    ]
    render(<ChatStream pairs={pairs} expandedId={null} onExpand={() => {}} />)
    expect(screen.getByText('첫째 질문')).toBeInTheDocument()
    expect(screen.getByText('둘째 질문')).toBeInTheDocument()
  })

  it('전체보기 버튼 클릭 시 onExpand(id) 호출', () => {
    const onExpand = vi.fn()
    const long = 'a'.repeat(600)
    const pairs = [pair('a', 'q', [text(long)])]
    render(<ChatStream pairs={pairs} expandedId={null} onExpand={onExpand} />)
    fireEvent.click(screen.getByRole('button', { name: '답변 전체보기' }))
    expect(onExpand).toHaveBeenCalledWith('a')
  })

  it('expandedId와 일치하는 카드는 안내 메시지', () => {
    const long = 'a'.repeat(600)
    const pairs = [pair('a', 'q', [text(long)])]
    render(<ChatStream pairs={pairs} expandedId="a" onExpand={() => {}} />)
    expect(screen.getByText('오른쪽 패널에 펼쳐짐')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/ChatStream`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Implement the component**

Create `src/components/ChatStream/index.tsx`:
```tsx
import { useEffect, useRef } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { AnimatePresence, motion } from 'framer-motion'
import { QaCard } from '../QaCard'
import type { QaPair } from '../../types'
import './ChatStream.css'

interface Props {
  pairs: QaPair[]
  expandedId: string | null
  onExpand: (id: string) => void
}

export function ChatStream({ pairs, expandedId, onExpand }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const shouldAutoScrollRef = useRef(true)
  const userScrolledRef = useRef(false)

  const virtualizer = useVirtualizer({
    count: pairs.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 140,
    overscan: 6,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  useEffect(() => {
    if (!shouldAutoScrollRef.current || !scrollRef.current) return
    const el = scrollRef.current
    el.scrollTop = el.scrollHeight
  }, [pairs])

  const handleScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const atBottom = Math.abs(el.scrollHeight - el.scrollTop - el.clientHeight) < 50
    if (!atBottom) {
      userScrolledRef.current = true
      shouldAutoScrollRef.current = false
    } else if (userScrolledRef.current) {
      shouldAutoScrollRef.current = true
      userScrolledRef.current = false
    }
  }

  if (pairs.length === 0) {
    return (
      <div className="chat-stream chat-stream--empty">
        <p>프로젝트가 시작되었습니다. 아래에서 첫 질문을 입력하세요.</p>
      </div>
    )
  }

  const items = virtualizer.getVirtualItems()

  return (
    <div ref={scrollRef} className="chat-stream" onScroll={handleScroll}>
      <div
        style={{
          height: `${virtualizer.getTotalSize()}px`,
          width: '100%',
          position: 'relative',
        }}
      >
        <AnimatePresence mode="popLayout">
          {items.map((vi) => {
            const p = pairs[vi.index]
            return (
              <motion.div
                key={p.id}
                data-index={vi.index}
                ref={virtualizer.measureElement}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.18 }}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${vi.start}px)`,
                }}
              >
                <QaCard
                  pair={p}
                  isExpandedInPane={p.id === expandedId}
                  onExpand={() => onExpand(p.id)}
                />
              </motion.div>
            )
          })}
        </AnimatePresence>
      </div>
    </div>
  )
}
```

Create `src/components/ChatStream/ChatStream.css`:
```css
.chat-stream {
  flex: 1;
  overflow-y: auto;
  padding: 12px 16px;
  background: #010409;
  color: #c9d1d9;
}

.chat-stream--empty {
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6e7681;
  font-size: 14px;
  text-align: center;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/ChatStream`
Expected: 모든 케이스 PASS. (jsdom에선 scrollHeight 계산이 제한적이라 auto-scroll 동작 자체는 단위 테스트 대상이 아님.)

- [ ] **Step 5: Commit**

```bash
git add src/components/ChatStream/
git commit -m "$(cat <<'EOF'
feat(chat-stream): add virtual-scrolled message stream

QaPair[]를 시간순 가상 스크롤로 렌더링하고 새 페어 도착 시 바닥 자동 스크롤, framer-motion 등장 애니메이션을 적용한다.
EOF
)"
```

---

## Task 8: `ExpandPane` component (TDD)

**Files:**
- Create: `src/components/ExpandPane/index.tsx`
- Create: `src/components/ExpandPane/ExpandPane.css`
- Test: `src/components/ExpandPane/ExpandPane.test.tsx`

- [ ] **Step 1: Write the failing test**

Create `src/components/ExpandPane/ExpandPane.test.tsx`:
```tsx
import { render, screen, fireEvent } from '@testing-library/react'
import { describe, it, expect, vi } from 'vitest'
import { ExpandPane } from './index'
import type { AssistantSegment, QaPair } from '../../types'

const text = (s: string): AssistantSegment => ({ kind: 'text', text: s })
const pair = (id: string, q: string, segs: AssistantSegment[]): QaPair => ({
  id, user_text: q, segments: segs, timestamp: '2026-05-18T00:00:00Z',
})

describe('ExpandPane', () => {
  it('pair=null 시 placeholder', () => {
    render(<ExpandPane pair={null} isOpen={true} onToggle={() => {}} />)
    expect(screen.getByText(/'전체보기'/)).toBeInTheDocument()
  })

  it('pair 본문 풀 렌더 (폴드 없음)', () => {
    const long = 'a'.repeat(600)
    render(<ExpandPane pair={pair('a', '질문', [text(long)])} isOpen={true} onToggle={() => {}} />)
    expect(screen.getByText('질문')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /전체보기/ })).toBeNull()
  })

  it('토글 버튼 클릭 시 onToggle 호출', () => {
    const onToggle = vi.fn()
    render(<ExpandPane pair={pair('a', 'q', [text('r')])} isOpen={true} onToggle={onToggle} />)
    fireEvent.click(screen.getByRole('button', { name: /접기|닫기/ }))
    expect(onToggle).toHaveBeenCalled()
  })

  it('isOpen=false 시 패널 본문 미렌더 (collapsed strip만)', () => {
    const { container } = render(
      <ExpandPane pair={pair('a', 'q', [text('r')])} isOpen={false} onToggle={() => {}} />
    )
    expect(container.querySelector('.expand-pane--collapsed')).toBeInTheDocument()
    expect(container.querySelector('.expand-pane__body')).toBeNull()
  })
})
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/components/ExpandPane`
Expected: FAIL — 모듈 없음.

- [ ] **Step 3: Implement the component**

Create `src/components/ExpandPane/index.tsx`:
```tsx
import { useSelection } from '../../hooks/useSelection'
import { CommentFloat } from '../CommentFloat'
import { SegmentView } from '../MessageBubble'
import type { QaPair } from '../../types'
import './ExpandPane.css'

interface Props {
  pair: QaPair | null
  isOpen: boolean
  onToggle: () => void
}

function formatTime(iso: string): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function ExpandPane({ pair, isOpen, onToggle }: Props) {
  const { selection, handleMouseUp, clearSelection } = useSelection()

  if (!isOpen) {
    return (
      <div className="expand-pane expand-pane--collapsed">
        <button
          type="button"
          className="expand-pane__toggle"
          aria-label="펼쳐보기 패널 열기"
          aria-expanded={false}
          onClick={onToggle}
        >
          ◀
        </button>
      </div>
    )
  }

  return (
    <aside className="expand-pane" aria-expanded={true}>
      <header className="expand-pane__header">
        <button
          type="button"
          className="expand-pane__toggle"
          aria-label="펼쳐보기 패널 접기"
          onClick={onToggle}
        >
          ▶
        </button>
        <div className="expand-pane__title">
          {pair ? (
            <>
              <span className="expand-pane__time">{formatTime(pair.timestamp)}</span>
              <span className="expand-pane__q" title={pair.user_text}>
                Q. {pair.user_text}
              </span>
            </>
          ) : (
            <span className="expand-pane__title-empty">펼쳐보기</span>
          )}
        </div>
      </header>
      {pair ? (
        <div className="expand-pane__body" onMouseUp={handleMouseUp}>
          {pair.segments.map((seg, i) => (
            <SegmentView key={i} segment={seg} />
          ))}
          {selection.text && selection.rect && (
            <CommentFloat
              selection={{ text: selection.text, rect: selection.rect }}
              onClose={clearSelection}
            />
          )}
        </div>
      ) : (
        <div className="expand-pane__placeholder">
          메인에서 '전체보기'를 눌러 답변을 펼쳐보세요
        </div>
      )}
    </aside>
  )
}
```

Create `src/components/ExpandPane/ExpandPane.css`:
```css
.expand-pane {
  width: 100%;
  height: 100%;
  background: #0d1117;
  display: flex;
  flex-direction: column;
  color: #c9d1d9;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
  font-size: 15px;
  line-height: 1.7;
  position: relative;
}

.expand-pane--collapsed {
  width: 24px;
  border-left: 1px solid #21262d;
}

.expand-pane__header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid #21262d;
  background: #0d1117;
}

.expand-pane__toggle {
  background: #161b22;
  color: #c9d1d9;
  border: 1px solid #30363d;
  border-radius: 4px;
  padding: 2px 8px;
  cursor: pointer;
  font-size: 12px;
}

.expand-pane__title {
  display: flex;
  gap: 10px;
  min-width: 0;
  flex: 1;
}

.expand-pane__time {
  color: #58a6ff;
  font-size: 12px;
  flex-shrink: 0;
}

.expand-pane__q {
  color: #e6edf3;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.expand-pane__body {
  flex: 1;
  overflow-y: auto;
  padding: 20px 28px;
  user-select: text;
  position: relative;
}

.expand-pane__placeholder {
  color: #6e7681;
  font-size: 13px;
  text-align: center;
  padding: 48px 24px;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/components/ExpandPane`
Expected: 모든 케이스 PASS.

- [ ] **Step 5: Commit**

```bash
git add src/components/ExpandPane/
git commit -m "$(cat <<'EOF'
feat(expand-pane): add single-answer detail panel with comment

선택된 QaPair를 폴드 없이 풀 렌더하고 텍스트 선택 시 코멘트를 띄울 수 있는 오른쪽 펼쳐보기 패널을 추가한다. 접기/펴기 토글을 제공한다.
EOF
)"
```

---

## Task 9: Simplify `usePtyStream`

**Files:**
- Modify: `src/hooks/usePtyStream.ts`
- Modify: `src/hooks/usePtyStream.test.ts`

- [ ] **Step 1: Update the test to reflect new shape**

Replace `src/hooks/usePtyStream.test.ts` content with:
```ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { usePtyStream } from './usePtyStream'
import type { QaPair } from '../types'

type Handler = (event: { payload: QaPair[] }) => void
const listeners: Handler[] = []

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((_evt: string, cb: Handler) => {
    listeners.push(cb)
    return Promise.resolve(() => {
      const i = listeners.indexOf(cb)
      if (i >= 0) listeners.splice(i, 1)
    })
  }),
}))

const pair = (id: string): QaPair => ({
  id, user_text: 'q', segments: [], timestamp: 't',
})

describe('usePtyStream', () => {
  it('초기 pairs는 빈 배열', () => {
    const { result } = renderHook(() => usePtyStream())
    expect(result.current.pairs).toEqual([])
  })

  it('session:update 이벤트로 pairs 갱신', async () => {
    const { result } = renderHook(() => usePtyStream())
    await waitFor(() => expect(listeners.length).toBeGreaterThan(0))
    act(() => {
      listeners.forEach((cb) => cb({ payload: [pair('a'), pair('b')] }))
    })
    expect(result.current.pairs).toHaveLength(2)
  })
})
```

- [ ] **Step 2: Run test to verify it fails (shape mismatch)**

Run: `npm test -- src/hooks/usePtyStream.test.ts`
Expected: FAIL — `selectedId`/`isVisible` 등을 반환하던 기존 구현과 충돌하거나 새 형태가 없음.

- [ ] **Step 3: Update the implementation**

Replace `src/hooks/usePtyStream.ts` content with:
```ts
import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import type { QaPair } from '../types'

interface Result {
  pairs: QaPair[]
}

export function usePtyStream(): Result {
  const [pairs, setPairs] = useState<QaPair[]>([])

  useEffect(() => {
    const unlistenPromise = listen<QaPair[]>('session:update', (event) => {
      setPairs(event.payload)
    })
    return () => {
      unlistenPromise.then((fn) => fn())
    }
  }, [])

  return { pairs }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/hooks/usePtyStream.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/hooks/usePtyStream.ts src/hooks/usePtyStream.test.ts
git commit -m "$(cat <<'EOF'
refactor(hooks): simplify usePtyStream to return pairs only

선택/가시성 상태를 ExpandPane으로 위임하면서 usePtyStream은 pairs만 노출하도록 축소한다.
EOF
)"
```

---

## Task 10: Wire `App.tsx`, delete obsolete components

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/App.css`
- Delete: `src/components/TerminalPane/` (3 files)
- Delete: `src/components/MarkdownPane/` (3 files)
- Delete: `src/components/MessageList/` (2 files)

- [ ] **Step 1: Replace `src/App.tsx`**

Replace entire file content with:
```tsx
import { useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open } from '@tauri-apps/plugin-dialog'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'
import { ChatStream } from './components/ChatStream'
import { ChatComposer } from './components/ChatComposer'
import { ExpandPane } from './components/ExpandPane'
import { usePtyStream } from './hooks/usePtyStream'
import { useExpandPanel } from './hooks/useExpandPanel'
import './App.css'

function FolderPicker({ onStart }: { onStart: (path: string) => void }) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSelect = async () => {
    const selected = await open({ directory: true, multiple: false })
    if (!selected || typeof selected !== 'string') return
    setLoading(true)
    setError('')
    try {
      await invoke('start_session', { path: selected })
      onStart(selected)
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="folder-picker">
      <div className="folder-picker__card">
        <div className="folder-picker__logo">M</div>
        <h1 className="folder-picker__title">MeeCode</h1>
        <p className="folder-picker__desc">
          프로젝트 폴더를 선택하면 Claude Code가 해당 디렉토리에서 실행됩니다.
        </p>
        <button
          className="folder-picker__btn"
          onClick={handleSelect}
          disabled={loading}
        >
          {loading ? '시작 중...' : '📂 프로젝트 폴더 선택'}
        </button>
        {error && <p className="folder-picker__error">{error}</p>}
      </div>
    </div>
  )
}

function MainLayout({ projectPath }: { projectPath: string }) {
  const { pairs } = usePtyStream()
  const {
    expandedId,
    setExpandedId,
    isOpen,
    toggleOpen,
    autoExpand,
    setAutoExpand,
  } = useExpandPanel(pairs)

  const expandedPair = useMemo(
    () => pairs.find((p) => p.id === expandedId) ?? null,
    [pairs, expandedId]
  )

  const handleExpand = (id: string) => {
    setExpandedId(id)
    if (!isOpen) toggleOpen()
  }

  return (
    <div className="app">
      <div className="app__header">
        <span className="app__path">{projectPath}</span>
        <label className="app__auto-toggle">
          <input
            type="checkbox"
            checked={autoExpand}
            onChange={(e) => setAutoExpand(e.target.checked)}
          />
          긴 답변 자동 펼침
        </label>
      </div>
      <div className="app__body">
        <PanelGroup direction="horizontal">
          <Panel defaultSize={isOpen ? 60 : 100} minSize={30}>
            <div className="app__chat">
              <ChatStream pairs={pairs} expandedId={expandedId} onExpand={handleExpand} />
              <ChatComposer />
            </div>
          </Panel>
          {isOpen && (
            <>
              <PanelResizeHandle className="resize-handle" />
              <Panel defaultSize={40} minSize={20}>
                <ExpandPane pair={expandedPair} isOpen={isOpen} onToggle={toggleOpen} />
              </Panel>
            </>
          )}
        </PanelGroup>
      </div>
    </div>
  )
}

function App() {
  const [projectPath, setProjectPath] = useState<string | null>(null)
  if (!projectPath) return <FolderPicker onStart={setProjectPath} />
  return <MainLayout key={projectPath} projectPath={projectPath} />
}

export default App
```

- [ ] **Step 2: Add autoExpand toggle styles to `src/App.css`**

Append to end of existing `src/App.css`:
```css
.app__chat {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #010409;
}

.app__auto-toggle {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  color: #c9d1d9;
  font-size: 12px;
  margin-left: auto;
  cursor: pointer;
  user-select: none;
}

.app__auto-toggle input {
  cursor: pointer;
}
```

> 만약 `.app__header`에 `display: flex`가 이미 적용되어 있지 않으면, 다음도 추가:
> ```css
> .app__header { display: flex; align-items: center; gap: 12px; }
> ```
> (현 상태 확인 후 필요 시 적용. 적용 후 시각 회귀 없는지 dev에서 확인.)

- [ ] **Step 3: Delete obsolete component directories**

```bash
git rm -r src/components/TerminalPane src/components/MarkdownPane src/components/MessageList
```

Expected: 9개 파일(각 디렉토리의 index/css/test) 삭제 staged.

- [ ] **Step 4: Run full test suite**

Run: `npm test`
Expected: 모든 테스트 PASS. (삭제한 파일의 테스트가 같이 사라졌으므로 import 누락 없음 확인.)

- [ ] **Step 5: TypeScript build check**

Run: `npm run build`
Expected: tsc 통과 + vite 빌드 성공. 만약 `import` 경로 잔존 에러 발생 시 해당 파일을 찾아 수정한 후 재실행.

- [ ] **Step 6: Commit**

```bash
git add src/App.tsx src/App.css
git commit -m "$(cat <<'EOF'
feat(app): switch main UI to conversation GUI with collapsible expand panel

좌측 xterm 터미널과 우측 MarkdownPane을 폐기하고 ChatStream + ChatComposer + ExpandPane 조합으로 전환한다. 헤더에 autoExpand 토글을 노출한다.
EOF
)"
```

---

## Task 11: Manual smoke test & dev verification

**Files:** (no code change)

- [ ] **Step 1: Run dev server**

```bash
npm run tauri dev
```

- [ ] **Step 2: Verify the golden path**

체크리스트:
- [ ] FolderPicker로 프로젝트 폴더 선택 → 메인 레이아웃 진입.
- [ ] 헤더에 경로와 "긴 답변 자동 펼침" 체크박스 보임.
- [ ] 입력창에 짧은 질문 입력 → Enter → Claude Code가 jsonl에 기록 후 카드가 추가됨.
- [ ] 한글 IME로 질문 입력 → 자모 분리 없이 정상 전송.
- [ ] Shift+Enter는 줄바꿈, Enter는 전송.
- [ ] `/` 입력 시 슬래시 명령 팝오버 표시, 클릭 시 입력창에 채워짐.
- [ ] ESC/Shift+Tab/Ctrl+C 버튼이 정상 작동 (Claude Code 모드 전환 등).
- [ ] 짧은 답변(<500자)은 카드에 그대로 표시되고 텍스트 선택 시 코멘트 띄움.
- [ ] 긴 답변(>500자) 도착 시 자동으로 오른쪽 패널이 열리고 풀뷰 표시.
- [ ] 메인 카드는 "오른쪽 패널에 펼쳐짐" 안내로 대체.
- [ ] 오른쪽 패널 ▶ 버튼으로 접기 → 메인이 풀폭 회복.
- [ ] 헤더 토글 OFF → 새 긴 답변 도착 시 자동 전환 안 됨, "전체보기" 수동 클릭만 동작.
- [ ] 페이지 새로고침(앱 재시작) 후 autoExpand 설정 복원.

- [ ] **Step 3: Verify what's NOT broken**

- [ ] 기존 PTY 백엔드(start_session, write_input, session:update)가 변경 없이 동작.
- [ ] Rust 테스트 통과: `cd src-tauri && cargo test`.

- [ ] **Step 4: If any issue found**

각 이슈를 별도 task 추가하여 fix → commit. 본 plan의 후속.

---

## Self-Review (post-write)

**Spec coverage:** 
- Goals 6개 모두 task 매핑 확인.
  - "터미널 노출 제거" → Task 10
  - "메인 단일 스트림 + 가상 스크롤" → Task 7
  - "500자 폴드 + 전체보기" → Task 5 (`QaCard`), Task 2 (helpers)
  - "오른쪽 패널 펼쳐보기 + 접기/펴기" → Task 8 (`ExpandPane`), Task 10 (App 와이어링)
  - "긴 답변 자동 전환 + 옵션" → Task 3 (`useExpandPanel`), Task 10 (헤더 토글)
  - "코멘트 유지" → Task 8 (오른쪽 패널 내 `CommentFloat`), Task 5 (짧은 답변 카드 내 텍스트 선택 가능)
- Non-Goals 위반 없음.
- Spec의 폴드 미리보기 규칙(앞 3줄 또는 240자) → Task 2의 `makePreview` 테스트로 보장.
- Spec의 자동 전환 1회 트리거(`lastSeenRef`) → Task 3 테스트로 보장.

**Placeholder scan:** "TBD/TODO/fill in" 없음. Task 10 Step 2의 ".app__header가 이미 display:flex인지 확인" 가이드는 placeholder가 아니라 현장 확인 지시. 통과.

**Type/name consistency:**
- `QaPair` / `AssistantSegment`은 `src/types.ts` 기존 정의 그대로.
- `useExpandPanel` 반환 키 (`expandedId/setExpandedId/isOpen/toggleOpen/autoExpand/setAutoExpand`)가 Task 3 정의 → Task 10 소비처에서 동일.
- `QaCard` props (`pair/isExpandedInPane/onExpand`)가 Task 5 정의 → Task 7 `ChatStream`에서 동일.
- `ChatStream` props (`pairs/expandedId/onExpand`)가 Task 7 정의 → Task 10 App에서 동일.
- `ExpandPane` props (`pair/isOpen/onToggle`)가 Task 8 정의 → Task 10 App에서 동일.
- `renderMarkdown`, `SegmentView`는 Task 4의 named export → Task 5, Task 8에서 동일하게 import.

문제 없음.
