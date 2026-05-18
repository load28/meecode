# Conversation GUI Redesign — Design Spec

- **Date**: 2026-05-18
- **Author**: minyeoung
- **Status**: Approved (brainstorming complete, pending implementation plan)

---

## 1. Background & Problem

현재 MeeCode는 좌측에 xterm.js 기반 `TerminalPane`을 그대로 노출하고, 우측 `MarkdownPane`에 jsonl에서 추출한 `QaPair[]`를 보여주는 좌우 분할 구조다. 그러나 터미널 영역이 정상적으로 렌더링되지 않는 문제가 있고, 터미널과 마크다운 패널이 동일한 내용을 중복으로 보여주어 GUI 일관성이 떨어진다.

목표는 터미널 화면 노출을 폐기하고 jsonl 데이터를 단일 진실 원천(SSOT)으로 삼아 ChatGPT/opcode 스타일의 대화형 GUI로 통일하는 것이다. 동시에 답변 길이에 따라 가독성과 탐색성을 유지하기 위한 폴드(접기)·전용 펼쳐보기 패널을 도입한다.

## 2. Goals

- 터미널 노출을 완전히 제거하고, jsonl 파싱 결과만으로 모든 대화 UI를 구성한다.
- 메인 영역을 시간순 단일 스트림으로 구성하고 가상 스크롤로 긴 세션을 안정적으로 지원한다.
- 답변(QaPair) 전체 텍스트가 500자 이하면 인라인으로 모두 보여주고, 초과 시 미리보기 + "전체보기" 버튼으로 폴드한다.
- "전체보기" 클릭 또는 길이 임계 초과 시 우측 패널에 단일 답변을 펼쳐 보여주며, 패널은 접고 펼 수 있다.
- 긴 답변 도착 시 자동으로 우측 패널이 펼쳐지는 것을 기본값으로 하되, 사용자가 옵션으로 끌 수 있다.
- 코멘트(텍스트 선택 → PTY 입력) 기능을 유지한다.

## 3. Non-Goals

- 새로운 백엔드 기능(예: 세션 검색, 다중 세션 관리)은 도입하지 않는다.
- Rust 측 `session_watcher.rs` / PTY 명령 인터페이스는 변경하지 않는다.
- 옵티미스틱 사용자 메시지 echo는 도입하지 않는다 (jsonl 도착 후 표시).
- 슬래시 명령의 전체 인텔리센스(파라미터 자동완성)는 범위 밖. 명령 이름 팝오버까지만.

## 4. Inputs & Decisions Captured From Brainstorming

| 결정 항목 | 선택 |
|---|---|
| 입력 수단 | 전용 입력창(chat-style) |
| 컨트롤 키 (ESC, /commands, Shift+Tab 등) | 입력창 내 키매핑 + 전용 버튼 |
| 우측 패널 콘텐츠 | 단일 답변 펼쳐보기 전용 |
| 메인 레이아웃 | 시간순 단일 스트림 (ChatGPT/opcode 스타일) |
| 폴드 단위 | QaPair 전체 텍스트 합산 (text/plan kind 합) |
| 코멘트 동작 범위 | 메인은 짧은 답변에서, 긴 답변 코멘트는 우측 패널에서 |
| 구현 접근 | Approach B (opcode 정합: 가상 스크롤 + framer-motion) |

## 5. Architecture

```
┌─ App
│  ├─ FolderPicker (변경 없음)
│  └─ MainLayout
│     ├─ Header  ── 프로젝트 경로, autoExpand 토글
│     └─ PanelGroup (react-resizable-panels)
│        ├─ Panel: ChatPane (메인)
│        │   ├─ ChatStream          ← 가상 스크롤(@tanstack/react-virtual)
│        │   │   └─ QaCard × N      ← QaPair 단위, AnimatePresence
│        │   │       ├─ QuestionBlock
│        │   │       └─ AnswerBlock (segments + 폴드)
│        │   └─ ChatComposer        ← 하단 입력창, 키맵핑, 전용 버튼, 슬래시 힌트
│        └─ Panel: ExpandPane  (collapsible, defaultCollapsed)
│            └─ QaDetail             ← 선택된 단일 QaPair 풀뷰 + 코멘트
└─ Tauri 백엔드 (변경 없음): start_session / write_input / pty:data / session:update
```

### 5.1 Component Boundaries

- `ChatStream` — `QaPair[]`만 받고 가상 스크롤 + 자동 스크롤 정책 담당. "어떤 카드가 펼쳐졌는지"는 모른다.
- `QaCard` — 한 페어를 렌더. 자체 길이 계산 후 폴드 여부 결정. tool_use는 폴드 무관 inline details.
- `ChatComposer` — PTY 입력 전담. IME 안전 처리, 특수 키매핑, 전용 버튼.
- `ExpandPane` — 펼쳐보기 전담. `selectedPairId`만 받음. 코멘트 활성.
- `MessageBubble`(공유 모듈) — `renderMarkdown`, `SegmentView` 등을 한곳에 모아 카드/패널 양쪽이 재사용.

### 5.2 Deleted / Retained

- **삭제**: `TerminalPane`, `MarkdownPane`, `MessageList`, 해당 CSS/테스트 일부.
- **유지**: `CommentFloat`, `useSelection`, `usePtyStream`(반환 형태 일부 변경), `session_watcher.rs` 전체.
- **PTY**: Rust 측 PTY는 그대로 운용. 프론트는 `pty:data` 구독을 끊고 `write_input`만 사용.

### 5.3 New Hooks

- `useExpandPanel(pairs)`
  - 반환: `{ expandedId, setExpandedId, isOpen, toggleOpen, autoExpand, setAutoExpand }`
  - `autoExpand` 영속화 키: `localStorage["meecode.autoExpand"]`, 기본 `true`.
  - 새 `QaPair` 도착 + `autoExpand && totalChars(newest) > 500` → `expandedId = newest.id`, `isOpen = true`.
  - `lastSeenRef`로 같은 페어 중복 트리거 방지.

## 6. Data Flow

```
[Claude Code 프로세스 (PTY)]
        │ (output)
        ▼
~/.claude/projects/<dash-path>/*.jsonl  ── file watcher
        │
        ▼
session_watcher.rs  ──  emit("session:update", QaPair[])
        │
        ▼
usePtyStream → pairs: QaPair[]
        │
        ├──────────────────────────────┐
        ▼                              ▼
   ChatStream                    useExpandPanel
   ├ QaCard (폴드 판정)              ├ expandedId
   │   └ "전체보기" 클릭 ──onExpand──▶│ autoExpand 옵션 검사
   └ 새 QaPair 감지                   │ (새 QaPair, >500자 시 자동 ON)
                                       ▼
                                  ExpandPane
                                  └ QaDetail (풀뷰 + 코멘트)


[ChatComposer]  ──── invoke("write_input", "...\r") ────▶ PTY ──▶ Claude
                ▲                                                  │
                │ (jsonl 업데이트)                                  │
                └───────── session:update event ◀──────────────────┘
```

### 6.1 User Input Lifecycle

1. ChatComposer textarea에 한글 IME 입력 → composition 종료 후 `value` 확정.
2. Enter (or Cmd/Ctrl+Enter) → `invoke('write_input', { text: value + '\r' })`.
3. textarea 초기화. 메인 스트림에는 즉시 echo 하지 않음.
4. jsonl 업데이트 → `session:update` → `pairs` 갱신 → 마지막 카드는 `segments.length === 0`이면 "응답 대기 중…" placeholder.

### 6.2 Auto-Expand Logic

```ts
useEffect(() => {
  if (!autoExpand) return
  const newest = pairs[pairs.length - 1]
  if (!newest || newest.id === lastSeenRef.current) return
  lastSeenRef.current = newest.id
  if (totalTextChars(newest.segments) > 500) {
    setExpandedId(newest.id)
    setOpen(true)
  }
}, [pairs, autoExpand])
```

### 6.3 Main ↔ Panel Sync

- `pair.id === expandedId && isOpen`인 카드 = 메인에서 본문을 반투명 처리 + "오른쪽 패널에 펼쳐짐" 안내로 대체. 카드 클릭 시 `expandedId`를 비우거나 패널을 토글.

## 7. Component Details

### 7.1 `ChatStream`

```ts
interface Props {
  pairs: QaPair[]
  expandedId: string | null
  onExpand: (id: string) => void
}
```

- `useVirtualizer({ count, estimateSize: () => 140, overscan: 6 })`.
- 자동 스크롤: 바닥 ±50px 내에 있으면 새 페어 도착 시 bottom 고정. 위로 스크롤 시 잠금, 다시 바닥 도달 시 해제.
- 빈 상태: "프로젝트가 시작되었습니다. 아래에서 첫 질문을 입력하세요".

### 7.2 `QaCard`

```ts
interface Props {
  pair: QaPair
  isExpandedInPane: boolean
  onExpand: () => void
}
```

- `totalChars = sum(segment.text.length for kind in ['text','plan'])` 계산.
- `totalChars <= 500` → 전체 inline 렌더. 코멘트 활성.
- `totalChars > 500` → 폴드 모드: text/plan 합산 문자열에서 미리보기 + 그라데이션 페이드 + `[ 전체보기 →]` 버튼. 미리보기는 **앞 3줄 또는 240자 중 먼저 도달하는 쪽**까지 자르고 말줄임표를 붙인다. tool_use는 항상 inline `<details>`. 폴드 모드에서는 텍스트 선택 비활성.

### 7.3 `ChatComposer`

```ts
interface Props { disabled?: boolean }
```

- `<textarea>` 자동 높이. Enter / Cmd·Ctrl+Enter 전송. Shift+Enter 줄바꿈.
- IME 처리: `compositionstart/end` + `inputType === 'insertCompositionText'` 차단. Enter 직전 composition 종료 검사.
- 전송: `value + '\r'`을 `invoke('write_input', { text })`.
- 전용 버튼 4개:
  - `ESC` → `\x1b`
  - `Shift+Tab` → `\x1b[Z`
  - `Ctrl+C` → `\x03`
  - `/명령` → 슬래시 명령 팝오버. 현재 채우기까지만, 전송은 사용자 확인 후.
- `/`로 시작 입력 시 자동완성 팝오버 자동 표시 (`/help /clear /model …`).

### 7.4 `ExpandPane`

```ts
interface Props {
  pair: QaPair | null
  isOpen: boolean
  onToggle: () => void
}
```

- `pair === null` 시 placeholder: "메인에서 '전체보기'를 눌러 답변을 펼쳐보세요".
- 헤더: ◀ 토글, 질문 시각 / 첫 줄 요약, "코멘트 모드 ON" 인디케이터.
- 본문: 모든 segments 폴드 없이 풀 렌더. `marked` + `highlight.js` 재사용.
- 본문 컨테이너에 `useSelection` + `CommentFloat` 마운트.

### 7.5 `MessageBubble` (shared)

- `renderMarkdown(src)` — `marked.parse` + `DOMPurify.sanitize` (현재 코드 이전).
- `SegmentView({ segment })` — text / plan / tool_use 분기. plan 라벨 `📋 Plan`, tool_use는 `<details>` 요약.

## 8. Error Handling & Edge Cases

- `invoke('write_input')` reject → 입력창 하단 빨간 1줄 에러, textarea 값 보존, 재시도 사용자에게 위임.
- Composition 중 Enter → 차단(`isComposing || keyCode === 229`).
- `segments.length === 0` 페어 → "응답 대기 중…" placeholder.
- tool_use만 있는 페어 → `totalChars = 0` → 폴드 안 됨, tool_use details만 보임.
- `user_text === ''` → 백엔드에서 skip되므로 프론트에서 별도 처리 불필요.
- 같은 페어가 segments 누적으로 여러 번 갱신 → `lastSeenRef`로 ID당 자동 전환 1회만.
- autoExpand OFF 전환 시 이미 열린 패널은 그대로. 수동 닫기는 ◀ 버튼.
- 가상 스크롤 측정: `measureElement`로 실제 높이 측정. 마크다운 렌더 후 `requestAnimationFrame`에서 `virtualizer.measure()` 1회 호출.
- 프로젝트 경로 전환 대비: `<MainLayout key={projectPath} />`로 hook 상태 리셋.
- A11y: "전체보기" 버튼 `aria-label`, 패널 토글 `aria-expanded` / `aria-controls`. 폴드된 텍스트는 미리보기 분량만 DOM에 들어가 스크린리더가 잘린 내용을 읽지 않도록 함.

## 9. Testing Strategy

Vitest + React Testing Library. TDD 순서:

1. `totalChars(segments)` 헬퍼 단위 테스트 — text/plan만 합산, tool_use 제외, 한글 char count.
2. `useExpandPanel` — autoExpand on/off, 중복 트리거 방지, 짧은 답변 무전환, 긴 답변 전환.
3. `QaCard` 렌더 — `<=500`이면 전체 + 버튼 부재, `>500`이면 미리보기 + 버튼 존재, 버튼 클릭 시 `onExpand(pair.id)` 호출.
4. `ChatComposer` — Enter 시 `write_input` + `\r`, Shift+Enter 줄바꿈, ESC/Shift+Tab/Ctrl+C 버튼 시퀀스, IME composition Enter 무시, `/` 입력 시 팝오버.
5. `ChatStream` 통합 — pairs 증가 시 카드 추가, 바닥 근처 auto-scroll, 위쪽 스크롤 중 잠금.
6. `ExpandPane` 통합 — pair null placeholder, 토글 클릭 시 `onToggle`, 본문 텍스트 선택 시 `CommentFloat` 표시.
7. Rust: `session_watcher.rs` 변경 없음 → 기존 테스트 통과 확인.

제거되는 테스트: `MarkdownPane.test.tsx`. `usePtyStream.test.ts`는 반환 형태 변경에 따라 일부 케이스 갱신.

## 10. Dependencies

- `@tanstack/react-virtual` — 가상 스크롤
- `framer-motion` — 메시지 등장/사라짐 애니메이션

기존 의존성(`marked`, `dompurify`, `highlight.js`, `react-resizable-panels`, `@tauri-apps/api`)으로 나머지는 충족.

## 11. Open Questions / Future Work

- 가상 스크롤 도입 후에도 코드 블록이 큰 답변에서 초기 측정 점프가 거슬리면, 마크다운 렌더 완료를 감지하는 별도 옵저버(MutationObserver) 도입 고려.
- 슬래시 명령 파라미터 자동완성 (예: `/model <name>`) — 후속 작업.
- 세션 사이드바(다중 세션 전환) — 후속 작업. 본 디자인 범위 밖.
