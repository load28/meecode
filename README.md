<div align="center">

<img src="./src-tauri/icons/icon.png" alt="MeeCode" height="120" />

# MeeCode

Claude Code CLI를 위한 데스크탑 GUI — 더 잘 읽고, 더 잘 따라가고, 그대로 강력하게.

- 질문별 카드 + 좌·우 분할 패널로 대화 흐름을 한눈에
- 스트리밍 도중에도 즉시 렌더되는 라이브 마크다운
- 클릭하면 열리는 파일 경로 & 분리형 코드 패널
- 실행 전 미리 보여주는 도구 승인 카드
- 핀으로 모은 답변을 프로젝트 위키로 자동 정리

### [시작하기 →](#시작하기)

<p>
  <a href="https://github.com/load28/meecode/stargazers"><img src="https://img.shields.io/github/stars/load28/meecode?style=social" alt="GitHub stars" /></a>
  <img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="License: MIT" />
  <img src="https://img.shields.io/badge/built%20with-Tauri%202.x-24C8DB.svg" alt="Built with Tauri" />
  <img src="https://img.shields.io/badge/platform-macOS%20%7C%20Windows%20%7C%20Linux-lightgrey.svg" alt="Platforms" />
</p>

</div>

https://github.com/user-attachments/assets/102fe670-c632-43e6-b480-204dfb8180f8

## MeeCode란?

긴 답변과 연쇄적인 도구 호출이 터미널을 빠르게 흘러가면, 지금 어디까지 진행됐는지·방금 수정된 파일이 어디였는지 따라가기 어렵습니다. MeeCode는 그 흐름을 카드와 패널로 정리해 보여주는 화면입니다.

내부에서는 Claude Code CLI를 그대로 실행합니다. 모델 호출, 에이전트 루프, 세션·권한 모델, 슬래시 커맨드, 스킬 — 전부 CLI의 것입니다. MeeCode는 그 출력을 더 읽기 좋게 보여줄 뿐, 별도의 AI도 새로운 워크플로우도 아닙니다.

## 주요 기능

### 질답 카드 + 분할 패널
왼쪽에는 질문별 카드 목록, 오른쪽에는 선택한 답변 전체. 카드를 클릭하면 오른쪽에 펼쳐지고, 긴 답변은 접고 펼칠 수 있습니다.

### 라이브 마크다운
응답이 도착하는 동안 코드블록·표·인용·헤더가 바로 보기 좋게 렌더됩니다. 답변이 끝난 뒤 화면이 다시 그려지지 않습니다.

### Claude가 무엇을 하고 있는지
진행 인디케이터가 thinking·도구 호출·Hook·subagent 활동을 한자리에서 보여줍니다. ESC로 중단하면 해당 카드에 "중단됨"으로 표시됩니다.

### 클릭 가능한 파일 경로
파일을 다루는 도구 호출의 경로는 클릭할 수 있는 링크입니다. 클릭하면 코드 패널에서 해당 파일이 열리고, 패널은 별도 창으로 분리할 수 있습니다.

### 도구 승인 카드
Claude가 명령을 실행하기 전, 무엇을 어떤 인자로 실행할지 카드로 보여줍니다. 그 자리에서 허용·거부하거나, 인자를 수정해서 보낼 수 있습니다.

### 자동 따라가기 스크롤
스트리밍이 길어지면 자동으로 맨 아래를 따라가고, 위로 올려 이전 내용을 읽을 땐 멈춥니다.

### 핀 & 위키 정리
의미 있는 답변은 핀으로 모아두고, 모인 핀을 프로젝트 위키 마크다운으로 묶어 줍니다. 세션을 닫아도 정리된 내용은 프로젝트 폴더에 남습니다.

### Claude CLI 자동 탐색
첫 실행 시 Claude CLI를 자동으로 찾습니다. 못 찾으면 설정에서 경로를 직접 지정할 수 있습니다.

## 시작하기

### 필요한 것

- Node.js 18+
- Rust toolchain (Tauri 2.x 빌드용)
- Claude Code CLI

### 개발

```bash
npm install
npm run tauri dev
```

### 빌드

```bash
npm run tauri build
```

빌드된 앱은 `src-tauri/target/release/bundle/` 아래에 있습니다.

### 테스트

```bash
npm run test
```

## 기술 스택

- **Tauri 2.x** — Rust 백엔드 + 웹뷰 프론트엔드
- **React 18 + TypeScript** — UI 레이어
- **marked + DOMPurify + Prism** — 마크다운/코드 하이라이트
- **react-resizable-panels** — 좌/우 패널 분할

Claude Code CLI는 자식 프로세스로 실행하고, 그 출력을 화면에 맞춰 보여줍니다.

## 라이센스

MIT.
