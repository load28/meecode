# meecode: Tauri → Electron 마이그레이션 플랜

> 목적: **전 플랫폼에서 VSCode와 동일한 멀티‑윈도우 아키텍처**를 얻는다 —
> `window.open` 기반 공유‑렌더러 보조 창 + 단일 Monaco/모델 레지스트리 +
> 단일 LSP 클라이언트. 그러면 "분리 창 풀 LSP"가 **추가 코드 없이** 성립하고,
> 현재의 창↔창 RPC 계층(`lsp/host·bridge·runtime·supervisor` + `protocol`의
> RPC 부분)을 **전부 삭제**할 수 있다.
>
> 결정 사항: Rust 백엔드(~6,100줄)는 **사이드카로 보존**한다(재작성 안 함).
> 빌드 툴링은 **electron-vite + electron-builder**. 이 문서는 일괄 착수 전
> 확정용 전체 플랜이다.

---

## 0. 원칙

1. **회귀 0.** 기능 동작은 동일하게 유지하며 substrate만 교체한다.
2. **추상화 seam 먼저.** 프론트에 IPC 추상층(`src/platform/ipc.ts`)을 먼저
   넣고 모든 호출처를 거기로 모은 뒤, 내부 구현만 Tauri→Electron으로 스왑한다.
   → 스왑이 국소화되어 위험이 작다.
3. **Rust 보존.** claude 프로세스/MCP/tasks/history/LSP/watch 로직은 그대로.
   `#[tauri::command]` 진입점과 `AppHandle.emit`만 stdio RPC로 개조.
4. **단계마다 검증 게이트.** 각 마일스톤 끝에서 `tsc + vitest + 수동 스모크`.

---

## 1. 타깃 런타임 토폴로지

```
┌─────────────────────────── Electron main (Node) ───────────────────────────┐
│  • BrowserWindow lifecycle / 메뉴 / dialog / single-instance / auto-update  │
│  • SidecarManager: Rust 바이너리 spawn + stdio JSON-RPC 브로커               │
│  • ipcMain 라우팅: renderer invoke → sidecar req,  sidecar event → renderer  │
└───────────▲───────────────────────────────────────────────▲────────────────┘
            │ stdio (ndjson)                                 │ ipcMain/ipcRenderer
            │                                                │ (contextBridge preload)
┌───────────┴───────────┐                      ┌─────────────┴──────────────────┐
│  Rust 사이드카         │                      │  Renderer (Chromium, 단일)      │
│  (기존 로직 그대로,    │                      │  • 단일 Monaco / 모델 레지스트리 │
│   진입점만 RPC 루프)   │                      │  • 단일 LSP 클라이언트(client.ts)│
│  • lsp 서버 spawn      │                      │  • 보조 창 = window.open(공유)   │
└────────────────────────┘                      └─────────────────────────────────┘
```

VSCode와의 대응: **renderer ↔ sidecar = renderer ↔ ext host**(유일한 RPC 축).
보조 창은 같은 renderer를 공유하므로 창↔창 축이 **존재하지 않는다**.

---

## 2. 사이드카 RPC 계약 (Rust ↔ Electron main)

### 2.1 전송
- child process `stdout/stdin`, **줄단위 JSON(ndjson)**. (대용량은 §8 백프레셔 참고)
- 메시지 3종:
  - `{"t":"req","id":<n>,"cmd":"<name>","args":<json>}`  main→rust
  - `{"t":"res","id":<n>,"ok":true,"result":<json>}` / `{"t":"res","id":<n>,"ok":false,"error":"<msg>"}`  rust→main
  - `{"t":"evt","channel":"<name>","payload":<json>}`  rust→main (단방향)

### 2.2 Rust 개조 (진입점만)
- `tauri::generate_handler![...]` (lib.rs) → **수동 디스패처** `match cmd { "read_file_text" => ..., }`.
  명령 본문 시그니처는 유지(인자 역직렬화 + 결과 직렬화만 래핑).
- `State<AppState|LspState|OpenFilesState>` → 사이드카 프로세스 전역 상태
  (이미 내부가 `Mutex`이므로 `once_cell`/`OnceLock` 싱글톤으로 보관).
- `AppHandle.emit(channel, payload)` → `emit_event(channel, payload)`(stdout ndjson).
  `app.handle()`를 인자로 받던 함수는 emit 클로저/sender를 주입받도록 변경.
- `tauri_plugin_dialog`는 사이드카에서 제거 → **dialog는 Electron main**이 담당(§4).
- 결과물: `meecode-core`(혹은 기존 크레이트의 `--rpc` 모드) 단일 바이너리.

### 2.3 명령 매핑 (전 50개, 그룹별 — 전부 사이드카 cmd로 1:1)

| 그룹 | 명령 |
|---|---|
| Claude/세션 | `start_session`, `send_user_message`, `send_tool_response`, `interrupt_session`, `set_permission_mode`, `set_model`, `set_thinking_level`, `switch_session`, `hibernate_tab`, `close_tab`, `start_session_harvest`, `cancel_session_harvest` |
| 파일 I/O | `read_file_text`, `stat_file`, `write_file`, `list_dir`, `search_files`, `create_entry`, `rename_entry`, `delete_entry`, `open_external`, `set_watched_files` |
| 워처 | `watch_project` |
| LSP | `lsp_start`, `lsp_send`, `lsp_stop` |
| Config / Claude 경로 | `get_config`, `set_config`, `discover_claude_path`, `validate_claude_path`, `set_claude_path`, `get_claude_status` |
| 히스토리/프로젝트 | `list_recent_projects`, `list_project_sessions` |
| Tasks | `list_tasks`, `create_task`, `get_task`, `update_task`, `delete_task`, `list_task_sources`, `create_source`, `delete_source`, `list_task_wiki_files`, `read_task_wiki`, `write_task_wiki`, `delete_task_wiki`, `get_organize_preview`, `start_task_organize`, `cancel_task_organize` |

`open_external` 은 Electron `shell.openExternal`로 main에서 처리하는 편이 자연스러움(사이드카 cmd로 둬도 무방 — 확정 시 결정).

---

## 3. 이벤트 채널 매핑

### 3.1 백엔드 → 렌더러 (사이드카 evt → main → ipc)
현재 Rust/프로세스가 emit하고 프론트가 `listen`하는 채널 전부를 그대로 forward:

`lsp:exit`, `lsp:message`(+ per-server `lsp:<id>`), `session:compact`,
`session:rate_limit`, `session:task_activity`, `session:tool_progress`,
`session:turn_end`, `session:exit`, `session:stderr`, `session:history`,
`session:tool_request`, `session:control_cancel`, `harvest:*`(start/assistant/
stderr/done/error/cancelled/exit), `organize:*`(start/stderr/exit/cancelled),
`project_fs:changed`, `file:external-change`, `claude_path:changed`.

- main의 SidecarManager가 `evt`를 받아 `webContents.send(channel, payload)`로
  렌더러에 전달. seam의 `on(channel, cb)`가 이를 구독.

### 3.2 렌더러 ↔ 렌더러 (detach 핸드셰이크) — **삭제 대상**
`file:ready`, `file:init`, `file:open`, `file:open-content`, `file:dock` 는
현재 두 webview 간 통신. window.open 단일‑렌더러 모델에서는 **같은 JS 컨텍스트**
이므로 이벤트가 아니라 **직접 함수 호출/공유 스토어**로 대체 → 이 채널들 제거.
(§5 참조)

---

## 4. 프론트엔드 IPC seam

신규 `src/platform/ipc.ts` (플랫폼 추상화):

```ts
export interface Platform {
  invoke<T>(cmd: string, args?: unknown): Promise<T>
  on(channel: string, cb: (payload: any) => void): () => void   // unsubscribe
  dialogOpen(opts): Promise<string | string[] | null>
  openExternal(url: string): Promise<void>
  openAuxiliaryWindow(opts): AuxiliaryWindowHandle   // §5
}
```

- **Phase 1 (Tauri 백엔드 유지):** 내부가 `@tauri-apps/api`의 `invoke`/`listen`/
  `plugin-dialog`/`webviewWindow`를 호출. 의미·동작 동일.
- **리팩터 범위:** `invoke` 호출처(~20), `listen`(~15), dialog(3),
  `webviewWindow`(5) ≈ **43곳**을 seam 경유로 변경. 중앙 1곳만 남기고 직접
  `@tauri-apps/*` import 제거.
- **Phase 3 (스왑):** seam 내부를 preload가 노출한 `window.meecode.*`로 교체.
  **호출처는 무변경** → 스왑이 1개 파일에 갇힌다.

preload(`contextBridge.exposeInMainWorld('meecode', …)`): `invoke`, `on`,
`dialogOpen`, `openExternal`만 노출. `contextIsolation:true`, `sandbox:true`,
`nodeIntegration:false` 유지(§8 보안).

---

## 5. 보조 창 (핵심 가치) — VSCode `auxiliaryWindowService` 이식

목표 기능의 본체. VSCode 소스를 그대로 매핑한다.

1. **생성:** `useDetachedFilePanel`의 `new WebviewWindow('file-panel', …)` 삭제
   → `window.open('about:blank', 'aux-editor', features)`. (Chromium이므로
   same‑origin 자식이 **같은 렌더러/힙** 공유.)
2. **컨테이너:** VSCode `createContainer()` 이식 — 부모 `<head>`의 `<link>/<style>`
   를 자식 document로 복제 + `MutationObserver`로 라이브 동기화, 루트 컨테이너
   div mount. 자식 `document.createElement` 함정 대응(부모 document 경유 생성).
3. **멀티‑윈도우 DOM 헬퍼:** `src/platform/window.ts`에 `registerWindow`/
   `getWindow(node)`/`getActiveWindow` 도입(VSCode `dom.ts` 축소판). 전역
   `document`/`window` 직접 참조 제거.
4. **Monaco 렌더:** 같은 `monaco` 모듈로 `monaco.editor.create(childContainer)`.
   ⚠️ 표준 `monaco-editor`의 자식 창 렌더 함정(이슈 #1530) 선검증 필요(§8).
5. **detach/dock 재구현:** 두 번째 webview·`file:*` 핸드셰이크 전면 삭제 →
   같은 렌더러 안에서 에디터 그룹을 보조 창 컨테이너로 **이동**(모델은 단일
   레지스트리에서 그대로 공유). dock = 컨테이너를 본 창으로 되돌림 + 보조 창 close.
6. **LSP RPC 코드 전면 삭제:** `lsp/host.ts`, `bridge.ts`, `runtime.ts`,
   `supervisor.ts`, `protocol.ts`(RPC/wake/resync 부분), `view.ts`의 멀티창
   분기. **`client.ts` 단일 클라이언트 복원**(연결+provider+문서동기화 일체형).
   `registry.ts`의 `isMainWindow`/per‑window 분기 제거. — 단일 Monaco이므로
   provider가 단일 레지스트리에 등록되어 보조 창에서도 자동 동작.

---

## 6. 빌드 / 패키징

- **electron-vite**: `renderer`(현 vite+react 설정 재사용), `main`, `preload`
  3개 entry. dev는 electron-vite의 HMR.
- **electron-builder**: mac(dmg/zip, universal), win(nsis), linux(AppImage/deb).
- **Rust 사이드카 번들:** 플랫폼별 cross‑compile → `extraResources`로 동봉.
  main이 `process.resourcesPath` 기준으로 바이너리 경로 해석.
- `index.html` 진입은 유지(`/src/main.tsx`). `tauri.conf.json`·`capabilities/`·
  `gen/` 제거(M4). `@tauri-apps/*` 의존 제거.

---

## 7. 마일스톤 (실행 순서 + 검증 게이트)

| M | 내용 | 게이트 |
|---|---|---|
| **M0** | electron-vite 셸 부팅(현 렌더러를 빈 BrowserWindow에 로드) + SidecarManager가 Rust 바이너리 spawn + `ping/pong` RPC 1왕복. Tauri 병존. | 앱이 뜨고 ping 응답. |
| **M0.5 (스파이크)** | **리스크 선검증**: `window.open` 자식 창에 Monaco 인스턴스 렌더 + 자동완성 1건 동작(LSP mock). | 자식 창에서 Monaco 보이고 입력됨. ← Go/No‑Go 분기점 |
| **M1** | `src/platform/ipc.ts` seam 도입 + **전 호출처(~43곳) 리팩터**. 내부는 아직 Tauri. | `tsc` + `vitest`(282) 통과, 수동 스모크 회귀 0. |
| **M2** | 사이드카 RPC 계약 구현: Rust 진입점 개조(디스패처+이벤트 emit) + main 브로커 + 50 cmd·전 이벤트 채널 연결. seam 내부를 `window.meecode`로 스왑. **Tauri 런타임 제거.** | 모든 기능이 Electron 경유로 동작(세션/파일/tasks/LSP/watch). |
| **M3** | 보조 창(window.open) + 단일 Monaco/LSP, **RPC 코드 삭제 + client.ts 복원**. detach/dock 재구현. | **본 목표 달성**: 보조 창에서 풀 LSP, 전 플랫폼 동일. |
| **M4** | 패키징(3 OS) + 정리(tauri 의존/설정 삭제, CI, single‑instance/auto‑update 등). | 3 OS 빌드 산출물 + 설치 스모크. |

---

## 8. 리스크 & 검증 못 한 가정

1. **Monaco 0.55 자식 창 렌더(최대 리스크).** 표준 패키지의 멀티‑윈도우 DOM
   지원 정도가 불확실(이슈 #1530). → **M0.5 스파이크로 선검증**, 막히면 Monaco
   업그레이드/패치 또는 보조 창 전략 재검토.
2. **Rust cross‑compile 사이드카** — 특히 mac universal(arm64+x64), 코드사이닝/
   notarization. 빌드 파이프라인 복잡도.
3. **stdio 백프레셔/대용량** — `search_files` 대량 결과, claude 스트림, lsp
   메시지 폭주. ndjson + 플로우 제어 또는 길이‑프리픽스 프레이밍 검토.
4. **보안(Electron)** — `contextIsolation`/`sandbox`/`nodeIntegration:false`,
   preload 최소 노출, CSP, `webSecurity`. 보조 창에도 동일 정책.
5. **앱 크기/메모리** — Chromium 번들로 ~10MB→~150MB+, RAM 증가(수용 전제).
6. **Tauri가 주던 기본기 재구현** — single‑instance, deep link, auto‑update,
   파일 연결, 트레이/메뉴, 권한 모델. 목록화하여 M4에서 처리.
7. **dialog/openExternal 이전** — `plugin-dialog`(3곳)·`open_external` → Electron
   `dialog`/`shell.openExternal`.

---

## 9. 작업량 개략 (멀티 세션)

| M | 규모 | 비고 |
|---|---|---|
| M0 + M0.5 | 소~중 | 셸 + 스파이크. 빠른 Go/No‑Go. |
| M1 seam | 중 | 기계적이지만 ~43곳 + 테스트. |
| M2 사이드카 | **대** | Rust 진입점 개조 + main 브로커 + 50 cmd + 이벤트. 본 마이그레이션의 무게중심. |
| M3 보조창/LSP | 중 | 가치 핵심. RPC 코드 삭제로 순감소. |
| M4 패키징/정리 | 중~대 | 3 OS·서명·재구현 목록. |

---

## 확정 필요 항목 (착수 전 체크)

- [ ] 사이드카 프레이밍: ndjson vs Content‑Length(길이 프리픽스). (기본: ndjson)
- [ ] `open_external`/dialog: Electron main vs 사이드카. (기본: Electron main)
- [ ] 패키징 타깃 OS/포맷 확정(mac universal 포함?).
- [ ] auto‑update 채널 사용 여부(M4 범위).
- [ ] M0.5 스파이크 결과에 따른 Monaco 버전 정책.
