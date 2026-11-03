# WLT Terminal 개인정보처리방침

시행일: 2026년 11월 4일
제공자: JohnnyStudio

JohnnyStudio(이하 "개발자")는 WLT Terminal(이하 "앱")을 사용하는 분의 개인정보를 소중히 여깁니다. 이 방침은 앱이 어떤 정보를 다루고, 어디에 저장하며, 어떻게 보호하는지 설명합니다.

## 1. 수집하는 개인정보

**개발자는 사용자의 개인정보를 수집하지 않습니다.**

- 앱에는 회원 가입이나 로그인 기능이 없습니다.
- 앱은 사용 통계, 분석(애널리틱스), 오류 보고, 광고, 추적 기능을 포함하지 않습니다.
- 앱은 개발자가 운영하는 서버나 제3자 서버로 어떤 정보도 전송하지 않습니다.

## 2. 사용자의 PC에만 저장되는 정보

앱의 기능을 제공하기 위해 아래 정보가 **사용자의 PC에만** 저장됩니다. 이 정보는 개발자에게 전달되지 않습니다.

| 정보 | 용도 | 저장 위치 |
| --- | --- | --- |
| SSH 세션 정보(세션 이름, 호스트 주소, 포트, 사용자 이름, 개인 키 파일 경로, 포트 포워딩 설정) | 저장된 서버에 다시 접속 | 앱 데이터 폴더 |
| SSH 비밀번호, 개인 키 암호 (사용자가 저장을 선택한 경우) | 자동 로그인 | Windows 자격 증명 관리자 (항목 이름 `WLT/ssh/...`) |
| 서버 호스트 키 (known_hosts) | 접속하는 서버가 바뀌지 않았는지 확인 | 앱 데이터 폴더 |
| 앱 설정 (테마, 글꼴, 기본 셸 등) | 사용자 환경 유지 | 앱 데이터 폴더 |
| 세션 히스토리 (열려 있던 탭, 작업 폴더, 터미널 화면 내용) | 다음 실행 때 이전 작업으로 복귀 | 앱 데이터 폴더 |
| 세션 로그 (사용자가 로그 저장을 켠 경우에만) | 터미널 입출력 기록 | 사용자가 지정한 폴더 (기본값: `문서\WLT Logs`) |
| 서버 파일 편집용 임시 사본 | 서버 파일을 로컬에서 편집 | Windows 임시 폴더 |

세션 히스토리와 세션 로그에는 터미널에 표시되거나 입력한 내용이 들어갈 수 있습니다. 민감한 정보를 다루는 경우 로그 저장을 끄거나 히스토리 항목을 삭제해 주세요.

## 3. 네트워크 통신

앱은 **사용자가 직접 접속을 요청한 서버**와만 통신합니다.

- SSH 접속, SFTP 파일 전송, 포트 포워딩은 사용자가 지정한 서버와 직접 연결되며, 개발자의 서버를 거치지 않습니다.
- 이 통신은 SSH 프로토콜로 암호화됩니다.
- 접속한 서버가 정보를 어떻게 처리하는지는 해당 서버 운영자의 정책을 따릅니다.

앱 안에서 실행하는 다른 프로그램(예: 터미널에서 실행하는 명령어)은 각 프로그램의 개인정보처리방침을 따릅니다.

## 4. 제3자 제공 및 처리 위탁

개발자는 사용자의 정보를 수집하지 않으므로, 제3자에게 제공하거나 처리를 위탁하는 정보가 없습니다.

## 5. 정보의 보관 및 삭제

모든 정보는 사용자의 PC에 있으며 사용자가 직접 관리합니다.

- 저장된 세션, 세션 히스토리는 앱 안에서 삭제할 수 있습니다.
- 저장된 비밀번호는 앱에서 세션을 삭제하거나, Windows 제어판의 **자격 증명 관리자**에서 `WLT/ssh/`로 시작하는 항목을 삭제하면 지워집니다.
- 앱을 제거하고 앱 데이터 폴더와 로그 폴더를 삭제하면 모든 정보가 지워집니다.

## 6. 정보 보호

- 비밀번호와 키 암호는 앱의 설정 파일에 저장하지 않고 Windows 자격 증명 관리자에 저장합니다. 저장된 비밀번호는 화면에 다시 표시되지 않습니다.
- 처음 접속하는 서버의 호스트 키를 기록해 두고, 이후 키가 바뀌면 접속 전에 경고합니다.

## 7. 아동의 개인정보

앱은 아동을 대상으로 하지 않으며, 아동을 포함한 누구의 개인정보도 수집하지 않습니다.

## 8. 방침의 변경

이 방침이 바뀌면 이 페이지에 변경 내용과 새 시행일을 게시합니다.

## 9. 문의

개인정보와 관련한 문의는 아래로 연락해 주세요.

- 제공자: JohnnyStudio
- 이메일: gadians2001@gmail.com

---

# WLT Terminal Privacy Policy

Effective date: November 4, 2026
Publisher: JohnnyStudio

## 1. Information we collect

**JohnnyStudio does not collect any personal information.**

- The app has no account sign-up or sign-in.
- The app contains no usage statistics, analytics, crash reporting, advertising, or tracking.
- The app does not send any information to servers operated by JohnnyStudio or any third party.

## 2. Information stored only on your PC

To provide its features, the app stores the following **only on your PC**. None of it is sent to JohnnyStudio.

| Information | Purpose | Location |
| --- | --- | --- |
| SSH session details (name, host, port, user name, private key file path, port forwarding settings) | Reconnect to saved servers | App data folder |
| SSH passwords and key passphrases (only if you choose to save them) | Automatic sign-in | Windows Credential Manager (entries named `WLT/ssh/...`) |
| Server host keys (known_hosts) | Verify the server has not changed | App data folder |
| App settings (theme, font, default shell, etc.) | Keep your preferences | App data folder |
| Session history (open tabs, working folders, terminal screen contents) | Restore your previous work on next launch | App data folder |
| Session logs (only if you turn logging on) | Record terminal input/output | Folder you choose (default: `Documents\WLT Logs`) |
| Temporary copies of remote files being edited | Edit server files locally | Windows temp folder |

Session history and logs may contain whatever was shown or typed in the terminal. If you work with sensitive information, turn logging off or delete history entries.

## 3. Network communication

The app communicates **only with servers you choose to connect to**.

- SSH, SFTP file transfer, and port forwarding connect directly to the server you specify and never pass through JohnnyStudio's servers.
- This traffic is encrypted by the SSH protocol.
- How a server handles your information is governed by that server operator's policies.

Programs you run inside the app (for example, commands you run in the terminal) are governed by their own privacy policies.

## 4. Sharing with third parties

Because we collect no information, we do not share or entrust any information to third parties.

## 5. Retention and deletion

All information stays on your PC under your control.

- Saved sessions and session history can be deleted inside the app.
- Saved passwords are removed when you delete the session in the app, or by deleting entries starting with `WLT/ssh/` in Windows **Credential Manager**.
- Uninstalling the app and deleting the app data and log folders removes all information.

## 6. Security

- Passwords and key passphrases are stored in Windows Credential Manager, not in the app's settings files, and are never displayed again.
- The app records each server's host key on first connection and warns you before connecting if the key changes.

## 7. Children's privacy

The app is not directed at children and does not collect personal information from anyone, including children.

## 8. Changes to this policy

If this policy changes, we will post the updated policy with a new effective date on this page.

## 9. Contact

- Publisher: JohnnyStudio
- Email: gadians2001@gmail.com
