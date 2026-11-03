# WLT Terminal 사용 가이드

WLT Terminal은 Windows용 터미널 프로그램입니다. 내 PC의 셸(PowerShell, cmd, WSL, Git Bash)과 원격 Linux 서버(SSH)를 탭과 분할 화면으로 함께 쓸 수 있고, 서버 파일 탐색기와 포트 포워딩까지 한 창에서 처리합니다.

## 목차

| 문서 | 이런 내용을 다룹니다 |
| --- | --- |
| [1. 시작하기](getting-started.md) | 설치, 화면 구성, 첫 로컬 터미널, 첫 SSH 접속 |
| [2. SSH 세션과 인증](ssh-sessions.md) | 세션 관리, 비밀번호 안전 저장(자격 증명 관리자), 개인 키, SSH 에이전트 |
| [3. 포트 포워딩](port-forwarding.md) | L / R / D 포워딩을 언제, 어떻게 쓰는지 예시로 설명 |
| [4. 탭과 화면 분할](tabs-and-splits.md) | 탭 메뉴, 화면 분할, 텍스트 복사, 탭 잠금·이름 변경, 글꼴 확대 |
| [5. 파일 탐색기](file-explorer.md) | 파일 관리, 업로드·다운로드, 끌어다 놓기, 서버 파일 편집(자동 업로드) |
| [6. 설정과 세션 로그](settings-and-logs.md) | 테마, 글꼴, 사이드바 위치, 입출력 로그 저장 |
| [7. 단축키](shortcuts.md) | 키보드·마우스 동작 한눈에 보기 |
| [8. 문제 해결](troubleshooting.md) | 자주 겪는 문제와 해결 방법 |
| [9. 세션 히스토리](session-history.md) | 앱 종료 때 열려 있던 탭으로 돌아가기, 작업 폴더 복귀, 탐색기 동기화 |

## 처음이라면

1. [시작하기](getting-started.md)에서 설치하고 첫 SSH 서버에 접속해 보세요.
2. 비밀번호를 매번 입력하기 번거롭다면 [비밀번호 안전 저장](ssh-sessions.md#비밀번호-저장-windows-자격-증명-관리자)을 켜세요.
3. WLT를 다시 켰을 때 지난번 작업하던 탭과 폴더로 돌아가려면 [세션 히스토리](session-history.md)를 여세요.
4. 서버 파일을 다뤄야 한다면 [파일 탐색기](file-explorer.md)를, 서버 너머의 DB·웹에 접속해야 한다면 [포트 포워딩](port-forwarding.md)을 보세요.
