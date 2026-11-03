import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { Terminal } from "@/components/Terminal";
import { EditorPane } from "@/components/editor/EditorPane";
import { registerDrop, useDnd, type DragPayload } from "@/lib/dnd";
import { terminalRegistry } from "@/lib/terminalRegistry";
import { cn } from "@/lib/utils";
import {
  firstGroupId,
  groupOfTab,
  useTabStore,
  type LayoutNode,
  type SplitSide,
} from "@/store/tabStore";
import { TabBar } from "./TabBar";

interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

type RegisterBody = (groupId: string, el: HTMLElement | null) => void;

interface WorkspaceProps {
  /** Shown in the body of the (only) group while no tab is open. */
  emptyState: ReactNode;
  /** Opens a local terminal in the focused group. */
  onNewTab: () => void;
  /** Opens a local terminal in a new group to the right of the focused one. */
  onSplitRight: () => void;
}

/**
 * Split layout of tab groups (VS Code style).
 *
 * Terminals are NOT rendered inside the layout tree: moving a tab to another
 * group would then unmount it and kill its PTY / SSH session. Instead every
 * terminal lives in one flat, keyed layer and is absolutely positioned over the
 * measured body of the group it currently belongs to.
 */
export function Workspace({ emptyState, onNewTab, onSplitRight }: WorkspaceProps) {
  const layout = useTabStore((s) => s.layout);
  const tabs = useTabStore((s) => s.tabs);
  const groups = useTabStore((s) => s.groups);
  const focusedGroupId = useTabStore((s) => s.focusedGroupId);
  const draggingTabId = useDnd((s) => (s.payload?.kind === "tab" ? s.payload.tabId : null));
  const focusGroup = useTabStore((s) => s.focusGroup);

  const rootRef = useRef<HTMLDivElement>(null);
  const bodiesRef = useRef(new Map<string, HTMLElement>());
  const observerRef = useRef<ResizeObserver | null>(null);
  const [rects, setRects] = useState<Record<string, Rect>>({});

  const measure = useCallback(() => {
    const root = rootRef.current;
    if (!root) return;
    const origin = root.getBoundingClientRect();
    const next: Record<string, Rect> = {};
    for (const [id, el] of bodiesRef.current) {
      const r = el.getBoundingClientRect();
      next[id] = { left: r.left - origin.left, top: r.top - origin.top, width: r.width, height: r.height };
    }
    setRects((prev) => (sameRects(prev, next) ? prev : next));
  }, []);

  const registerBody = useCallback<RegisterBody>((groupId, el) => {
    const bodies = bodiesRef.current;
    const old = bodies.get(groupId);
    if (old) observerRef.current?.unobserve(old);
    if (el) {
      bodies.set(groupId, el);
      observerRef.current?.observe(el);
    } else {
      bodies.delete(groupId);
    }
  }, []);

  useEffect(() => {
    const observer = new ResizeObserver(measure);
    observerRef.current = observer;
    if (rootRef.current) observer.observe(rootRef.current);
    bodiesRef.current.forEach((el) => observer.observe(el));
    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, [measure]);

  // A split can move a group without resizing it, so re-measure on every layout change.
  useLayoutEffect(measure, [layout, measure]);

  const groupProps: GroupCallbacks = {
    registerBody,
    emptyState,
    onNewTab: (groupId) => {
      focusGroup(groupId);
      onNewTab();
    },
    onSplitRight: (groupId) => {
      focusGroup(groupId);
      onSplitRight();
    },
    topLeftGroupId: firstGroupId(layout),
  };

  return (
    <div ref={rootRef} className="relative flex min-h-0 min-w-0 flex-1">
      <LayoutView node={layout} {...groupProps} />

      {tabs.map((tab) => {
        const group = groupOfTab(groups, tab.id);
        const rect = group ? rects[group.id] : undefined;
        const visible = !!group && !!rect && group.activeTabId === tab.id;
        return (
          // Keyed by tab id in a flat list, so moving between groups never remounts the terminal.
          <div
            key={tab.id}
            className={visible ? "absolute overflow-hidden" : "hidden"}
            style={rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined}
            onMouseDownCapture={() => group && focusGroup(group.id)}
            data-drop={tab.target.type === "editor" ? undefined : "terminal"}
            data-tab-id={tab.id}
          >
            {tab.target.type === "editor" ? (
              <EditorPane tab={tab} visible={visible} focused={visible && group?.id === focusedGroupId} />
            ) : (
              <Terminal tab={tab} visible={visible} focused={visible && group?.id === focusedGroupId} />
            )}
          </div>
        );
      })}

      {draggingTabId &&
        Object.keys(groups).map(
          (groupId) => rects[groupId] && <DropZone key={groupId} groupId={groupId} rect={rects[groupId]} />,
        )}
    </div>
  );
}

function sameRects(a: Record<string, Rect>, b: Record<string, Rect>) {
  const keys = Object.keys(b);
  if (keys.length !== Object.keys(a).length) return false;
  return keys.every((k) => {
    const x = a[k];
    const y = b[k];
    return x && x.left === y.left && x.top === y.top && x.width === y.width && x.height === y.height;
  });
}

// ── Layout tree ─────────────────────────────────────────────────────────────

interface GroupCallbacks {
  registerBody: RegisterBody;
  emptyState: ReactNode;
  onNewTab: (groupId: string) => void;
  onSplitRight: (groupId: string) => void;
  topLeftGroupId: string;
}

function LayoutView({ node, ...props }: { node: LayoutNode } & GroupCallbacks) {
  if (node.type === "group") return <GroupView groupId={node.groupId} {...props} />;
  const row = node.direction === "row";
  return (
    <div className={cn("flex min-h-0 min-w-0 flex-1", row ? "flex-row" : "flex-col")}>
      <div className="flex min-h-0 min-w-0 overflow-hidden" style={{ flex: `${node.ratio} 1 0px` }}>
        <LayoutView node={node.first} {...props} />
      </div>
      <Splitter splitId={node.id} row={row} />
      <div className="flex min-h-0 min-w-0 overflow-hidden" style={{ flex: `${1 - node.ratio} 1 0px` }}>
        <LayoutView node={node.second} {...props} />
      </div>
    </div>
  );
}

function GroupView({
  groupId,
  registerBody,
  emptyState,
  onNewTab,
  onSplitRight,
  topLeftGroupId,
}: { groupId: string } & GroupCallbacks) {
  const empty = useTabStore((s) => s.groups[groupId]?.tabIds.length === 0);
  const focusGroup = useTabStore((s) => s.focusGroup);
  const bodyRef = useCallback((el: HTMLDivElement | null) => registerBody(groupId, el), [groupId, registerBody]);

  return (
    <section className="flex min-h-0 min-w-0 flex-1 flex-col" onMouseDown={() => focusGroup(groupId)}>
      <TabBar
        groupId={groupId}
        showSidebarToggle={groupId === topLeftGroupId}
        onNewTab={() => onNewTab(groupId)}
        onSplitRight={() => onSplitRight(groupId)}
      />
      {/* Terminals are overlaid on this element by <Workspace>. */}
      <div ref={bodyRef} className="relative min-h-0 flex-1">
        {empty && emptyState}
      </div>
    </section>
  );
}

/** Divider between the two halves of a split; drag to resize, double-click to even out. */
function Splitter({ splitId, row }: { splitId: string; row: boolean }) {
  const setSplitRatio = useTabStore((s) => s.setSplitRatio);
  const [dragging, setDragging] = useState(false);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const container = handle.parentElement!;
    handle.setPointerCapture(e.pointerId);
    setDragging(true);
    document.body.style.cursor = row ? "col-resize" : "row-resize";
    document.body.style.userSelect = "none";

    const onMove = (ev: PointerEvent) => {
      const r = container.getBoundingClientRect();
      const ratio = row ? (ev.clientX - r.left) / r.width : (ev.clientY - r.top) / r.height;
      setSplitRatio(splitId, Math.min(0.9, Math.max(0.1, ratio)));
    };
    const onUp = () => {
      handle.removeEventListener("pointermove", onMove);
      handle.removeEventListener("pointerup", onUp);
      handle.removeEventListener("pointercancel", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setDragging(false);
    };
    handle.addEventListener("pointermove", onMove);
    handle.addEventListener("pointerup", onUp);
    handle.addEventListener("pointercancel", onUp);
  };

  return (
    <div
      role="separator"
      aria-orientation={row ? "vertical" : "horizontal"}
      title="드래그하여 크기 조절 · 더블클릭하면 반반"
      onPointerDown={onPointerDown}
      onDoubleClick={() => setSplitRatio(splitId, 0.5)}
      className={cn(
        "bg-border hover:bg-primary/60 z-10 shrink-0 transition-colors",
        row ? "w-1 cursor-col-resize" : "h-1 cursor-row-resize",
        dragging && "bg-primary/60",
      )}
    />
  );
}

// ── Drop zones ──────────────────────────────────────────────────────────────

type DropTarget = SplitSide | "center";

/** Pointer within this fraction of a group's edge splits; otherwise the tab moves into the group. */
const EDGE = 0.25;

const HIGHLIGHT: Record<DropTarget, string> = {
  left: "inset-y-0 left-0 w-1/2",
  right: "inset-y-0 right-0 w-1/2",
  top: "inset-x-0 top-0 h-1/2",
  bottom: "inset-x-0 bottom-0 h-1/2",
  center: "inset-0",
};

/**
 * Which part of group `groupId` (overlay `el`) a tab dragged to (x, y) targets:
 * an edge splits, the middle moves the tab into the group.
 */
function dropZoneAt(el: HTMLElement, x: number, y: number, tabId: string): DropTarget | null {
  const groupId = el.dataset.groupId!;
  const source = groupOfTab(useTabStore.getState().groups, tabId);
  if (!source) return null;
  const sameGroup = source.id === groupId;
  const r = el.getBoundingClientRect();
  const fx = (x - r.left) / r.width;
  const fy = (y - r.top) / r.height;
  const [side, distance] = (
    [
      ["left", fx],
      ["right", 1 - fx],
      ["top", fy],
      ["bottom", 1 - fy],
    ] as [SplitSide, number][]
  ).reduce((p, q) => (q[1] < p[1] ? q : p));
  // A group's only tab can't be split off from itself, and dropping into its own group does nothing.
  if (distance < EDGE && !(sameGroup && source.tabIds.length === 1)) return side;
  return sameGroup ? null : "center";
}

registerDrop("group", (payload, el, x, y) => {
  if (payload.kind !== "tab") return;
  const where = dropZoneAt(el, x, y, payload.tabId);
  const { moveTab, splitTab } = useTabStore.getState();
  if (where === "center") moveTab(payload.tabId, el.dataset.groupId!);
  else if (where) splitTab(payload.tabId, el.dataset.groupId!, where);
});

/** Files dropped on a terminal are typed in as (quoted) paths, like Windows Terminal does. */
registerDrop("terminal", (payload: DragPayload, el) => {
  if (payload.kind === "tab") return;
  const tab = useTabStore.getState().tabs.find((t) => t.id === el.dataset.tabId);
  const posix = tab?.target.type === "ssh";
  const quote = (p: string) =>
    !/[\s'"&|;()<>$`]/.test(p) ? p : posix ? `'${p.replace(/'/g, "'\\''")}'` : `"${p}"`;
  terminalRegistry.get(el.dataset.tabId!)?.paste(payload.paths.map(quote).join(" "));
});

/** Overlay shown on every group while a tab is dragged, VS Code style. */
function DropZone({ groupId, rect }: { groupId: string; rect: Rect }) {
  const target = useDnd((s) =>
    s.payload?.kind === "tab" && s.over?.dataset.drop === "group" && s.over.dataset.groupId === groupId
      ? dropZoneAt(s.over, s.x, s.y, s.payload.tabId)
      : null,
  );

  return (
    <div
      className="absolute z-30"
      style={{ left: rect.left, top: rect.top, width: rect.width, height: rect.height }}
      data-drop="group"
      data-group-id={groupId}
    >
      {target && (
        <div
          className={cn(
            "bg-primary/20 border-primary/60 pointer-events-none absolute rounded-sm border-2 transition-all duration-100",
            HIGHLIGHT[target],
          )}
        />
      )}
    </div>
  );
}
