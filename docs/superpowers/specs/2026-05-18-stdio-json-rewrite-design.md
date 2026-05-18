# MeeCode stdio JSON Rewrite — Design Spec

- **Date**: 2026-05-18
- **Author**: minyeoung
- **Status**: Approved (brainstorming complete, pending implementation plan)
- **Supersedes**: parts of `2026-05-18-conversation-gui-design.md` (PTY-based stream)

---

## 1. Background & Problem

현재 MeeCode는 `claude` CLI를 PTY로 spawn하고 `~/.claude/projects/<path>/*.jsonl`을 watch해 대화를 추출하는 구조다. 이 구조에서 누적된 문제:

- jsonl은 **세션 히스토리**만 담고, **tool approval prompt**(y/n, plan 승인 등)는 PTY 화면에만 나타나 GUI에서 인지·응답 불가 → 작업 진행 멈춤.
- PTY 우회로 인한 부수 작업이 계속 누적: 한글 IME composition 차단, Shift+Tab `\x1b[Z` 시퀀스 전송, 가상 스크롤 카드 측정, 모드 mirror, ANSI escape 처리 등.
- 모드(default/plan/auto-accept) 상태를 정확히 알 수 없어 frontend가 추측(mirror)함.

VS Code 공식 Claude Code 확장의 unpacked VSIX 분석 결과, **stream-json stdio protocol**이 정공 해결책임이 확인됨:

```bash
claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio
```

stdio JSON으로 전환하면 위 문제 대부분이 구조적으로 사라진다.

## 2. Goals

- PTY 기반 코드를 완전히 폐기하고 stdio JSON stream을 단일 채널로 사용한다.
- Tool approval 요청(`tool_permission_request`)을 받아 대화 흐름에 인라인 카드로 표시하고 사용자의 허용/거부를 stdin JSON으로 응답한다.
- 모드 상태를 mirror가 아닌 stream의 실제 이벤트로부터 받아 UI에 반영한다.
- 앱 시작 시 가장 최근 jsonl을 history로 한 번 읽고, 동일 세션을 `--resume`으로 이어 진행한다.
- 한글 IME / ANSI escape / 가상 스크롤 카드 측정 / 키 시퀀스 전송 같은 PTY 우회 작업을 제거한다.
- 기존 마크다운 렌더링, 코멘트, ExpandPane(펼쳐보기), autoExpand 옵션은 그대로 유지한다.

## 3. Non-Goals

- 멀티 세션 전환 UI / 사이드바 (post-MVP).
- Tool input의 인라인 편집(MVP는 read-only 입력 요약 + 허용/거부만).
- `--permission-prompt-tool stdio` 외의 도구 정책 커스터마이즈.
- claude CLI 자체 설치/업데이트 보조.
- 새 디자인 시스템 도입(기존 색·간격 유지).

## 4. Inputs & Decisions Captured From Brainstorming

| 결정 항목 | 선택 |
|---|---|
| PTY 코드 처리 | 완전 폐기 (clean rewrite) |
| Tool approval UI 위치 | 대화 흐름에 인라인 카드 |
| 기존 jsonl 처리 | 가장 최근 파일을 history로 읽고 `--resume`으로 이어 진행 |
| 책임 분리 | Backend-heavy (Rust가 protocol 캡슐화, frontend는 도메인 이벤트만) |

## 5. Architecture

```
┌─ Frontend (React + TypeScript)
│  ├─ App
│  │   ├─ FolderPicker (변경 없음)
│  │   └─ MainLayout
│  │       ├─ Header (프로젝트 경로, 모드 인디케이터, autoExpand 토글, 패널 재오픈)
│  │       └─ PanelGroup
│  │           ├─ ChatPane
│  │           │   ├─ ChatStream
│  │           │   │   ├─ QaCard × N (기존)
│  │           │   │   └─ ToolApprovalCard (신규, 인라인)
│  │           │   └─ ChatComposer (재작성: stdin JSON 전송)
│  │           └─ ExpandPane (기존)
│  └─ hooks/
│      ├─ useClaudeSession  (신규)
│      └─ useExpandPanel    (기존)
│
└─ Backend (Rust + Tauri)
   ├─ commands/
   │   ├─ start_session(path)
   │   ├─ send_user_message(text)
   │   ├─ send_tool_response(req_id, allow, edited?)
   │   └─ send_control(action)
   ├─ claude_process/
   │   ├─ spawn.rs        (claude CLI 실행, stdio 연결)
   │   ├─ stdout_parser.rs (line-delimited JSON → 도메인 이벤트)
   │   ├─ stdin_writer.rs (도메인 명령 → JSON line)
   │   └─ protocol.rs     (stream-json schema 타입)
   └─ history/
       └─ load_recent.rs   (가장 최근 jsonl 파싱)
```

### 5.1 Boundary

- **Rust `claude_process`**: stream-json schema 디테일이 갇혀 있는 유일한 곳. 위로는 깔끔한 도메인 이벤트만 emit.
- **Frontend `useClaudeSession`**: 도메인 이벤트를 받아 `pairs`, `pendingTool`, `mode`, `error`로 reduce.
- **변경 없음**: `useSelection`, `CommentFloat`, `ExpandPane`, `MessageBubble`, `useExpandPanel`, `QaCard`(props 약간), `FolderPicker`, `segmentHelpers`.
- **삭제**: PTY 관련 Rust 파일(`pty.rs`가 있다면), `session_watcher.rs`, frontend `usePtyStream`, ChatComposer의 모드 mirror·`\r`·`\x1b[Z` 시퀀스 로직.

### 5.2 Tauri IPC 계약

| 방향 | 이름 | 페이로드 |
|---|---|---|
| FE→BE command | `start_session` | `{ path: string }` |
| FE→BE command | `send_user_message` | `{ text: string }` |
| FE→BE command | `send_tool_response` | `{ request_id: string, allow: boolean, edited?: any }` |
| FE→BE command | `send_control` | `{ action: 'cycle_mode' \| 'interrupt' \| 'esc' }` |
| BE→FE event | `session:history` | `QaPair[]` (앱 시작 시 1회) |
| BE→FE event | `session:message` | 새 페어 또는 마지막 페어 segment append |
| BE→FE event | `session:tool_request` | `{ request_id, tool_name, input, summary }` |
| BE→FE event | `session:mode_change` | `{ mode: 'default' \| 'plan' \| 'auto-accept' }` |
| BE→FE event | `session:error` | `{ message }` |

## 6. Data Flow

### 6.1 앱 시작

1. FolderPicker에서 폴더 선택
2. FE → `invoke('start_session', { path })`
3. Rust:
   - `history::load_recent(path)` → `QaPair[]`
   - `emit("session:history", QaPair[])`
   - `claude_process::spawn(path)` — 같은 session_id를 `--resume`으로 전달
   - stdout reader task + stdin writer task 시작
4. FE `useClaudeSession`: history 수신 → `pairs` 초기화 → 즉시 렌더

### 6.2 사용자 메시지 전송

1. ChatComposer Enter
2. FE → `invoke('send_user_message', { text })`
3. Rust: stdin channel에 `StdinMessage::User { content }` 보냄
4. stdin_writer: JSON serialize + `\n` + stdin write + flush
5. claude CLI 처리 → stdout으로 응답 라인 streaming
6. stdout_parser: 각 라인을 `StreamMessage`로 parse → 도메인 이벤트 emit
7. FE: 마지막 페어에 segment append 또는 새 페어 push → ChatStream re-render

### 6.3 Tool approval (핵심)

1. Claude가 도구 호출 시도
2. stdout_parser: `StreamMessage::ToolPermissionRequest` 수신
3. `emit("session:tool_request", payload)`
4. FE: `pendingTool = payload`
5. ChatStream: 마지막 카드 아래 `ToolApprovalCard` 인라인 렌더
6. 사용자 "허용" 클릭
7. FE → `invoke('send_tool_response', { request_id, allow: true })`
8. Rust: stdin으로 `ToolPermissionResponse` 보냄
9. claude 도구 실행 → 결과 streaming → 새 segment 추가
10. FE: `pendingTool = null`

### 6.4 모드 변경

1. Shift+Tab 키 또는 버튼
2. FE → `invoke('send_control', { action: 'cycle_mode' })`
3. Rust: stream-json에 mode change 명령이 있으면 그것으로, 없으면 stdin에 `\x1b[Z` raw write (fallback)
4. claude → `StreamMessage::ModeChange { mode }` emit
5. stdout_parser → `emit("session:mode_change", ...)`
6. FE: 인디케이터가 실제 mode 반영 (mirror 아님)

> **구현 첫 task**에서 stream-json에 mode change 명령이 있는지 확정. 없으면 fallback 사용 + 추후 mode_change 이벤트가 정확하게 들어오는지 확인.

### 6.5 종료 / 재시작

- App unmount 또는 projectPath 변경 시: Rust 측 child process kill, stdin channel close
- 새 `start_session` 호출 시 새 process spawn

## 7. Component Details

### 7.1 Backend

#### `claude_process/protocol.rs`

stream-json 메시지 schema. **첫 implementation task는 실제 `claude --output-format stream-json` 출력 캡쳐로 schema 확정**. 예상 형태:

```rust
#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StreamMessage {
    User { message: UserMessage },
    Assistant { message: AssistantMessage },
    ToolPermissionRequest { request_id: String, tool_name: String, input: Value },
    ModeChange { mode: String },
    SessionStart { session_id: String },
    Error { message: String },
    // 그 외 capture로 발견되는 variant 추가
}

#[derive(Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum StdinMessage {
    User { content: String },
    ToolPermissionResponse { request_id: String, behavior: PermissionBehavior },
    Control { action: String },
}
```

#### `claude_process/spawn.rs`

- `tokio::process::Command`로 spawn:
  ```
  claude --output-format stream-json --input-format stream-json --permission-prompt-tool stdio [--resume <session_id>]
  ```
- stdin/stdout 핸들 저장, stderr는 로그로 redirect
- 두 task: stdout reader (line loop) + stdin writer (channel consumer)

#### `claude_process/stdout_parser.rs`

- `BufReader::lines()` line-by-line
- 각 라인 → `serde_json::from_str::<StreamMessage>`
- enum variant에 따라 `AppHandle::emit` (도메인 이벤트)
- parse 실패 line은 warn 로그 + 무시 (Claude 업데이트로 새 variant 등장 시 graceful degradation)

#### `claude_process/stdin_writer.rs`

- `tokio::sync::mpsc::Receiver<StdinMessage>` 수신
- serialize + `\n` 추가 + child.stdin write + flush
- broken pipe 시 error event emit

#### `history/load_recent.rs`

- 기존 `session_watcher.rs::extract_qa_pairs` jsonl 파서 재사용 (watcher 부분 제외)
- mtime 최신 jsonl 한 번만 읽음
- 빈 디렉토리는 빈 배열

#### `commands.rs`

- `start_session`: load_recent → emit history → spawn
- `send_user_message`/`send_tool_response`/`send_control`: stdin channel에 `StdinMessage` 보냄

### 7.2 Frontend

#### `hooks/useClaudeSession.ts` (신규)

```ts
interface SessionState {
  pairs: QaPair[]
  pendingTool: ToolRequest | null
  mode: 'default' | 'plan' | 'auto-accept'
  error: string | null
}

interface UseClaudeSessionReturn extends SessionState {
  sendUserMessage: (text: string) => Promise<void>
  respondTool: (requestId: string, allow: boolean, edited?: unknown) => Promise<void>
  cycleMode: () => Promise<void>
  interrupt: () => Promise<void>
  sendEsc: () => Promise<void>
}
```

Reducer 규칙:
- `session:history` → `pairs` set, `mode` 초기값 default
- `session:message` → 마지막 페어 id가 같으면 segment append, 아니면 새 페어 push
- 같은 페어 id가 history에 이미 있으면 라이브 메시지 중복 방지(필요 시 set으로 추적)
- `session:tool_request` → `pendingTool` set
- `session:mode_change` → `mode` set
- `session:error` → `error` set

#### `components/ToolApprovalCard/`

```ts
interface Props {
  request: ToolRequest
  onRespond: (allow: boolean, edited?: unknown) => void
}
```

- 도구 이름 + 입력 요약(`tool_name`별로 알맞게 — Bash는 command, Edit/Read/Write는 file_path, Bash 같은 위험 도구는 강조)
- "허용" / "거부" 버튼
- 기본 focus는 카드 본문(허용에 즉시 focus되지 않도록 — 실수 방지)
- 키보드 접근 가능

#### `components/ChatComposer/index.tsx` (재작성)

- `\r` 안 붙임. JSON message로 전송
- 키 시퀀스(`\x1b[Z` 등) 안 보냄. 대신 `send_control` invoke
- 모드 인디케이터는 prop으로 받은 실제 mode 표시
- Shift+Tab 키/버튼 → `cycleMode()`
- ESC 키/버튼 → `sendEsc()`
- Ctrl+C 버튼 → `interrupt()`
- 슬래시 명령은 일단 user_message로 보냄
- IME composition 처리 그대로
- pendingTool 있으면 textarea disabled + placeholder 변경

#### `components/ChatStream/index.tsx` (작은 변경)

- `pendingTool` prop 추가
- 카드 map 끝에 `pendingTool && <ToolApprovalCard ...>` 추가
- 진행 인디케이터(`마지막 segment 휴리스틱`) 유지

#### `App.tsx` (작은 변경)

- `usePtyStream` 제거 → `useClaudeSession` 사용
- ChatStream/ChatComposer에 새 prop/handler 전달
- 모드 인디케이터를 `useClaudeSession.mode`로 표시

### 7.3 변경 없음 (보존)

`useSelection`, `CommentFloat`, `MessageBubble`, `ExpandPane`, `useExpandPanel`, `QaCard`(props 약간), `FolderPicker`, `segmentHelpers`.

## 8. Error Handling & Edge Cases

- **claude 바이너리 없음**: spawn 실패 → `session:error` emit + dismissible 배너 표시 ("claude CLI를 찾을 수 없습니다").
- **프로세스 도중 종료**: stdout_parser EOF → `session:error` + ChatComposer 비활성화 + 재시작 버튼.
- **stdin write 실패** (broken pipe): invoke reject → ChatComposer 에러 표시 + 텍스트 보존.
- **알 수 없는 JSON 메시지 타입**: warn 로그 + 무시.
- **JSON parse 실패**: 무시 + raw 라인 디버그 로그.
- **중복 request_id의 tool_request**: 두 번째가 첫 번째 덮어씀.
- **pendingTool 동안 사용자 입력 시도**: textarea disabled로 방지.
- **사용자가 응답 후 claude가 ack 안 함**: pendingTool 비우고 응답 대기 인디케이터 전환.
- **history pair와 라이브 메시지 중복**: 같은 id 페어는 무시 (resume 시 라이브는 새 turn부터지만 안전장치).
- **history가 빈 새 프로젝트**: 빈 배열 emit, claude는 새 session_id 시작.
- **stream-json에 mode change 명령이 없는 경우**: stdin raw `\x1b[Z` fallback. 첫 task에서 확정.
- **streaming 중 사용자가 cycle_mode**: claude가 무시할 수 있음 — mode_change 이벤트 받기 전까지 인디케이터 안 바꿈.
- **A11y**: Tool approval 버튼 키보드 접근, 기본 focus는 본문.
- **보안**: stdin은 신뢰. 마크다운 렌더는 기존 `DOMPurify.sanitize` 유지.

## 9. Testing Strategy

Vitest + RTL (frontend), `cargo test` (backend).

### Rust

1. **`protocol.rs` schema 단위**: capture된 stream-json fixture 라인을 `serde_json::from_str`로 파싱 → 기대 enum variant 확인.
2. **`stdout_parser` 통합**: `Cursor`로 fixture 라인 시퀀스 주입 → emit된 이벤트 시퀀스 검증.
3. **`stdin_writer` 직렬화**: 각 `StdinMessage` variant의 JSON 직렬화 결과 확인.
4. **`history::load_recent`**: temp 디렉토리에 fixture jsonl + mtime 조작 → 최신 파일 선택. 빈 디렉토리 = 빈 배열.

> **첫 task의 산출물**: `src-tauri/tests/fixtures/stream-json/*.jsonl` — 실제 capture한 라인 시퀀스. 모든 protocol 테스트의 ground truth.

### Frontend

5. **`useClaudeSession` reducer**:
   - history 수신 → pairs 초기화
   - 라이브 message append/push
   - 같은 id 중복 무시
   - tool_request/mode_change/error 반영
6. **`ToolApprovalCard`**: name/summary 렌더, 허용/거부 버튼 콜백, focus 위치.
7. **`ChatComposer` (재작성)**:
   - Enter → `send_user_message` (no `\r`)
   - Shift+Tab → `send_control({ action: 'cycle_mode' })`
   - ESC → `send_control({ action: 'esc' })`
   - Ctrl+C → `send_control({ action: 'interrupt' })`
   - 모드 인디케이터는 prop 그대로 표시
   - pendingTool 있으면 textarea disabled
   - IME 안전성
   - invoke 실패 시 에러 + 텍스트 보존
8. **`ChatStream`**: pendingTool 있을 때 ToolApprovalCard 렌더, 진행 인디케이터 유지.

### 제거되거나 갱신
- `usePtyStream.test.ts` 삭제
- `session_watcher.rs` 테스트 → `history::load_recent` 모듈로 이전
- ChatComposer 기존 테스트 거의 다 재작성

### 수동 smoke test
- 짧은 질문 → 응답
- 한글 IME 자모 분리 없음
- 파일 Edit 요청 → ToolApprovalCard → 허용 후 결과
- Plan mode 진입 → 인디케이터 즉시 갱신
- 앱 재시작 → history 복원 + 이어서 진행
- `/help` 등 슬래시 명령 동작

## 10. Dependencies

- `tokio` (이미 Tauri에 포함)
- 추가 npm 의존성 없음
- 기존 `@tanstack/react-virtual`, `framer-motion`은 현재 미사용 — 별도 cleanup task에서 제거 가능(본 spec 범위 밖)

## 11. Open Questions / Implementation-time Decisions

- **stream-json 정확한 schema**: 첫 task에서 capture로 확정.
- **mode change 송신 명령**: stream-json에 native 명령이 있는지 첫 task에서 확정. 없으면 stdin raw `\x1b[Z` fallback.
- **session_id 발견 방법**: spawn 직후 stdout에서 `SessionStart`/`SessionResume` 같은 메시지가 오는지 capture로 확인. 새 세션 vs resume 분기에 사용.
- **/clear 같은 슬래시 명령이 user_message로 들어가도 동작하는지**: smoke test에서 확인. 안 되면 별도 control action 추가.

이 spec은 implementation 첫 task에서 capture된 fixture로 보완됩니다.
