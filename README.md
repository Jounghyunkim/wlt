# WLT Terminal

작성자: **JohnnyStudio**

Windows x64용 경량 터미널 (PuTTY 대체). 로컬 셸(PowerShell / cmd / WSL / Git Bash)과 원격 Linux 서버(SSH)를 탭과 분할 화면으로 함께 쓰고, 서버 파일 탐색기와 포트 포워딩까지 한 창에서 처리합니다.

## 📖 사용 가이드

**→ [docs/README.md](docs/README.md)** 에 주제별 사용 가이드가 있습니다.

| 가이드 | 내용 |
| --- | --- |
| [1. 시작하기](docs/getting-started.md) | 설치, 화면 구성, 첫 로컬 터미널, 첫 SSH 접속 |
| [2. SSH 세션과 인증](docs/ssh-sessions.md) | 세션 관리, 비밀번호 안전 저장(Windows 자격 증명 관리자), 개인 키, SSH 에이전트 |
| [3. 포트 포워딩](docs/port-forwarding.md) | L / R / D 포워딩을 언제, 어떻게 쓰는지 예시로 설명 |
| [4. 탭과 화면 분할](docs/tabs-and-splits.md) | 탭 메뉴, 화면 분할, 텍스트 복사, 탭 잠금·이름 변경, 글꼴 확대 |
| [5. 파일 탐색기](docs/file-explorer.md) | 파일 관리, 업로드·다운로드, 끌어다 놓기, 서버 파일 편집(자동 업로드) |
| [6. 설정과 세션 로그](docs/settings-and-logs.md) | 테마, 글꼴, 사이드바 위치, 입출력 로그 저장 |
| [7. 단축키](docs/shortcuts.md) | 키보드·마우스 동작 한눈에 보기 |
| [8. 문제 해결](docs/troubleshooting.md) | 자주 겪는 문제와 해결 방법 |
| [9. 세션 히스토리](docs/session-history.md) | 앱 종료 때 열려 있던 탭으로 돌아가기, 작업 폴더 복귀, 탐색기 동기화 |
| [10. 편집기](docs/editor.md) | 탐색기에서 파일 더블클릭 → VS Code와 같은 편집기로 로컬·서버 파일 편집 |

## 주요 기능

- **터미널**: 로컬 셸 자동 감지, SSH(비밀번호 · 개인 키 · SSH 에이전트), WebGL 렌더링, 한글·합자 지원, 검색, PuTTY식 우클릭 복사/붙여넣기
- **탭 · 화면 분할 (VS Code 방식)**: 탭을 끌어 상하좌우 분할, 연결을 유지한 채 창 사이 이동, 탭 복제·잠금·이름 변경, 전체 텍스트 복사, 탭별 글꼴 확대(`Ctrl`+스크롤)
- **작업 표시줄 · 파일 탐색기**: 로컬 PC / 서버(SFTP) 파일 관리, 업로드·다운로드, Windows 탐색기에서 끌어다 놓기, 서버 파일을 로컬 앱으로 편집하면 저장 시 자동 업로드
- **세션 히스토리**: 앱을 종료할 때 열려 있던 탭을 기록해 두고, 다음에 클릭하면 같은 셸·서버에 다시 연결해 마지막 폴더로 이동 + 이전 화면 표시 + 탐색기 동기화 (셸 통합으로 현재 폴더 추적). 옵션으로 직접 닫은 탭도 저장하고 30분간 살려 두어 그대로 이어서 작업
- **편집기**: 탐색기에서 파일을 더블클릭하면 Monaco(VS Code 편집기) 탭으로 열어 로컬·서버 파일을 직접 편집·저장 (문법 강조 80여 개 언어, 찾기·바꾸기, 멀티 커서, UTF-8/EUC-KR 인코딩 유지, 다른 프로그램의 변경 감지)
- **보안**: 비밀번호·키 암호를 Windows 자격 증명 관리자에 저장(화면으로는 다시 전달하지 않음), 서버 키 확인(TOFU)
- **포트 포워딩**: 로컬(-L), 원격(-R), 동적 SOCKS5(-D)
- **설정 · 로그**: 테마 6종(밝은 테마 포함), 글꼴 14종, 사이드바 왼쪽/오른쪽, 패널별 입출력 로그 저장

---

## 개발자 정보

- **Frontend**: Tauri 2 + React 19 + TypeScript + Vite, Tailwind CSS v4 + shadcn/ui (Radix), Zustand
- **Terminal**: xterm.js 6 + fit / webgl / search / ligatures 애드온
- **Backend (Rust)**: `portable-pty` (Windows ConPTY), `russh` (순수 Rust SSH — ed25519·RSA·ECDSA 키, OpenSSH 신형 키 형식, 에이전트·포트 포워딩), `russh-sftp`, `tauri-plugin-dialog`

### 아키텍처

```text
┌──────────────── WebView2 (React) ────────────────┐        ┌──────────── Rust (Tauri) ────────────┐
│ <Terminal/> xterm.js                             │ invoke │ commands.rs                          │
│   onData ──► write_terminal(id, data) ───────────┼───────►│   TerminalManager (id → backend)     │
│   onResize ─► resize_terminal(id, cols, rows) ───┼───────►│     ├─ local.rs  portable-pty/ConPTY │
│                                                  │  emit  │     └─ ssh.rs    russh channel       │
│   term.write ◄── "terminal-output-<id>" ◄────────┼────────┤   utf8.rs  (멀티바이트 경계 보정)      │
│   status     ◄── "terminal-exit-<id>"   ◄────────┼────────┤                                      │
│                                                  │        │                                      │
│ <ExplorerView/> ── fs_* commands ────────────────┼───────►│ files.rs  로컬 디스크 / SFTP 통합 API  │
│                 ◄── "fs-transfer" / "fs-edit" ───┼────────┤           (SSH 연결 위의 sftp 채널)   │
└──────────────────────────────────────────────────┘        └──────────────────────────────────────┘
```

- 프론트엔드가 세션 id를 만들고 **이벤트 리스너를 먼저 등록한 뒤** `open_*_terminal`을 호출하므로 첫 출력이 유실되지 않습니다.
- 재연결 때마다 id(`<tabId>-<generation>`)가 바뀌어 이전 세션의 늦은 이벤트가 새 세션에 섞이지 않습니다.
- 키 입력은 한 번에 하나의 `invoke`만 진행되도록 묶어서 보내므로 빠른 타이핑/붙여넣기에서도 순서가 보장됩니다.
- Windows ConPTY는 자식 프로세스가 종료돼도 출력 파이프가 열려 있으므로, 종료 감시 스레드가 PTY를 닫아 리더 스레드를 깨웁니다.
- **SFTP**는 터미널 탭의 SSH 연결(`Arc<Handle>`) 위에 `sftp` 서브시스템 채널을 처음 사용할 때 열어 재사용합니다. 연결이 끝나면 SFTP 세션, 원격 편집 감시, 포트 포워딩 리스너도 함께 정리됩니다.
- **비밀번호**는 프론트엔드에서 Credential Manager에 쓰기만 하고(`credential_set`), 읽기는 접속 시 Rust(`credentials::read_secret`)에서만 합니다.

#### 분할 화면

- `tabStore`는 탭을 **그룹**(탭 줄 하나를 가진 창)으로 묶고, 그룹 배치는 **이진 분할 트리**(`row`/`column` + 비율)로 표현합니다.
- 터미널은 분할 트리 안에서 그리지 않습니다. 탭 id로 key를 준 **하나의 평면 레이어**에 모두 두고, 각 그룹 본문의 측정된 위치에 절대 좌표로 겹쳐 그립니다(`Workspace.tsx`). 그래서 탭이 다른 그룹으로 옮겨져도 다시 마운트되지 않고 PTY/SSH 세션이 유지됩니다.

#### 드래그 앤 드롭

- 앱 안의 드래그(탭, 탐색기 항목)는 **포인터 이벤트**로 구현했습니다(`lib/dnd.tsx`). Windows에서 탐색기 파일 드롭의 실제 경로를 받으려면 Tauri의 네이티브 드롭을 켜야 하는데, 이때 HTML5 드래그 이벤트가 동작하지 않기 때문입니다.
- 드롭 대상은 `data-drop="<type>"` 속성을 가진 요소이며, 타입별 핸들러(`registerDrop`)가 처리합니다. OS 파일 드롭(`onDragDropEvent`)도 같은 경로로 처리됩니다.

### 프로젝트 구조

```text
WLT/
├─ docs/                        # 사용 가이드
├─ src/                         # React 프론트엔드
│  ├─ components/
│  │  ├─ Terminal.tsx           # xterm.js 래퍼 (IPC, 자동 맞춤, 검색, 복사/붙여넣기, 탭별 확대, 로그 시작)
│  │  ├─ explorer/              # ExplorerView(트리·메뉴·키보드·드롭), TransferList(전송·편집 중), fileIcon
│  │  ├─ history/               # HistoryView (세션 히스토리)
│  │  ├─ editor/                # EditorPane (Monaco 편집기 탭)
│  │  ├─ layout/
│  │  │  ├─ MainLayout.tsx      # 전체 레이아웃, 전역 단축키, OS 파일 드롭, 시작 화면
│  │  │  ├─ ActivityBar.tsx     # 작업 표시줄 (터미널 / 탐색기 / 설정)
│  │  │  ├─ Sidebar.tsx         # 사이드바 컨테이너, 터미널 뷰, 너비 조절
│  │  │  ├─ Workspace.tsx       # 분할 화면, 터미널 레이어, 드롭 영역, 경계선
│  │  │  ├─ TabBar.tsx          # 그룹별 탭 줄, 탭 드래그, 우클릭 메뉴, 이름 변경
│  │  │  └─ *Dialog.tsx         # 세션(인증·포워딩) · 비밀번호 · 설정 다이얼로그
│  │  └─ ui/                    # shadcn/ui 컴포넌트
│  ├─ store/                    # Zustand: tabStore, sessionStore·settingsStore·historyStore(영속), explorerStore
│  └─ lib/                      # backend.ts · fs.ts(IPC 래퍼), dnd.tsx, cwd.ts(셸 통합), monaco.ts(언어 서비스를 뺀 Monaco), themes.ts, terminalRegistry.ts
├─ src-tauri/
│  ├─ src/
│  │  ├─ lib.rs, commands.rs, state.rs, utf8.rs
│  │  ├─ local.rs               # 로컬 셸 (ConPTY) + 셸 통합 (OSC 9;9 현재 폴더 보고)
│  │  ├─ ssh.rs                 # SSH 접속·인증(비밀번호/키/에이전트)
│  │  ├─ forward.rs             # 포트 포워딩 (L/R/D SOCKS5)
│  │  ├─ files.rs               # 탐색기: 로컬/SFTP, 전송, 휴지통 삭제, 원격 편집 자동 업로드
│  │  ├─ credentials.rs         # Windows 자격 증명 관리자
│  │  ├─ history.rs             # 세션 히스토리 화면 기록 파일
│  │  └─ logger.rs              # 세션 로그
│  ├─ build.rs                  # 테스트 실행 파일에도 Windows 매니페스트 리소스 링크
│  ├─ tauri.conf.json
│  └─ capabilities/default.json
└─ build-env.sh                 # VS Build Tools 없이 GNU 툴체인으로 빌드할 때 사용
```

### 사전 준비

| 항목 | 설치 |
| --- | --- |
| Node.js 20+ | `winget install OpenJS.NodeJS.LTS` |
| Rust | `winget install Rustlang.Rustup` |
| C/C++ 빌드 도구 (A 또는 B) | 아래 참고 |
| WebView2 런타임 | Windows 10/11에 기본 포함 |

- **A. MSVC (권장)**: `winget install Microsoft.VisualStudio.2022.BuildTools` 후 "C++를 사용한 데스크톱 개발" 워크로드 설치 (관리자 권한 필요)
- **B. GNU (관리자 권한 불필요)**: `winget install MartinStorsjo.LLVM-MinGW.MSVCRT` 후 `rustup toolchain install stable-x86_64-pc-windows-gnu`

### 실행 / 빌드 / 테스트

```bash
npm install

# A. MSVC (VS Build Tools 설치된 경우)
npm run tauri dev          # 개발 모드 (HMR)
npm run tauri build        # 릴리스 빌드

# B. GNU 툴체인 (Git Bash에서)
source ./build-env.sh
npm run tauri dev
npm run tauri build

# Rust 단위 테스트
cd src-tauri && cargo test --lib
```

결과물:

- 실행 파일: `src-tauri/target/release/wlt.exe` (같은 폴더의 `WebView2Loader.dll` 필요)
- 설치 파일: `src-tauri/target/release/bundle/nsis/WLT_0.1.0_x64-setup.exe`

> WLT가 실행 중이면 `wlt.exe`·`WebView2Loader.dll`을 덮어쓸 수 없어 빌드가 `os error 5/32`로 실패합니다. 창을 닫고 빌드하거나, 실행 중인 파일의 이름을 바꾼 뒤(예: `wlt.old.exe`) 빌드하세요. Windows는 실행 중인 파일의 이름 변경은 허용합니다.

### 처음부터 만들 때의 초기화 명령 (참고)

```bash
npm create tauri-app@latest wlt -- --template react-ts
cd wlt
npm i @xterm/xterm @xterm/addon-fit @xterm/addon-webgl @xterm/addon-search @xterm/addon-ligatures zustand @tauri-apps/plugin-dialog
npm i -D tailwindcss @tailwindcss/vite
npx shadcn@latest init                       # components.json 생성
npx shadcn@latest add button input label dialog select scroll-area tooltip context-menu
cd src-tauri && cargo add portable-pty russh russh-sftp tauri-plugin-dialog chrono tokio
```

### 알려진 제한

- 원격 파일 자동 업로드는 저장 시 서버 파일을 그대로 덮어씁니다. 그사이 서버에서 다른 사람이 같은 파일을 고쳤는지는 확인하지 않습니다.
- 분할 배치와 탭 잠금은 저장되지 않습니다. 열려 있던 탭은 종료할 때 세션 히스토리에 기록됩니다.
- 세션 히스토리의 "다시 연결" 복귀는 새 셸이므로 실행 중이던 프로그램·셸 변수는 돌아오지 않습니다("직접 닫은 탭도 저장" 옵션의 보관 시간 안에서만 완전 복귀).
- 제어 문자를 제거한 출력 로그는 화면 내용을 근사한 것입니다. `vim`, `top`처럼 화면 전체를 다시 그리는 프로그램의 출력은 순서가 섞여 보일 수 있습니다.
- 합자(ligatures)는 브라우저 환경 제약으로 애드온의 기본 합자 세트(`=>`, `!=`, `->` 등)로 동작합니다.
- 포트 포워딩의 듣는 주소는 화면에서 바꿀 수 없습니다(L·D는 `127.0.0.1`, R은 서버의 `localhost`). SOCKS5는 인증 없는 CONNECT만 지원합니다.
