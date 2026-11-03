/**
 * Pointer-based drag & drop for everything inside the app (tabs, explorer
 * items) plus files dragged in from Windows Explorer.
 *
 * Why not HTML5 drag & drop: on Windows, Tauri only reports the paths of files
 * dropped from Explorer when its native drop handler is enabled — and that
 * handler swallows HTML5 drag events. So in-app drags are tracked with pointer
 * events, and OS drops come from Tauri's drag-drop events; both end up here.
 *
 * Drop targets are plain elements marked `data-drop="<type>"`; the handler
 * registered for that type decides what a drop does, reading `el.dataset`.
 */
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { create } from "zustand";

export type DragPayload =
  | { kind: "tab"; tabId: string; label: string }
  | { kind: "fs"; targetKey: string; paths: string[]; label: string }
  | { kind: "os"; paths: string[]; label: string };

interface DndState {
  payload: DragPayload | null;
  x: number;
  y: number;
  /** Drop target under the pointer. */
  over: HTMLElement | null;
  /** Ctrl held: copy instead of move. */
  copy: boolean;
}

export const useDnd = create<DndState>(() => ({ payload: null, x: 0, y: 0, over: null, copy: false }));

type DropHandler = (payload: DragPayload, el: HTMLElement, x: number, y: number, copy: boolean) => void;
const handlers = new Map<string, DropHandler>();

/** Registers what dropping on `data-drop="<type>"` elements does. */
export function registerDrop(type: string, handler: DropHandler) {
  handlers.set(type, handler);
}

function hitTest(x: number, y: number): HTMLElement | null {
  return (document.elementFromPoint(x, y)?.closest("[data-drop]") as HTMLElement | null) ?? null;
}

export function dragStart(payload: DragPayload, x: number, y: number) {
  document.body.style.cursor = "grabbing";
  document.body.style.userSelect = "none";
  useDnd.setState({ payload, x, y, over: hitTest(x, y) });
}

export function dragMove(x: number, y: number, copy = false) {
  useDnd.setState({ x, y, copy, over: hitTest(x, y) });
}

export function dragEnd() {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
  useDnd.setState({ payload: null, over: null, copy: false });
}

export function dragDrop(x: number, y: number, copy = false) {
  const { payload } = useDnd.getState();
  const el = hitTest(x, y);
  dragEnd();
  if (payload && el) handlers.get(el.dataset.drop!)?.(payload, el, x, y, copy);
}

/**
 * Call from `onPointerDown`. The drag only starts after the pointer moves a
 * few pixels, so plain clicks keep working; the click that would follow a real
 * drag is swallowed. Esc cancels.
 */
export function beginPointerDrag(e: React.PointerEvent, makePayload: () => DragPayload | null) {
  if (e.button !== 0) return;
  const startX = e.clientX;
  const startY = e.clientY;
  let started = false;

  const onMove = (ev: PointerEvent) => {
    if (!started) {
      if (Math.hypot(ev.clientX - startX, ev.clientY - startY) < 5) return;
      const payload = makePayload();
      if (!payload) return cleanup();
      started = true;
      dragStart(payload, ev.clientX, ev.clientY);
    }
    dragMove(ev.clientX, ev.clientY, ev.ctrlKey);
  };
  const onUp = (ev: PointerEvent) => {
    cleanup();
    if (!started) return;
    // The pointerup is followed (in the same turn) by a click on whatever is under the pointer.
    const swallow = (c: Event) => c.stopPropagation();
    window.addEventListener("click", swallow, true);
    setTimeout(() => window.removeEventListener("click", swallow, true), 0);
    dragDrop(ev.clientX, ev.clientY, ev.ctrlKey);
  };
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== "Escape") return;
    ev.preventDefault();
    cleanup();
    if (started) dragEnd();
  };
  const cleanup = () => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("keydown", onKey, true);
  };
  const onCancel = () => {
    cleanup();
    if (started) dragEnd();
  };
  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
  window.addEventListener("pointercancel", onCancel);
  window.addEventListener("keydown", onKey, true);
}

/**
 * Files dragged in from Windows Explorer (Tauri reports their real paths, in
 * physical pixels). Fed into the same state, so the same targets highlight.
 */
export function listenOsFileDrop() {
  const css = (p: { x: number; y: number }) => [p.x / window.devicePixelRatio, p.y / window.devicePixelRatio] as const;
  return getCurrentWebview().onDragDropEvent(({ payload: p }) => {
    if (p.type === "enter") {
      if (!p.paths.length) return; // e.g. dragged text
      const name = p.paths[0].split(/[\\/]/).at(-1) ?? p.paths[0];
      dragStart({ kind: "os", paths: p.paths, label: p.paths.length === 1 ? name : `${p.paths.length}개 항목` }, ...css(p.position));
    } else if (p.type === "over") {
      if (useDnd.getState().payload?.kind === "os") dragMove(...css(p.position));
    } else if (p.type === "drop") {
      if (useDnd.getState().payload?.kind === "os") dragDrop(...css(p.position));
    } else {
      dragEnd();
    }
  });
}

/** Label that follows the pointer while dragging. */
export function DragGhost() {
  const payload = useDnd((s) => s.payload);
  const x = useDnd((s) => s.x);
  const y = useDnd((s) => s.y);
  const copy = useDnd((s) => s.copy);
  if (!payload) return null;
  return (
    <div
      className="bg-popover text-popover-foreground pointer-events-none fixed z-[100] max-w-64 truncate rounded-md border px-2 py-1 text-xs shadow-lg"
      style={{ left: x + 14, top: y + 14 }}
    >
      {copy && payload.kind === "fs" ? "+ " : ""}
      {payload.label}
    </div>
  );
}
