import { useEffect, useState } from "react";
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
import type { SshSession } from "@/store/sessionStore";

interface PasswordDialogProps {
  session: SshSession | null;
  onCancel: () => void;
  /** `save` = also store it in the Windows Credential Manager. */
  onSubmit: (password: string, save: boolean) => void;
}

/** Asks for the password of a session that does not store one. */
export function PasswordDialog({ session, onCancel, onSubmit }: PasswordDialogProps) {
  const [password, setPassword] = useState("");
  const [save, setSave] = useState(false);

  useEffect(() => {
    setPassword("");
    setSave(false);
  }, [session]);

  return (
    <Dialog open={!!session} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>비밀번호 입력</DialogTitle>
          <DialogDescription className="font-mono">
            {session && `${session.username}@${session.host}:${session.port}`}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(e) => {
            e.preventDefault();
            onSubmit(password, save);
          }}
        >
          <Input autoFocus type="password" value={password} onChange={(e) => setPassword(e.target.value)} />
          <label className="text-muted-foreground -mt-2 flex items-center gap-2 text-xs">
            <input type="checkbox" className="accent-primary" checked={save} onChange={(e) => setSave(e.target.checked)} />
            Windows 자격 증명 관리자에 저장
          </label>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onCancel}>
              취소
            </Button>
            <Button type="submit">연결</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
