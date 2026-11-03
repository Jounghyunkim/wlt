# WLT — 제출 옵션 / 테스트 정보 (Partner Center 붙여넣기용)

## 제한된 기능: runFullTrust 사용 이유

```text
WLT is a Win32 desktop terminal application (Rust + Tauri, WebView2 UI) packaged as MSIX with the Windows.FullTrustApplication entry point. It cannot work inside the AppContainer sandbox, so runFullTrust is required for its core features:

1. Local shells: WLT starts PowerShell, Command Prompt, WSL and Git Bash as child processes through the Windows Pseudo Console (ConPTY, CreatePseudoConsole) and relays their input/output. This is the app's primary function.
2. SSH / SFTP client: WLT opens outbound TCP connections to SSH servers that the user enters, and for port forwarding (-L / -D) listens on a local port (127.0.0.1 by default) chosen by the user.
3. File explorer, editor and search: users browse, open, edit, upload/download and search files in any folder they choose on their PC, including files dragged in from File Explorer.
4. Saved passwords: if the user chooses to save an SSH password or key passphrase, it is stored with the Windows Credential Manager API (CredWriteW / CredReadW) under entries named "WLT/ssh/...".

WLT does not install drivers or services, does not request elevation, does not run in the background after it is closed, and does not modify other applications or system settings. It does not collect telemetry or send data anywhere other than the SSH servers the user connects to.
```

## 추가 테스트 정보 (인증 참고 사항)

```text
WLT is a terminal emulator for Windows (local shells + SSH/SFTP client).

ACCOUNTS
- No account, sign-in, or subscription is required. All features are available immediately.

USER INTERFACE LANGUAGE
- The UI is currently in Korean only.

HOW TO TEST WITHOUT A SERVER
1. Launch WLT. Click the "로컬 터미널" (Local terminal) button on the start screen,
   or press Ctrl+Shift+T, to open a PowerShell tab.
2. Press Ctrl+Shift+\ to split the view, or drag a tab to the edge of the window.
3. Press Ctrl+Shift+E (File Explorer) to browse local files.
   Double-click a text file to open it in the built-in editor.
4. Press Ctrl+Shift+G to search text in all files of a folder.
5. Click the gear icon at the bottom left (Settings) to change theme and font.

HOW TO TEST SSH (optional)
- SSH, SFTP and port forwarding require an SSH server supplied by the user.
  Click "새 SSH 세션" (New SSH session) on the start screen, enter host / port / user name,
  save, then double-click the session in the sidebar to connect.

DEPENDENCIES
- Microsoft Edge WebView2 Runtime (preinstalled on Windows 10/11).
- No drivers, NT services, or background services are installed.
- Optional: WSL and Git Bash are detected and listed only if already installed.

NETWORK / DATA
- The app connects only to SSH servers the user enters. No telemetry, analytics,
  ads, or accounts. Passwords are stored only in Windows Credential Manager if the user chooses.

RESTRICTED CAPABILITY
- runFullTrust: see the justification provided in Submission options.
```
