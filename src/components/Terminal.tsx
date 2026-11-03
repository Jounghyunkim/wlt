import { useEffect, useRef, useState } from "react";
import { Terminal as XTerm, type ITerminalOptions, type ITheme } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { SearchAddon } from "@xterm/addon-search";
import { SerializeAddon } from "@xterm/addon-serialize";
import { LigaturesAddon } from "@xterm/addon-ligatures";
import { ChevronDown, ChevronUp, X } from "lucide-react";
import type { UnlistenFn } from "@tauri-apps/api/event";

import { backend, isDesktop } from "@/lib/backend";
import { parseOsc7, parseOsc99, parseTitleCwd, posixCd, remoteIntegrationLine } from "@/lib/cwd";
import { terminalRegistry } from "@/lib/terminalRegistry";
import { THEMES, fontStack, type ThemeName } from "@/lib/themes";
import { useSettingsStore, type Settings } from "@/store/settingsStore";
import { connIdOf, useTabStore, type TerminalTab } from "@/store/tabStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

interface TerminalProps {
  tab: TerminalTab;
  /** Active tab of its group, i.e. on screen. */
  visible: boolean;
  /** Visible and in the focused group: receives keyboard focus. */
  focused: boolean;
}

/**
 * xterm colors for a theme. With a backdrop (pattern / image) the cell
 * background is made fully transparent (#rrggbb00) so the backdrop drawn
 * behind the terminal shows through; the rgb part still drives contrast.
 */
function terminalColors(name: ThemeName): ITheme {
  const { terminal, backdrop } = THEMES[name];
  if (!backdrop) return terminal;
  return { ...terminal, background: `${(terminal.background ?? "#000000").slice(0, 7)}00` };
}

function xtermOptions(s: Settings): ITerminalOptions {
  return {
    theme: terminalColors(s.theme),
    // Light backgrounds wash out dim ANSI colors (e.g. yellow, "white"); xterm darkens them as needed.
    minimumContrastRatio: THEMES[s.theme].dark ? 1 : 4.5,
    fontFamily: fontStack(s.fontFamily),
    fontSize: s.fontSize,
    lineHeight: s.lineHeight,
    cursorStyle: s.cursorStyle,
    cursorBlink: s.cursorBlink,
    scrollback: s.scrollback,
  };
}

/** Waits until the web font is available so xterm measures the right cell size. */
async function loadFont(s: Settings) {
  try {
    await Promise.all([
      document.fonts.load(`${s.fontSize}px "${s.fontFamily}"`),
      document.fonts.load(`bold ${s.fontSize}px "${s.fontFamily}"`),
    ]);
  } catch {
    /* fall back to whatever font is available */
  }
}

/**
 * Buffer text as logical lines: soft-wrapped rows are joined back together
 * and trailing blank rows (the unused part of the screen) are dropped.
 */
function bufferLines(term: XTerm, scope: "all" | "screen"): string[] {
  const buf = term.buffer.active;
  const start = scope === "all" ? 0 : buf.viewportY;
  const end = scope === "all" ? buf.length : Math.min(buf.length, buf.viewportY + term.rows);
  const lines: string[] = [];
  for (let y = start; y < end; y++) {
    const line = buf.getLine(y);
    if (!line) continue;
    // Keep trailing spaces of a row that continues on the next one; they belong to the text.
    const text = line.translateToString(!buf.getLine(y + 1)?.isWrapped);
    if (line.isWrapped && y > start && lines.length) lines[lines.length - 1] += text;
    else lines.push(text);
  }
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
  return lines;
}

/**
 * Coalesces keystrokes into ordered writes. Tauri runs async commands
 * concurrently, so firing one invoke per keystroke could reorder input;
 * here at most one write is in flight and the rest are batched behind it.
 */
function createInputWriter(getId: () => string) {
  let pending = "";
  let inFlight = false;
  const flush = async () => {
    if (inFlight || !pending) return;
    inFlight = true;
    const chunk = pending;
    pending = "";
    try {
      await backend.write(getId(), chunk);
    } catch {
      /* session already closed */
    } finally {
      inFlight = false;
      if (pending) void flush();
    }
  };
  return (data: string) => {
    pending += data;
    void flush();
  };
}

export function Terminal({ tab, visible, focused }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<XTerm | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const searchRef = useRef<SearchAddon | null>(null);
  const webglRef = useRef<WebglAddon | null>(null);
  const serializeRef = useRef<SerializeAddon | null>(null);
  /** Backend session id; changes on every reconnect so stale events never leak into a new session. */
  const connIdRef = useRef(connIdOf(tab));
  const statusRef = useRef(tab.status);
  statusRef.current = tab.status;

  const [ready, setReady] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  /** Ctrl+wheel zoom for this tab only; null = follow the global font size. */
  const [tabFontSize, setTabFontSize] = useState<number | null>(tab.fontSize ?? null);
  /** Short-lived status bubble (zoom size, copy result). */
  const [notice, setNotice] = useState<{ text: string } | null>(null);

  const settings = useSettingsStore();
  const fontSize = tabFontSize ?? settings.fontSize;
  /** The tab menu can give a tab its own theme; otherwise the one from settings. */
  const theme = tab.theme ?? settings.theme;
  const tabFontSizeRef = useRef(tabFontSize);
  tabFontSizeRef.current = tabFontSize;
  const fontSizeRef = useRef(fontSize);
  fontSizeRef.current = fontSize;
  const setStatus = useTabStore((s) => s.setStatus);
  const reconnectTab = useTabStore((s) => s.reconnectTab);

  const safeFit = () => {
    const el = containerRef.current;
    const fit = fitRef.current;
    if (!el || !fit || el.offsetWidth === 0 || el.offsetHeight === 0) return;
    try {
      fit.fit();
    } catch {
      /* renderer not ready yet */
    }
  };

  const enableWebgl = (term: XTerm) => {
    if (webglRef.current) return;
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => {
        webgl.dispose();
        webglRef.current = null;
      });
      term.loadAddon(webgl);
      webglRef.current = webgl;
    } catch (e) {
      console.warn("WebGL renderer unavailable, falling back to DOM renderer", e);
    }
  };

  // ── 1. xterm instance lifecycle (once per tab) ─────────────────────────────
  useEffect(() => {
    const container = containerRef.current!;
    const s = useSettingsStore.getState();
    const term = new XTerm({
      ...xtermOptions({ ...s, theme: tab.theme ?? s.theme }),
      allowProposedApi: true,
      // Needed for pattern / image themes; only settable at creation, so always on.
      allowTransparency: true,
      macOptionIsMeta: true,
      rightClickSelectsWord: false,
      // Local shells run inside ConPTY; tells xterm how the PTY wraps lines.
      windowsPty: tab.target.type === "local" ? { backend: "conpty" } : undefined,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    const serialize = new SerializeAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(serialize);
    fitRef.current = fit;
    searchRef.current = search;
    serializeRef.current = serialize;

    // Shell integration: the shell reports its folder on every prompt (lib/cwd.ts).
    // Handlers return false so xterm still processes the sequence (e.g. sets the title).
    let explicitCwd = false;
    const report = (cwd: string | null, explicit: boolean) => {
      if (!cwd) return false;
      if (explicit) explicitCwd = true;
      else if (explicitCwd) return false; // a real report beats the title guess
      useTabStore.getState().setCwd(tab.id, cwd);
      return false;
    };
    term.parser.registerOscHandler(7, (data) => report(parseOsc7(data), true));
    term.parser.registerOscHandler(9, (data) => report(parseOsc99(data), true));
    if (tab.target.type === "ssh") {
      term.parser.registerOscHandler(0, (data) => report(parseTitleCwd(data), false));
      term.parser.registerOscHandler(2, (data) => report(parseTitleCwd(data), false));
    }

    let disposed = false;
    void (async () => {
      await loadFont(s);
      if (disposed) return;
      term.open(container);
      // Ligatures must be activated before WebGL so the glyph atlas picks them up.
      if (s.ligatures) {
        try {
          term.loadAddon(new LigaturesAddon());
        } catch (e) {
          console.warn("ligatures addon failed", e);
        }
      }
      if (s.webgl) enableWebgl(term);
      termRef.current = term;
      safeFit();
      setReady(true);
    })();

    return () => {
      disposed = true;
      termRef.current = null;
      webglRef.current = null;
      fitRef.current = null;
      searchRef.current = null;
      serializeRef.current = null;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  // ── 2. User input → backend ───────────────────────────────────────────────
  useEffect(() => {
    const term = termRef.current;
    if (!ready || !term) return;

    const write = createInputWriter(() => connIdRef.current);

    const copySelection = () => {
      if (term.hasSelection()) void navigator.clipboard.writeText(term.getSelection());
    };
    const paste = async () => {
      try {
        const text = await navigator.clipboard.readText();
        if (text) term.paste(text);
      } catch (e) {
        console.warn("clipboard read failed", e);
      }
    };

    term.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown") return true;
      const ctrl = e.ctrlKey && !e.altKey && !e.metaKey;
      if (ctrl && e.shiftKey) {
        switch (e.code) {
          case "KeyC":
            copySelection();
            return false;
          case "KeyV":
            void paste();
            return false;
          case "KeyF":
            setSearchOpen(true);
            return false;
          case "KeyA":
            // With copy-on-select on, onSelectionChange copies it right away.
            term.selectAll();
            return false;
          // App-level shortcuts: let them bubble to the window handler.
          case "KeyT":
          case "KeyW":
          case "KeyB":
          case "KeyE":
          case "KeyH":
          case "KeyG":
          case "Backslash":
            return false;
        }
      }
      if (ctrl && e.code === "Tab") return false;
      if (ctrl && !e.shiftKey) {
        if (e.key === "=" || e.key === "+") {
          useSettingsStore.getState().zoom(1);
          return false;
        }
        if (e.key === "-") {
          useSettingsStore.getState().zoom(-1);
          return false;
        }
        if (e.key === "0") {
          setTabFontSize(null);
          useSettingsStore.getState().update({ fontSize: 14 });
          return false;
        }
      }
      return true;
    });

    const disposables = [
      term.onData((data) => {
        // PuTTY-style: press Enter on a dead session to reconnect.
        if (statusRef.current === "closed" || statusRef.current === "error") {
          if (data === "\r") reconnectTab(tab.id);
          return;
        }
        write(data);
      }),
      term.onBinary((data) => {
        const bytes = Array.from(data, (c) => c.charCodeAt(0) & 0xff);
        backend.writeBytes(connIdRef.current, bytes).catch(() => {});
      }),
      term.onSelectionChange(() => {
        if (useSettingsStore.getState().copyOnSelect) copySelection();
      }),
    ];

    // PuTTY-style right click: copy if something is selected, otherwise paste.
    const container = containerRef.current!;
    const onContextMenu = (e: MouseEvent) => {
      e.preventDefault();
      if (term.hasSelection()) {
        copySelection();
        term.clearSelection();
      } else {
        void paste();
      }
    };
    container.addEventListener("contextmenu", onContextMenu);

    return () => {
      disposables.forEach((d) => d.dispose());
      container.removeEventListener("contextmenu", onContextMenu);
    };
  }, [ready, tab.id, reconnectTab]);

  // ── 3. Backend connection (re-runs on reconnect) ───────────────────────────
  useEffect(() => {
    const term = termRef.current;
    if (!ready || !term) return;

    const connId = connIdOf(tab);
    connIdRef.current = connId;
    let cancelled = false;
    const unlisteners: UnlistenFn[] = [];
    // Listener registration is async; anything that resolves after cleanup is released immediately.
    const track = (unlisten: UnlistenFn) => (cancelled ? unlisten() : unlisteners.push(unlisten));
    let resizeTimer: number | undefined;

    const resizeSub = term.onResize(({ cols, rows }) => {
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        backend.resize(connId, cols, rows).catch(() => {});
      }, 50);
    });

    void (async () => {
      if (tab.generation > 0) term.write("\r\n\x1b[90m── reconnecting ──\x1b[0m\r\n");
      const restore = tab.generation === 0 ? tab.restore : undefined;
      if (restore?.snapshotId && isDesktop) {
        // Previous screen of a tab restored from session history, then a divider.
        const previous = await backend.historyLoadSnapshot(restore.snapshotId).catch(() => null);
        if (cancelled) return;
        if (previous) {
          const when = new Date(restore.snapshotAt ?? Date.now()).toLocaleString();
          term.write(previous.replace(/\r?\n/g, "\r\n"));
          term.write(`\x1b[0m\r\n\x1b[90m── 이전 세션 기록 (${when}) ── 여기부터 새 세션 ──\x1b[0m\r\n`);
          void backend.historyDeleteSnapshots([restore.snapshotId], false);
        }
      }
      if (!isDesktop) {
        term.write("\x1b[33mTauri 런타임이 감지되지 않았습니다. `npm run tauri dev`로 실행하세요.\x1b[0m\r\n");
        setStatus(tab.id, "error");
        return;
      }

      // SSH: once the remote shell has printed something (its prompt), type the
      // folder reporter — plus the restored folder's `cd` — as one hidden line.
      const settingsNow = useSettingsStore.getState();
      const restoreCd = tab.target.type === "ssh" ? restore?.cwd : undefined;
      let integrationPending = tab.target.type === "ssh" && (settingsNow.sshShellIntegration || !!restoreCd);
      const sendIntegration = (delay: number) => {
        if (!integrationPending) return;
        integrationPending = false;
        window.setTimeout(() => {
          if (cancelled) return;
          const line = settingsNow.sshShellIntegration
            ? remoteIntegrationLine(term.cols, restoreCd)
            : `${posixCd(restoreCd!)}\r`;
          backend.write(connId, line).catch(() => {});
        }, delay);
      };
      track(
        await backend.onOutput(connId, (data) => {
          term.write(data);
          if (statusRef.current === "connected") sendIntegration(400);
        }),
      );
      track(
        await backend.onExit(connId, ({ code, reason }) => {
          const detail = reason ?? (code !== null ? `exit code ${code}` : "connection closed");
          term.write(`\r\n\x1b[90m[${detail}] — Enter 키를 누르면 다시 연결합니다.\x1b[0m\r\n`);
          setStatus(tab.id, "closed");
        }),
      );
      if (cancelled) return;

      safeFit();
      const { cols, rows } = term;
      const s = useSettingsStore.getState();
      const shell = tab.target.type === "local" ? tab.target.shell || s.defaultShell || undefined : undefined;

      if (s.logEnabled && (s.logOutput || s.logInput)) {
        const { target } = tab;
        const description =
          target.type === "ssh"
            ? `ssh ${target.config.username}@${target.config.host}:${target.config.port}`
            : (shell ?? "default shell");
        try {
          const files = await backend.startLog(connId, tab.title, description, {
            dir: s.logDir,
            output: s.logOutput,
            input: s.logInput,
            stripAnsi: s.logStripAnsi,
            timestamps: s.logTimestamps,
          });
          // Written straight to the screen, so this line itself is not part of the log.
          const path = files.output ?? files.input;
          if (!cancelled && path) term.write(`\x1b[90m● 로그 기록 중: ${path}\x1b[0m\r\n`);
        } catch (e) {
          if (!cancelled) term.write(`\x1b[33m⚠ 로그를 시작하지 못했습니다: ${String(e)}\x1b[0m\r\n`);
        }
        if (cancelled) return;
      }

      try {
        if (tab.target.type === "local") {
          await backend.openLocal(connId, { shell, cwd: tab.target.cwd, shellIntegration: s.shellIntegration, cols, rows });
        } else if (tab.target.type === "ssh") {
          await backend.openSsh(connId, tab.target.config, cols, rows);
          // In case the whole greeting arrived before "connected" was known.
          window.setTimeout(() => !cancelled && sendIntegration(0), 1500);
        }
        if (!cancelled) setStatus(tab.id, "connected");
      } catch (e) {
        if (cancelled) return;
        term.write(`\r\n\x1b[31m✖ ${String(e)}\x1b[0m\r\n\x1b[90mEnter 키를 누르면 다시 연결합니다.\x1b[0m\r\n`);
        setStatus(tab.id, "error");
      }
    })();

    return () => {
      cancelled = true;
      window.clearTimeout(resizeTimer);
      resizeSub.dispose();
      unlisteners.forEach((u) => u());
      backend.close(connId).catch(() => {});
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, tab.id, tab.generation]);

  // ── 4. Auto-fit on container resize ───────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!ready || !el) return;
    let frame = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(safeFit);
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(frame);
      ro.disconnect();
    };
  }, [ready]);

  // ── 4b. Ctrl+wheel zooms this tab only ────────────────────────────────────
  useEffect(() => {
    const el = containerRef.current;
    if (!ready || !el) return;
    // Mouse wheels send ~100 per notch, touchpads many small deltas: step once per WHEEL_STEP.
    const WHEEL_STEP = 50;
    let accumulated = 0;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey) return;
      // Capture phase + preventDefault: keeps xterm from scrolling and the webview from page-zooming.
      e.preventDefault();
      e.stopPropagation();
      if (Math.sign(e.deltaY) !== Math.sign(accumulated)) accumulated = 0;
      accumulated += e.deltaY;
      const steps = Math.trunc(accumulated / WHEEL_STEP);
      if (!steps) return;
      accumulated -= steps * WHEEL_STEP;
      const next = Math.min(32, Math.max(8, fontSizeRef.current - steps));
      if (next === fontSizeRef.current) return;
      fontSizeRef.current = next;
      setTabFontSize(next);
      setNotice({ text: `${next}px` });
    };
    el.addEventListener("wheel", onWheel, { capture: true, passive: false });
    return () => el.removeEventListener("wheel", onWheel, { capture: true });
  }, [ready]);

  // ── 4c. Copy actions for the tab context menu ─────────────────────────────
  useEffect(() => {
    const term = termRef.current;
    if (!ready || !term) return;
    return terminalRegistry.register(tab.id, {
      copyText: async (scope) => {
        const lines = bufferLines(term, scope);
        try {
          await navigator.clipboard.writeText(lines.join("\r\n"));
          setNotice({ text: `${lines.length}줄 복사됨` });
        } catch (e) {
          console.warn("clipboard write failed", e);
          setNotice({ text: "복사 실패" });
        }
        return lines.length;
      },
      selectAll: () => {
        term.selectAll();
        term.focus();
      },
      paste: (text) => {
        term.paste(text);
        term.focus();
      },
      serialize: (lines) =>
        serializeRef.current?.serialize({ scrollback: lines, excludeAltBuffer: true, excludeModes: true }) ?? "",
      fontSize: () => tabFontSizeRef.current,
    });
  }, [ready, tab.id]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 1200);
    return () => clearTimeout(timer);
  }, [notice]);

  // ── 5. Refit when the tab becomes visible, focus when its group is focused ──
  useEffect(() => {
    if (!ready || !visible) return;
    const frame = requestAnimationFrame(safeFit);
    return () => cancelAnimationFrame(frame);
  }, [ready, visible]);

  useEffect(() => {
    if (!ready || !focused) return;
    const frame = requestAnimationFrame(() => termRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [ready, focused]);

  // ── 6. Live settings (theme, font, cursor, renderer) ──────────────────────
  useEffect(() => {
    const term = termRef.current;
    if (!ready || !term) return;
    let stale = false;
    void (async () => {
      await loadFont(settings);
      if (stale) return;
      const { scrollback, ...rest } = xtermOptions({ ...settings, fontSize, theme });
      Object.assign(term.options, rest);
      if (term.options.scrollback !== scrollback) term.options.scrollback = scrollback;
      if (settings.webgl) enableWebgl(term);
      else if (webglRef.current) {
        webglRef.current.dispose();
        webglRef.current = null;
      }
      safeFit();
    })();
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    ready,
    theme,
    settings.fontFamily,
    fontSize,
    settings.lineHeight,
    settings.cursorStyle,
    settings.cursorBlink,
    settings.scrollback,
    settings.webgl,
  ]);

  return (
    <div className="relative h-full w-full" style={{ background: THEMES[theme].backdrop ?? THEMES[theme].terminal.background }}>
      <div ref={containerRef} className="h-full w-full" />
      {notice && (
        <div className="bg-popover/90 text-popover-foreground pointer-events-none absolute right-3 bottom-3 z-10 rounded-md border px-2.5 py-1 font-mono text-xs shadow">
          {notice.text}
        </div>
      )}
      {searchOpen && searchRef.current && (
        <SearchBar
          search={searchRef.current}
          onClose={() => {
            setSearchOpen(false);
            searchRef.current?.clearDecorations();
            termRef.current?.focus();
          }}
        />
      )}
    </div>
  );
}

function SearchBar({ search, onClose }: { search: SearchAddon; onClose: () => void }) {
  const [query, setQuery] = useState("");
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<{ index: number; count: number } | null>(null);

  useEffect(() => {
    const sub = search.onDidChangeResults(({ resultIndex, resultCount }) =>
      setResult({ index: resultIndex, count: resultCount }),
    );
    return () => sub.dispose();
  }, [search]);

  const opts = {
    caseSensitive,
    decorations: {
      matchBackground: "#ffff0040",
      activeMatchBackground: "#ff9900",
      matchOverviewRuler: "#ffff00",
      activeMatchColorOverviewRuler: "#ff9900",
    },
  };
  const next = () => query && search.findNext(query, opts);
  const prev = () => query && search.findPrevious(query, opts);

  return (
    <div className="bg-card absolute top-2 right-4 z-10 flex items-center gap-1 rounded-md border p-1 shadow-lg">
      <Input
        autoFocus
        value={query}
        placeholder="검색"
        className="h-7 w-52 font-mono text-xs"
        onChange={(e) => {
          setQuery(e.target.value);
          if (e.target.value) search.findNext(e.target.value, { ...opts, incremental: true });
          else search.clearDecorations();
        }}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.shiftKey ? prev : next)();
          if (e.key === "Escape") onClose();
        }}
      />
      <span className="text-muted-foreground w-14 text-center text-xs tabular-nums">
        {result && query ? (result.count ? `${result.index + 1}/${result.count}` : "0/0") : ""}
      </span>
      <Button
        variant={caseSensitive ? "secondary" : "ghost"}
        size="iconSm"
        title="대소문자 구분"
        onClick={() => setCaseSensitive((v) => !v)}
      >
        <span className="text-xs font-semibold">Aa</span>
      </Button>
      <Button variant="ghost" size="iconSm" title="이전 (Shift+Enter)" onClick={prev}>
        <ChevronUp />
      </Button>
      <Button variant="ghost" size="iconSm" title="다음 (Enter)" onClick={next}>
        <ChevronDown />
      </Button>
      <Button variant="ghost" size="iconSm" title="닫기 (Esc)" onClick={onClose}>
        <X />
      </Button>
    </div>
  );
}
