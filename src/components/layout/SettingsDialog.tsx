import { useEffect, useState } from "react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { FolderOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { backend, isDesktop, type ShellInfo } from "@/lib/backend";
import { FONTS, THEMES, fontStack, type FontFamily, type ThemeName } from "@/lib/themes";
import { cn } from "@/lib/utils";
import { useSettingsStore, type CursorStyle } from "@/store/settingsStore";

interface SettingsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  shells: ShellInfo[];
}

const DEFAULT_SHELL = "__default__";

export function SettingsDialog({ open, onOpenChange, shells }: SettingsDialogProps) {
  const s = useSettingsStore();

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>설정</DialogTitle>
          <DialogDescription>변경 사항은 즉시 모든 탭에 적용되고 자동 저장됩니다.</DialogDescription>
        </DialogHeader>

        <section className="grid gap-2">
          <Label className="text-muted-foreground text-xs">테마</Label>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(THEMES) as ThemeName[]).map((name) => {
              const t = THEMES[name].terminal;
              return (
                <button
                  key={name}
                  type="button"
                  onClick={() => s.update({ theme: name })}
                  className={cn(
                    "rounded-md border p-2 text-left transition-colors",
                    s.theme === name ? "border-primary ring-primary/40 ring-2" : "hover:border-muted-foreground",
                  )}
                  style={{ background: THEMES[name].backdrop ?? t.background, color: t.foreground }}
                >
                  <div className="text-xs font-medium">{THEMES[name].label}</div>
                  <div className="mt-1.5 flex gap-1">
                    {[t.red, t.green, t.yellow, t.blue, t.magenta, t.cyan].map((c, i) => (
                      <span key={i} className="size-3 rounded-full" style={{ background: c }} />
                    ))}
                  </div>
                </button>
              );
            })}
          </div>
        </section>

        <div className="grid grid-cols-2 gap-3">
          <Field label="글꼴">
            <Select value={s.fontFamily} onValueChange={(v) => s.update({ fontFamily: v as FontFamily })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[
                  { label: "앱에 포함된 글꼴", bundled: true },
                  { label: "Windows 시스템 글꼴 (D2Coding은 설치된 경우)", bundled: false },
                ].map((group) => (
                  <SelectGroup key={group.label}>
                    <SelectLabel>{group.label}</SelectLabel>
                    {FONTS.filter((f) => f.bundled === group.bundled).map(({ name }) => (
                      <SelectItem key={name} value={name}>
                        <span style={{ fontFamily: fontStack(name) }}>{name}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="크기">
              <Input
                type="number"
                min={8}
                max={32}
                value={s.fontSize}
                onChange={(e) => s.update({ fontSize: clamp(Number(e.target.value), 8, 32) })}
              />
            </Field>
            <Field label="줄 간격">
              <Input
                type="number"
                min={1}
                max={2}
                step={0.05}
                value={s.lineHeight}
                onChange={(e) => s.update({ lineHeight: clamp(Number(e.target.value), 1, 2) })}
              />
            </Field>
          </div>
        </div>

        <div
          className="rounded-md border px-3 py-2 text-sm"
          style={{
            fontFamily: fontStack(s.fontFamily),
            fontSize: s.fontSize,
            background: THEMES[s.theme].backdrop ?? THEMES[s.theme].terminal.background,
            color: THEMES[s.theme].terminal.foreground,
          }}
        >
          user@host:~$ ls -la =&gt; != === -&gt; 0O1lI 한글
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="커서 모양">
            <Select value={s.cursorStyle} onValueChange={(v) => s.update({ cursorStyle: v as CursorStyle })}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="block">블록 █</SelectItem>
                <SelectItem value="bar">막대 ▏</SelectItem>
                <SelectItem value="underline">밑줄 _</SelectItem>
              </SelectContent>
            </Select>
          </Field>
          <Field label="스크롤백 (줄)">
            <Input
              type="number"
              min={1000}
              max={200000}
              step={1000}
              value={s.scrollback}
              onChange={(e) => s.update({ scrollback: clamp(Number(e.target.value), 1000, 200000) })}
            />
          </Field>
        </div>

        <Field label="작업 표시줄 · 사이드바 위치">
          <Select
            value={s.sidebarSide}
            onValueChange={(v) => s.update({ sidebarSide: v as "left" | "right" })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="left">왼쪽</SelectItem>
              <SelectItem value="right">오른쪽</SelectItem>
            </SelectContent>
          </Select>
        </Field>

        <ExplorerStartDir />

        <Field label="기본 로컬 셸">
          <Select
            value={s.defaultShell || DEFAULT_SHELL}
            onValueChange={(v) => s.update({ defaultShell: v === DEFAULT_SHELL ? "" : v })}
          >
            <SelectTrigger>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={DEFAULT_SHELL}>자동 ({shells[0]?.name ?? "PowerShell"})</SelectItem>
              {shells.map((sh) => (
                <SelectItem key={sh.command} value={sh.command}>
                  {sh.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </Field>

        <div className="grid gap-2">
          <Toggle label="커서 깜박임" checked={s.cursorBlink} onChange={(v) => s.update({ cursorBlink: v })} />
          <Toggle
            label="선택 시 자동 복사 (PuTTY 방식)"
            checked={s.copyOnSelect}
            onChange={(v) => s.update({ copyOnSelect: v })}
          />
          <Toggle
            label="WebGL 렌더러 (GPU 가속)"
            checked={s.webgl}
            onChange={(v) => s.update({ webgl: v })}
          />
          <Toggle
            label="합자(Ligatures) — 새 탭부터 적용"
            checked={s.ligatures}
            onChange={(v) => s.update({ ligatures: v })}
          />
        </div>

        <HistorySettings />

        <LogSettings />

        <DialogFooter>
          <Button variant="ghost" onClick={s.reset}>
            기본값으로
          </Button>
          <Button onClick={() => onOpenChange(false)}>닫기</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function clamp(v: number, min: number, max: number) {
  return Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  );
}

/** Where the explorer starts: typed in, picked with the folder dialog, or reset to the home folder. */
function ExplorerStartDir() {
  const dirs = useSettingsStore((s) => s.explorerStartDirs);
  const update = useSettingsStore((s) => s.update);
  const local = dirs.local ?? "";
  const remote = Object.keys(dirs).filter((k) => k.startsWith("ssh:")).length;
  const setLocal = (dir: string) => {
    const { local: _old, ...rest } = useSettingsStore.getState().explorerStartDirs;
    update({ explorerStartDirs: dir.trim() ? { ...rest, local: dir.trim() } : rest });
  };

  return (
    <Field label="탐색기 시작 폴더 (로컬 PC, 비워 두면 홈 폴더)">
      <div className="flex gap-2">
        <Input
          value={local}
          placeholder="예: D:\Projects"
          spellCheck={false}
          className="font-mono text-xs"
          onChange={(e) => setLocal(e.target.value)}
        />
        <Button
          variant="outline"
          disabled={!isDesktop}
          onClick={() =>
            void openDialog({ directory: true, defaultPath: local || undefined, title: "탐색기 시작 폴더 선택" }).then(
              (dir) => typeof dir === "string" && setLocal(dir),
            )
          }
        >
          <FolderOpen />
          찾아보기
        </Button>
      </div>
      {remote > 0 && (
        <p className="text-muted-foreground flex items-center gap-2 text-xs">
          SSH 서버 시작 폴더 {remote}개 저장됨
          <button
            className="text-primary hover:underline"
            onClick={() => update({ explorerStartDirs: local ? { local } : {} })}
          >
            모두 초기화
          </button>
        </p>
      )}
    </Field>
  );
}

/** Session history: keeping closed tabs alive, saved screens, shell integration. */
function HistorySettings() {
  const s = useSettingsStore();
  const num = (v: string, min: number, max: number) => clamp(Math.round(Number(v)), min, max);
  return (
    <section className="grid gap-2 rounded-md border p-3">
      <Label className="text-sm font-medium">세션 히스토리</Label>
      <p className="text-muted-foreground text-xs">
        앱을 종료할 때 열려 있던 탭이 세션 히스토리에 남고, 다음에 클릭하면 같은 셸·서버의 작업하던 폴더로
        돌아갑니다.
      </p>
      <Toggle
        label="탭을 직접 닫을 때도 히스토리에 저장 (닫은 탭을 잠시 살려 두기)"
        checked={s.historyOnTabClose}
        onChange={(v) => s.update({ historyOnTabClose: v })}
      />
      {s.historyOnTabClose && (
        <div className="grid grid-cols-2 gap-3 pl-3">
          <Field label="닫은 탭 보관 시간 (분, 0 = 바로 종료)">
            <Input
              type="number"
              min={0}
              max={1440}
              value={s.historyKeepMinutes}
              onChange={(e) => s.update({ historyKeepMinutes: num(e.target.value, 0, 1440) })}
            />
          </Field>
          <Field label="최대 보관 개수">
            <Input
              type="number"
              min={1}
              max={20}
              value={s.historyKeepMax}
              onChange={(e) => s.update({ historyKeepMax: num(e.target.value, 1, 20) })}
            />
          </Field>
          <p className="text-muted-foreground col-span-2 text-[11px] leading-relaxed">
            보관 시간 안에 돌아오면 실행 중인 프로그램까지 그대로 이어지고(셸·연결 유지), 지나면 같은 셸·서버에 다시
            연결합니다.
          </p>
        </div>
      )}
      <div className="grid grid-cols-2 gap-3">
        <Field label="화면 기록 저장 (줄, 0 = 저장 안 함)">
          <Input
            type="number"
            min={0}
            max={10000}
            step={100}
            value={s.historySnapshotLines}
            onChange={(e) => s.update({ historySnapshotLines: num(e.target.value, 0, 10000) })}
          />
        </Field>
        <Field label="히스토리 최대 개수">
          <Input
            type="number"
            min={10}
            max={500}
            value={s.historyMaxEntries}
            onChange={(e) => s.update({ historyMaxEntries: num(e.target.value, 10, 500) })}
          />
        </Field>
      </div>
      {s.historySnapshotLines > 0 && (
        <p className="text-muted-foreground text-[11px] leading-relaxed">
          저장된 화면 기록에는 비밀번호 등 화면에 나온 내용이 포함될 수 있습니다.
        </p>
      )}
      <Toggle
        label="셸 통합 — 로컬 셸의 현재 폴더 추적 (프로필 파일은 바꾸지 않음)"
        checked={s.shellIntegration}
        onChange={(v) => s.update({ shellIntegration: v })}
      />
      <Toggle
        label="SSH 접속 시 셸 통합 명령 자동 입력 (bash · zsh)"
        checked={s.sshShellIntegration}
        onChange={(v) => s.update({ sshShellIntegration: v })}
      />
      <Toggle
        label="탐색기가 터미널의 현재 폴더 따라가기"
        checked={s.explorerFollowTerminal}
        onChange={(v) => s.update({ explorerFollowTerminal: v })}
      />
    </section>
  );
}

/** Session logging: what to record, how, and where. */
function LogSettings() {
  const s = useSettingsStore();
  const [defaultDir, setDefaultDir] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (isDesktop) backend.defaultLogDir().then(setDefaultDir, () => {});
  }, []);

  const openFolder = () => {
    setError(null);
    backend.openLogFolder(s.logDir).catch((e) => setError(String(e)));
  };

  return (
    <section className="grid gap-2 rounded-md border p-3">
      <div className="flex items-center justify-between">
        <Label className="text-sm font-medium">세션 로그</Label>
        <Button variant="outline" size="sm" onClick={openFolder} disabled={!isDesktop}>
          <FolderOpen />
          로그 폴더 열기
        </Button>
      </div>
      <p className="text-muted-foreground text-xs">
        각 패널의 입력과 출력을 파일로 저장합니다. 변경 내용은 새로 열거나 다시 연결한 세션부터 적용됩니다.
      </p>

      <Toggle label="로그 저장" checked={s.logEnabled} onChange={(v) => s.update({ logEnabled: v })} />
      <div className={cn("grid gap-2 pl-3", !s.logEnabled && "pointer-events-none opacity-50")}>
        <Toggle label="출력 저장 (화면에 표시된 내용 → .log)" checked={s.logOutput} onChange={(v) => s.update({ logOutput: v })} />
        <Toggle
          label="입력 저장 (입력한 명령 → .input.log)"
          checked={s.logInput}
          onChange={(v) => s.update({ logInput: v })}
        />
        {s.logInput && (
          <p className="text-warning text-xs">
            ⚠ 입력 로그에는 sudo 등 셸 안에서 입력한 비밀번호도 그대로 기록될 수 있습니다.
          </p>
        )}
        <Toggle
          label="제어 문자 제거 (색상·커서 코드를 빼고 일반 텍스트로 저장)"
          checked={s.logStripAnsi}
          onChange={(v) => s.update({ logStripAnsi: v })}
        />
        <Toggle
          label="출력 줄마다 시간 기록"
          checked={s.logStripAnsi && s.logTimestamps}
          disabled={!s.logStripAnsi}
          onChange={(v) => s.update({ logTimestamps: v })}
        />
        <Field label="저장 폴더 (비워 두면 기본 폴더, 날짜별 하위 폴더에 저장)">
          <Input
            value={s.logDir}
            placeholder={defaultDir || "Documents\\WLT Logs"}
            spellCheck={false}
            onChange={(e) => s.update({ logDir: e.target.value })}
          />
        </Field>
        {error && <p className="text-destructive text-xs">{error}</p>}
      </div>
    </section>
  );
}

function Toggle({
  label,
  checked,
  onChange,
  disabled,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className="hover:bg-accent/50 flex items-center justify-between gap-3 rounded-md px-1 py-1 text-left text-sm disabled:pointer-events-none disabled:opacity-50"
    >
      <span>{label}</span>
      <span
        className={cn(
          "relative inline-flex h-5 w-9 shrink-0 rounded-full transition-colors",
          checked ? "bg-primary" : "bg-muted",
        )}
      >
        <span
          className={cn(
            "bg-foreground absolute top-0.5 size-4 rounded-full transition-transform",
            checked ? "translate-x-4.5" : "translate-x-0.5",
          )}
        />
      </span>
    </button>
  );
}
