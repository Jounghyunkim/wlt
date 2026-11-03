import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { Mail, SquareTerminal } from "lucide-react";
import { JohnnyLogo } from "@/components/Brand";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { isDesktop } from "@/lib/backend";

const FEATURES: [string, string][] = [
  ["터미널", "PowerShell · cmd · WSL · Git Bash, SSH (비밀번호 · 키 · 에이전트)"],
  ["화면", "VS Code처럼 탭을 끌어 화면 분할, 탭별 테마 · 글꼴 크기"],
  ["파일", "로컬 · 서버(SFTP) 탐색기, 업로드 · 다운로드, 내장 편집기"],
  ["연결", "포트 포워딩 (로컬 · 원격 · SOCKS5)"],
  ["기록", "세션 히스토리, 입출력 로그"],
  ["보안", "비밀번호는 Windows 자격 증명 관리자에 저장"],
];

const CONTACT = "gadians2001@gmail.com";

/** "About" popup for WLT and JohnnyStudio, opened from Johnny in the activity bar. */
export function AboutDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const [version, setVersion] = useState("0.1.0");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open && isDesktop) getVersion().then(setVersion, () => {});
    if (!open) setCopied(false);
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader className="items-center text-center sm:text-center">
          <SquareTerminal className="text-primary size-10" strokeWidth={1.5} />
          <DialogTitle className="text-lg">WLT Terminal</DialogTitle>
          <DialogDescription>버전 {version} · Windows x64</DialogDescription>
        </DialogHeader>

        <p className="text-sm leading-relaxed">
          <b>WLT</b>는 Windows에서 내 PC의 셸과 원격 Linux 서버를 한 창에서 다루는 경량 터미널입니다. PuTTY처럼 가볍게,
          VS Code처럼 편리하게 쓰는 것을 목표로 만들었습니다.
        </p>

        <dl className="bg-muted/50 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 rounded-md px-3 py-2.5 text-xs">
          {FEATURES.map(([k, v]) => (
            <div key={k} className="contents">
              <dt className="text-muted-foreground font-medium">{k}</dt>
              <dd>{v}</dd>
            </div>
          ))}
        </dl>

        <div className="flex items-center gap-4 border-t pt-4">
          <JohnnyLogo className="text-foreground/85 size-20 shrink-0" />
          <div className="grid gap-1.5 text-sm">
            <p className="font-semibold">JohnnyStudio</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              WLT를 만든 개발 스튜디오입니다. 로봇 <b className="text-foreground">Johnny</b>가 스튜디오의 마크이자
              마스코트입니다.
            </p>
            {/* The webview can't hand mailto: links to a mail app, so clicking copies the address. */}
            <button
              title="클릭하면 주소를 복사합니다"
              onClick={() => {
                void navigator.clipboard.writeText(CONTACT);
                setCopied(true);
              }}
              className="text-primary inline-flex w-fit items-center gap-1.5 text-xs hover:underline"
            >
              <Mail className="size-3.5" />
              {CONTACT}
              {copied && <span className="text-success no-underline">복사됨</span>}
            </button>
          </div>
        </div>

        <p className="text-muted-foreground text-[11px]">
          Built with Tauri · React · xterm.js · Monaco · Rust
          <br />© 2026 JohnnyStudio
        </p>

        <DialogFooter>
          <Button onClick={() => onOpenChange(false)}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
