# MeeCode — Design Spec

**Date:** 2026-05-18  
**Stack:** Tauri 2 + Rust + React + TypeScript

---

## Overview

MeeCode는 Claude Code CLI를 실행하는 터미널 위에 마크다운 렌더링 패널과 인라인 코멘트 기능을 얹은 macOS 데스크탑 앱이다. 긴 응답은 자동으로 오른쪽 패널에 HTML로 렌더링되고, 특정 텍스트를 선택하면 해당 구절에 대한 질문을 Claude Code로 직접 보낼 수 있다.

---

## Layout

좌우 분할(Split View) 구조. 분할 비율은 드래그로 조절 가능.

```
┌─────────────────────┬─────────────────────┐
│                     │                     │
│   Terminal (xterm)  │  Markdown Panel     │
│                     │  (React / HTML)     │
│   $ claude          │                     │
│   ▌                 │  # 제목             │
│                     │  렌더링된 내용...   │
│                     │                     │
└─────────────────────┴─────────────────────┘
```

마크다운 패널은 응답 길이가 임계값(기본 500자)을 초과하면 자동으로 활성화된다. 임계값은 설정 파일로 커스텀할 수 있다.

---

## Architecture

### Backend (Rust / Tauri)

**`pty_manager.rs`**  
`portable-pty` 크레이트로 PTY를 생성하고 `claude` CLI 프로세스를 자식 프로세스로 실행한다. stdout을 실시간으로 읽어 두 곳으로 팬아웃한다:

1. `pty:data` Tauri 이벤트 → 프론트엔드 xterm.js (터미널 렌더링)
2. 현재 응답의 버퍼 누적 → 임계값 초과 시 `md:update` Tauri 이벤트 → 마크다운 패널 (응답이 끝나면 버퍼 리셋, 다음 응답부터 다시 측정)

**`commands.rs`**  
Tauri IPC 커맨드:
- `start_session` — PTY 세션 시작, claude 실행
- `write_input(text: String)` — PTY stdin에 텍스트 쓰기
- `get_config` / `set_config` — 설정 읽기/쓰기

**`config.rs`**  
설정 구조체. `~/.config/meecode/config.json`에 영속화.

```rust
struct Config {
    markdown_threshold: usize, // 기본값: 500
}
```

### Frontend (React + TypeScript)

**`TerminalPane`**  
xterm.js를 래핑하는 컴포넌트. `pty:data` 이벤트를 구독해 터미널에 출력한다. 키 입력은 `write_input` 커맨드로 PTY stdin에 전달한다.

**`MarkdownPane`**  
`md:update` 이벤트를 받아 마크다운을 HTML로 렌더링한다(`marked` + `highlight.js`). 텍스트 셀렉션 이벤트를 감지해 `CommentFloat`를 활성화한다.

**`CommentFloat`**  
선택된 텍스트 위치에 플로팅 버튼을 렌더링한다. 버튼 클릭 시 버튼이 사라지고 같은 위치에 플로팅 인풋창이 나타난다. 제출 시 `[선택: "..."] 질문` 포맷으로 문자열을 조립해 `write_input`을 호출한다.

**Hooks**
- `usePtyStream` — Tauri 이벤트 구독, 버퍼 상태 관리
- `useSelection` — `mouseup` 이벤트로 셀렉션 범위와 위치 추적

---

## Data Flow

```
claude CLI
  └→ PTY stdout
       └→ Rust 인터셉트
            ├→ Tauri event "pty:data"  → xterm.js (터미널 표시)
            └→ 버퍼 누적
                 └→ 임계값 초과
                      └→ Tauri event "md:update" → 마크다운 패널 렌더
                           └→ 사용자 텍스트 셀렉션
                                └→ 플로팅 버튼 표시
                                     └→ 클릭 → 플로팅 인풋창
                                          └→ 제출
                                               └→ "[선택: "..."] 질문" 포맷
                                                    └→ write_input → PTY stdin → claude
```

---

## Comment Feature Detail

1. 사용자가 마크다운 패널에서 텍스트를 드래그 선택
2. 선택 영역 근처에 **"💬 코멘트"** 플로팅 버튼 표시
3. 버튼 클릭 → 버튼 사라지고 같은 위치에 플로팅 인풋창 등장
4. 사용자가 질문 입력 후 제출(Enter 또는 버튼)
5. `[선택: "{선택된_텍스트}"] {질문}` 형식으로 조합
6. `write_input` 커맨드로 PTY stdin에 직접 주입

---

## Configuration

`~/.config/meecode/config.json`:

```json
{
  "markdown_threshold": 500
}
```

---

## Key Dependencies

| 역할 | 라이브러리 |
|------|-----------|
| PTY 관리 | `portable-pty` (Rust) |
| claude 경로 | `PATH` 탐색 (기본), config에서 오버라이드 가능 |
| 터미널 렌더 | `xterm.js` |
| 마크다운 파싱 | `marked` |
| 코드 하이라이트 | `highlight.js` |
| UI 프레임워크 | React + TypeScript |
| 데스크탑 프레임워크 | Tauri 2 |

---

## Out of Scope

- Claude Code 설정 관리 UI
- 대화 히스토리 저장/검색
- 멀티 세션 탭
- Windows/Linux 지원 (1차는 macOS만)
