import { useEffect, useMemo, useState } from "react";
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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Plus, Trash2 } from "lucide-react";
import { backend, isDesktop, type AuthMethod, type ForwardKind, type PortForward } from "@/lib/backend";
import { sessionLabel, useSessionStore, type SshSession, type SshSessionInput } from "@/store/sessionStore";

interface SessionDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Session to edit; `null` creates a new one. */
  session: SshSession | null;
  /** Called after save when the user pressed "save & connect", with secrets typed but not saved. */
  onConnect?: (session: SshSession, password?: string, passphrase?: string) => void;
}

const EMPTY: SshSessionInput = {
  name: "",
  group: "",
  host: "",
  port: 22,
  username: "",
  authMethod: "password",
  privateKeyPath: "~/.ssh/id_ed25519",
  forwards: [],
};

const FORWARD_LABEL: Record<ForwardKind, string> = {
  local: "L 로컬",
  remote: "R 원격",
  dynamic: "D SOCKS",
};

/** Accepts `user@host:port` pasted into the host field. */
function parseHostString(value: string): Partial<SshSessionInput> | null {
  const m = /^(?:([^@\s]+)@)?([^:\s]+)(?::(\d{1,5}))?$/.exec(value.trim());
  if (!m || (!m[1] && !m[3])) return null;
  return {
    host: m[2],
    ...(m[1] ? { username: m[1] } : {}),
    ...(m[3] ? { port: Number(m[3]) } : {}),
  };
}

export function SessionDialog({ open, onOpenChange, session, onConnect }: SessionDialogProps) {
  const addSession = useSessionStore((s) => s.addSession);
  const updateSession = useSessionStore((s) => s.updateSession);
  const sessions = useSessionStore((s) => s.sessions);
  const groups = useMemo(() => [...new Set(sessions.map((x) => x.group).filter(Boolean))], [sessions]);

  const [form, setForm] = useState<SshSessionInput>(EMPTY);
  // Secrets are typed here but never kept in the session: they go to the Credential Manager.
  const [password, setPassword] = useState("");
  const [passphrase, setPassphrase] = useState("");
  const [saveSecret, setSaveSecret] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    if (session) {
      const { id: _id, createdAt: _c, lastUsedAt: _l, password: _p, passphrase: _pp, ...rest } = session;
      setForm({ ...EMPTY, ...rest });
      setSaveSecret(!!(session.hasPassword || session.hasPassphrase));
    } else {
      setForm(EMPTY);
      setSaveSecret(false);
    }
    setPassword("");
    setPassphrase("");
    setError(null);
  }, [open, session]);

  const set = <K extends keyof SshSessionInput>(key: K, value: SshSessionInput[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const forwards = form.forwards ?? [];
  const setForward = (i: number, patch: Partial<PortForward>) =>
    set("forwards", forwards.map((f, j) => (j === i ? { ...f, ...patch } : f)));

  const submit = async (connect: boolean) => {
    const host = form.host.trim();
    const username = form.username.trim();
    if (!host) return setError("호스트를 입력하세요.");
    if (!username) return setError("사용자 이름을 입력하세요.");
    if (!Number.isInteger(form.port) || form.port < 1 || form.port > 65535)
      return setError("포트는 1–65535 사이여야 합니다.");
    if (form.authMethod === "key" && !form.privateKeyPath?.trim())
      return setError("개인 키 경로를 입력하세요.");
    const badPort = (n: number | undefined) => !Number.isInteger(n) || n! < 1 || n! > 65535;
    for (const f of forwards) {
      if (badPort(f.bindPort) || (f.kind !== "dynamic" && (badPort(f.destPort) || !f.destHost?.trim())))
        return setError("포트 포워딩: 포트(1–65535)와 대상 호스트를 확인하세요.");
    }

    const data: SshSessionInput = {
      ...form,
      host,
      username,
      name: form.name.trim() || `${username}@${host}`,
      group: form.group.trim(),
      privateKeyPath: form.authMethod === "key" ? form.privateKeyPath?.trim() : undefined,
    };
    const saved = session ? { ...session, ...data } : addSession(data);

    // Secrets → Windows Credential Manager. An empty field keeps what is already saved.
    const label = sessionLabel(saved);
    let hasPassword = saved.hasPassword ?? false;
    let hasPassphrase = saved.hasPassphrase ?? false;
    try {
      if (isDesktop) {
        if (saveSecret && data.authMethod === "password") {
          if (password) {
            await backend.credentialSet(saved.id, "password", password, label);
            hasPassword = true;
          }
        } else if (hasPassword) {
          await backend.credentialSet(saved.id, "password", "", label);
          hasPassword = false;
        }
        if (saveSecret && data.authMethod === "key") {
          if (passphrase) {
            await backend.credentialSet(saved.id, "passphrase", passphrase, label);
            hasPassphrase = true;
          }
        } else if (hasPassphrase) {
          await backend.credentialSet(saved.id, "passphrase", "", label);
          hasPassphrase = false;
        }
      }
    } catch (e) {
      return setError(String(e));
    }
    updateSession(saved.id, { ...data, hasPassword, hasPassphrase, password: undefined, passphrase: undefined });

    onOpenChange(false);
    // Secrets typed but not saved are still used for this one connection.
    if (connect) {
      onConnect?.({ ...saved, ...data, hasPassword, hasPassphrase }, password || undefined, passphrase || undefined);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{session ? "세션 편집" : "새 SSH 세션"}</DialogTitle>
          <DialogDescription>Linux 서버 접속 정보를 입력하세요. 호스트 칸에 user@host:port 형식도 붙여넣을 수 있습니다.</DialogDescription>
        </DialogHeader>

        <form
          className="grid gap-3"
          onSubmit={(e) => {
            e.preventDefault();
            void submit(false);
          }}
        >
          <div className="grid grid-cols-[1fr_8rem] gap-3">
            <Field label="이름">
              <Input value={form.name} placeholder="prod-web-01" onChange={(e) => set("name", e.target.value)} />
            </Field>
            <Field label="그룹">
              <Input
                value={form.group}
                list="wlt-session-groups"
                placeholder="(없음)"
                onChange={(e) => set("group", e.target.value)}
              />
              <datalist id="wlt-session-groups">
                {groups.map((g) => (
                  <option key={g} value={g} />
                ))}
              </datalist>
            </Field>
          </div>

          <div className="grid grid-cols-[1fr_6rem] gap-3">
            <Field label="호스트">
              <Input
                autoFocus
                value={form.host}
                placeholder="192.168.0.10"
                onChange={(e) => set("host", e.target.value)}
                onBlur={(e) => {
                  const parsed = parseHostString(e.target.value);
                  if (parsed) setForm((f) => ({ ...f, ...parsed }));
                }}
              />
            </Field>
            <Field label="포트">
              <Input
                type="number"
                min={1}
                max={65535}
                value={form.port}
                onChange={(e) => set("port", Number(e.target.value))}
              />
            </Field>
          </div>

          <Field label="사용자 이름">
            <Input value={form.username} placeholder="root" onChange={(e) => set("username", e.target.value)} />
          </Field>

          <Field label="인증 방식">
            <Select value={form.authMethod} onValueChange={(v) => set("authMethod", v as AuthMethod)}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">비밀번호</SelectItem>
                <SelectItem value="key">개인 키 (OpenSSH / PEM)</SelectItem>
                <SelectItem value="agent">SSH 에이전트 (OpenSSH Agent / Pageant)</SelectItem>
              </SelectContent>
            </Select>
          </Field>

          {form.authMethod === "password" && (
            <Field label="비밀번호">
              <Input
                type="password"
                value={password}
                placeholder={session?.hasPassword ? "저장됨 — 바꾸려면 새로 입력" : "비워 두면 접속할 때마다 묻기"}
                onChange={(e) => setPassword(e.target.value)}
              />
            </Field>
          )}
          {form.authMethod === "key" && (
            <>
              <Field label="개인 키 경로">
                <Input
                  value={form.privateKeyPath ?? ""}
                  placeholder="~/.ssh/id_ed25519"
                  className="font-mono text-xs"
                  onChange={(e) => set("privateKeyPath", e.target.value)}
                />
              </Field>
              <Field label="키 암호 (선택)">
                <Input
                  type="password"
                  value={passphrase}
                  placeholder={session?.hasPassphrase ? "저장됨 — 바꾸려면 새로 입력" : ""}
                  onChange={(e) => setPassphrase(e.target.value)}
                />
              </Field>
            </>
          )}
          {form.authMethod === "agent" ? (
            <p className="text-muted-foreground bg-muted rounded-md px-3 py-2 text-xs leading-relaxed">
              실행 중인 SSH 에이전트에 등록된 키로 로그인합니다. Windows OpenSSH 에이전트(ssh-agent 서비스,
              <code className="mx-1">ssh-add</code>로 키 등록)를 먼저 찾고, 없으면 PuTTY의 Pageant를 사용합니다. 개인 키
              파일이나 암호를 이 앱에 저장할 필요가 없습니다.
            </p>
          ) : (
            <label className="text-muted-foreground flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-primary"
                checked={saveSecret}
                onChange={(e) => setSaveSecret(e.target.checked)}
              />
              {form.authMethod === "password" ? "비밀번호" : "키 암호"}를 Windows 자격 증명 관리자에 안전하게 저장
            </label>
          )}

          <div className="grid gap-2">
            <div className="flex items-center justify-between">
              <Label className="text-muted-foreground text-xs">포트 포워딩</Label>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  set("forwards", [...forwards, { kind: "local", bindPort: 8080, destHost: "localhost", destPort: 80 }])
                }
              >
                <Plus />
                추가
              </Button>
            </div>
            {forwards.length === 0 && (
              <p className="text-muted-foreground text-xs">
                없음 — 서버 너머의 서비스(DB, 웹 등)에 접속하거나 SOCKS 프록시가 필요할 때 추가하세요.
              </p>
            )}
            {forwards.map((f, i) => (
              <div key={i} className="grid grid-cols-[5.5rem_4.5rem_1fr_4.5rem_auto] items-center gap-1.5">
                <Select value={f.kind} onValueChange={(v) => setForward(i, { kind: v as ForwardKind })}>
                  <SelectTrigger className="h-8 px-2 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(FORWARD_LABEL) as ForwardKind[]).map((k) => (
                      <SelectItem key={k} value={k} className="text-xs">
                        {FORWARD_LABEL[k]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  type="number"
                  className="h-8 px-2 text-xs"
                  title={f.kind === "remote" ? "서버에서 열 포트" : "이 PC에서 열 포트"}
                  value={f.bindPort}
                  onChange={(e) => setForward(i, { bindPort: Number(e.target.value) })}
                />
                {f.kind === "dynamic" ? (
                  <span className="text-muted-foreground col-span-2 text-xs">127.0.0.1:{f.bindPort} SOCKS5 프록시</span>
                ) : (
                  <>
                    <Input
                      className="h-8 px-2 font-mono text-xs"
                      placeholder={f.kind === "remote" ? "이 PC 쪽 대상" : "서버 쪽 대상"}
                      title={f.kind === "remote" ? "이 PC에서 본 대상 호스트" : "서버에서 본 대상 호스트"}
                      value={f.destHost ?? ""}
                      onChange={(e) => setForward(i, { destHost: e.target.value })}
                    />
                    <Input
                      type="number"
                      className="h-8 px-2 text-xs"
                      title="대상 포트"
                      value={f.destPort ?? ""}
                      onChange={(e) => setForward(i, { destPort: Number(e.target.value) })}
                    />
                  </>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="iconSm"
                  aria-label="포워딩 삭제"
                  onClick={() => set("forwards", forwards.filter((_, j) => j !== i))}
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
            {forwards.length > 0 && (
              <p className="text-muted-foreground text-[11px] leading-relaxed">
                L: 이 PC의 포트 → 서버에서 본 대상 · R: 서버의 포트 → 이 PC에서 본 대상 · D: 이 PC의 SOCKS5 프록시
              </p>
            )}
          </div>

          {error && <p className="text-destructive text-sm">{error}</p>}

          <DialogFooter className="pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              취소
            </Button>
            <Button type="submit" variant="secondary">
              저장
            </Button>
            {onConnect && (
              <Button type="button" onClick={() => void submit(true)}>
                저장 후 연결
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid gap-1.5">
      <Label className="text-muted-foreground text-xs">{label}</Label>
      {children}
    </div>
  );
}
