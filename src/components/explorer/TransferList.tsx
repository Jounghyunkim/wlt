import { Check, CircleAlert, FolderSearch, Loader2, X } from "lucide-react";
import { formatSize, fsApi } from "@/lib/fs";
import { cn } from "@/lib/utils";
import { useExplorerStore, type Transfer } from "@/store/explorerStore";

/** Copy / move / download / upload progress at the bottom of the explorer. */
export function TransferList() {
  const transfers = useExplorerStore((s) => s.transfers);
  const edits = useExplorerStore((s) => s.edits);
  const clearFinished = useExplorerStore((s) => s.clearFinishedTransfers);
  if (!transfers.length && !edits.length) return null;

  return (
    <div className="max-h-56 shrink-0 overflow-auto border-t">
      {edits.length > 0 && <EditList />}
      {transfers.length > 0 && (
        <>
          <TransferHeader showClear={transfers.some((t) => t.status !== "running")} onClear={clearFinished} />
          {transfers
            .slice()
            .reverse()
            .map((t) => (
              <TransferItem key={t.id} transfer={t} />
            ))}
        </>
      )}
    </div>
  );
}

function TransferHeader({ showClear, onClear }: { showClear: boolean; onClear: () => void }) {
  return (
    <div className="flex items-center px-3 pt-1.5 pb-1">
      <span className="text-muted-foreground flex-1 text-[11px] font-semibold tracking-wider uppercase">전송</span>
      {showClear && (
        <button className="text-muted-foreground hover:text-foreground text-[11px]" onClick={onClear}>
          완료 항목 지우기
        </button>
      )}
    </div>
  );
}

/** Remote files open in a local app; each save is uploaded back automatically. */
function EditList() {
  const edits = useExplorerStore((s) => s.edits);
  const stopEdit = useExplorerStore((s) => s.stopEdit);
  return (
    <>
      <div className="text-muted-foreground px-3 pt-1.5 pb-1 text-[11px] font-semibold tracking-wider uppercase">
        편집 중 (저장 시 자동 업로드)
      </div>
      {edits.map((e) => (
        <div key={e.id} className="flex items-center gap-1.5 px-3 py-1 text-xs" title={`${e.remotePath}\n← ${e.localPath}`}>
          {e.status === "uploading" ? (
            <Loader2 className="text-primary size-3.5 shrink-0 animate-spin" />
          ) : e.status === "error" ? (
            <CircleAlert className="text-destructive size-3.5 shrink-0" />
          ) : (
            <Check className={cn("size-3.5 shrink-0", e.syncedAt ? "text-success" : "text-muted-foreground")} />
          )}
          <span className="min-w-0 flex-1 truncate">{e.name}</span>
          <span className={cn("shrink-0", e.status === "error" ? "text-destructive" : "text-muted-foreground")}>
            {e.status === "uploading"
              ? "업로드 중…"
              : e.status === "error"
                ? "업로드 실패"
                : e.syncedAt
                  ? `업로드됨 ${new Date(e.syncedAt).toLocaleTimeString()}`
                  : "변경 대기"}
          </span>
          <button
            title="자동 업로드 중지"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => stopEdit(e.id)}
          >
            <X className="size-3.5" />
          </button>
        </div>
      ))}
      {edits.some((e) => e.status === "error") && (
        <div className="text-destructive px-3 pb-1 text-xs break-words">
          {edits.find((e) => e.status === "error")?.error} — 다시 저장하면 재시도합니다.
        </div>
      )}
    </>
  );
}

function TransferItem({ transfer: t }: { transfer: Transfer }) {
  const cancel = useExplorerStore((s) => s.cancelTransfer);
  const dismiss = useExplorerStore((s) => s.dismissTransfer);
  const percent = t.total > 0 ? Math.min(100, Math.round((t.done / t.total) * 100)) : t.status === "done" ? 100 : 0;
  const revealable = t.status === "done" && t.dst.kind === "local" && t.created?.length;

  return (
    <div className="px-3 py-1.5 text-xs">
      <div className="flex items-center gap-1.5">
        {t.status === "running" && <Loader2 className="text-primary size-3.5 shrink-0 animate-spin" />}
        {t.status === "done" && <Check className="text-success size-3.5 shrink-0" />}
        {(t.status === "error" || t.status === "cancelled") && (
          <CircleAlert className={cn("size-3.5 shrink-0", t.status === "error" ? "text-destructive" : "text-muted-foreground")} />
        )}
        <span className="min-w-0 flex-1 truncate" title={t.label}>
          {t.label}
        </span>
        {revealable && (
          <button
            title="Windows 탐색기에서 보기"
            className="text-muted-foreground hover:text-foreground"
            onClick={() => void fsApi.reveal(t.created![0])}
          >
            <FolderSearch className="size-3.5" />
          </button>
        )}
        <button
          title={t.status === "running" ? "취소" : "닫기"}
          className="text-muted-foreground hover:text-foreground"
          onClick={() => (t.status === "running" ? cancel(t.id) : dismiss(t.id))}
        >
          <X className="size-3.5" />
        </button>
      </div>
      {t.status === "running" && (
        <>
          <div className="bg-muted mt-1 h-1 overflow-hidden rounded">
            <div className="bg-primary h-full transition-[width]" style={{ width: `${percent}%` }} />
          </div>
          <div className="text-muted-foreground mt-0.5 flex justify-between gap-2">
            <span className="truncate">{t.current}</span>
            <span className="shrink-0 tabular-nums">
              {formatSize(t.done)} / {formatSize(t.total)}
            </span>
          </div>
        </>
      )}
      {t.status === "error" && <div className="text-destructive mt-0.5 break-words">{t.error}</div>}
      {t.status === "cancelled" && <div className="text-muted-foreground mt-0.5">취소됨</div>}
    </div>
  );
}
