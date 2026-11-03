import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ExternalLink, Loader2, RotateCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isDesktop } from "@/lib/backend";
import { fsApi, type TextEncoding } from "@/lib/fs";
import { THEMES, fontStack, type ThemeName } from "@/lib/themes";
import { useExplorerStore } from "@/store/explorerStore";
import { useSettingsStore } from "@/store/settingsStore";
import { useTabStore, type TerminalTab } from "@/store/tabStore";

type Monaco = typeof import("@/lib/monaco");
type CodeEditor = ReturnType<Monaco["editor"]["create"]>;
type TextModel = ReturnType<Monaco["editor"]["createModel"]>;

// Monaco is a few MB: load it the first time an editor opens, not at startup.
let monacoPromise: Promise<Monaco> | null = null;
const loadMonaco = () => (monacoPromise ??= import("@/lib/monaco"));

/** Open editors, so the tab menu can save them. */
export const editorRegistry = new Map<string, { save: () => Promise<void> }>();

const ENCODING_LABEL: Record<TextEncoding, string> = { "utf-8": "UTF-8", "utf-8-bom": "UTF-8 with BOM", "euc-kr": "EUC-KR" };
const ENCODINGS: TextEncoding[] = ["utf-8", "utf-8-bom", "euc-kr"];

/** One Monaco theme for every editor, derived from the app theme. */
function applyTheme(monaco: Monaco, name: ThemeName) {
  const { terminal: t, ui, dark } = THEMES[name];
  monaco.editor.defineTheme("wlt", {
    base: dark ? "vs-dark" : "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.background": t.background ?? ui.background,
      "editor.foreground": t.foreground ?? "#ffffff",
      "editorCursor.foreground": t.cursor ?? ui.primary,
      "editor.selectionBackground": t.selectionBackground ?? ui.accent,
      "editorLineNumber.foreground": ui.mutedForeground,
      "editorLineNumber.activeForeground": t.foreground ?? "#ffffff",
      "editor.lineHighlightBackground": `${ui.muted}80`,
      "editorWidget.background": ui.card,
      "editorWidget.border": ui.border,
      "minimap.background": t.background ?? ui.background,
      "scrollbarSlider.background": `${ui.mutedForeground}33`,
    },
  });
  monaco.editor.setTheme("wlt");
}

type LoadState =
  | { status: "loading" }
  | { status: "ready" }
  /** `external`: binary or too large — offer to open it with another app. */
  | { status: "error"; message: string; external: boolean };

interface Status {
  line: number;
  column: number;
  eol: "LF" | "CRLF";
  language: string;
}

/** VS Code style editor for a text file (local or over SFTP), shown in a tab. */
export function EditorPane({ tab, visible, focused }: { tab: TerminalTab; visible: boolean; focused: boolean }) {
  const target = tab.target as Extract<TerminalTab["target"], { type: "editor" }>;
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<CodeEditor | null>(null);
  const modelRef = useRef<TextModel | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  /** Encoding and modified time as last loaded / saved. */
  const fileRef = useRef<{ encoding: TextEncoding; modified: number | null }>({ encoding: "utf-8", modified: null });
  const savedVersionRef = useRef(0);
  const savedEncodingRef = useRef<TextEncoding>("utf-8");

  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [reloadKey, setReloadKey] = useState(0);
  const [status, setStatus] = useState<Status>({ line: 1, column: 1, eol: "LF", language: "" });
  const [encoding, setEncoding] = useState<TextEncoding>("utf-8");
  const [notice, setNotice] = useState<{ text: string; error?: boolean } | null>(null);
  const [saving, setSaving] = useState(false);

  const settings = useSettingsStore();
  const setDirty = useTabStore((s) => s.setDirty);

  const updateDirty = useCallback(() => {
    const model = modelRef.current;
    if (!model) return;
    setDirty(
      tab.id,
      model.getAlternativeVersionId() !== savedVersionRef.current || fileRef.current.encoding !== savedEncodingRef.current,
    );
  }, [setDirty, tab.id]);

  const save = useCallback(
    async (force = false): Promise<void> => {
      const model = modelRef.current;
      if (!model || !isDesktop) return;
      const version = model.getAlternativeVersionId();
      const file = fileRef.current;
      setSaving(true);
      try {
        // getValue() keeps the file's line endings (the model's EOL).
        file.modified = await fsApi.writeText(target.fs, target.path, model.getValue(), file.encoding, file.modified, force);
        savedVersionRef.current = version;
        savedEncodingRef.current = file.encoding;
        updateDirty();
        setNotice({ text: "저장됨" });
      } catch (e) {
        const message = String(e);
        if (message.startsWith("CONFLICT") && confirm("다른 프로그램에서 이 파일이 바뀌었습니다.\n지금 편집한 내용으로 덮어쓸까요?")) {
          return save(true);
        }
        setNotice({ text: `저장 실패: ${message}`, error: true });
      } finally {
        setSaving(false);
      }
    },
    [target.fs, target.path, updateDirty],
  );
  const saveRef = useRef(save);
  saveRef.current = save;

  // ── Load the file and create the editor ───────────────────────────────────
  useEffect(() => {
    let disposed = false;
    let editor: CodeEditor | null = null;
    let model: TextModel | null = null;
    setLoad({ status: "loading" });

    void (async () => {
      try {
        const [monaco, file] = await Promise.all([loadMonaco(), fsApi.readText(target.fs, target.path)]);
        if (disposed || !containerRef.current) return;
        monacoRef.current = monaco;
        applyTheme(monaco, useSettingsStore.getState().theme);

        // The file name in the URI lets Monaco pick the language (extension, or names like Dockerfile).
        const name = target.path.split(/[\\/]/).filter(Boolean).at(-1) ?? "file";
        const uri = monaco.Uri.from({ scheme: "wlt", path: `/${tab.id}/${name}` });
        monaco.editor.getModel(uri)?.dispose();
        model = monaco.editor.createModel(file.content, undefined, uri);
        const s = useSettingsStore.getState();
        editor = monaco.editor.create(containerRef.current, {
          model,
          theme: "wlt",
          automaticLayout: true,
          fontFamily: fontStack(s.fontFamily),
          fontSize: s.fontSize,
          fontLigatures: s.ligatures,
          minimap: { enabled: true },
          mouseWheelZoom: true,
          scrollBeyondLastLine: false,
          smoothScrolling: true,
          renderWhitespace: "selection",
          fixedOverflowWidgets: true,
          // Korean text would otherwise be flagged as "ambiguous" characters.
          unicodeHighlight: { ambiguousCharacters: false, invisibleCharacters: false },
        });

        fileRef.current = { encoding: file.encoding, modified: file.modified };
        savedVersionRef.current = model.getAlternativeVersionId();
        savedEncodingRef.current = file.encoding;
        setEncoding(file.encoding);
        const language = monaco.languages.getLanguages().find((l) => l.id === model!.getLanguageId());
        const eolOf = (m: TextModel) => (m.getEOL() === "\r\n" ? "CRLF" : "LF") as Status["eol"];
        setStatus({ line: 1, column: 1, eol: eolOf(model), language: language?.aliases?.[0] ?? model.getLanguageId() });

        model.onDidChangeContent(() => {
          updateDirty();
          setStatus((st) => ({ ...st, eol: eolOf(model!) }));
        });
        editor.onDidChangeCursorPosition((e) =>
          setStatus((st) => ({ ...st, line: e.position.lineNumber, column: e.position.column })),
        );
        editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void saveRef.current());
        editor.addAction({
          id: "wlt.toggleWordWrap",
          label: "줄 바꿈 전환 (Word Wrap)",
          keybindings: [monaco.KeyMod.Alt | monaco.KeyCode.KeyZ],
          run: (ed) => ed.updateOptions({ wordWrap: ed.getRawOptions().wordWrap === "on" ? "off" : "on" }),
        });
        editorRef.current = editor;
        modelRef.current = model;
        setLoad({ status: "ready" });
      } catch (e) {
        if (disposed) return;
        const message = String(e);
        const external = message.startsWith("BINARY") || message.startsWith("TOO_LARGE");
        setLoad({
          status: "error",
          external,
          message: message.startsWith("BINARY")
            ? "텍스트가 아닌 파일(바이너리)이라 편집기로 열 수 없습니다."
            : message.startsWith("TOO_LARGE")
              ? `파일이 너무 커서(${message.split(":")[1]?.trim()}) 편집기로 열 수 없습니다. (최대 10MB)`
              : message,
        });
      }
    })();

    return () => {
      disposed = true;
      editor?.dispose();
      model?.dispose();
      editorRef.current = null;
      modelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id, reloadKey]);

  useEffect(() => {
    editorRegistry.set(tab.id, { save: () => saveRef.current() });
    return () => void editorRegistry.delete(tab.id);
  }, [tab.id]);

  // ── Live settings ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (monacoRef.current) applyTheme(monacoRef.current, settings.theme);
  }, [settings.theme, load.status]);

  useEffect(() => {
    editorRef.current?.updateOptions({
      fontFamily: fontStack(settings.fontFamily),
      fontSize: settings.fontSize,
      fontLigatures: settings.ligatures,
    });
  }, [settings.fontFamily, settings.fontSize, settings.ligatures, load.status]);

  // Jump to a requested place (search result), once the file is loaded.
  const reveal = tab.reveal;
  useEffect(() => {
    const editor = editorRef.current;
    if (!reveal || !editor || load.status !== "ready") return;
    const { line, column, length } = reveal;
    const range = { startLineNumber: line, startColumn: column, endLineNumber: line, endColumn: column + length };
    editor.setSelection(range);
    editor.revealRangeInCenter(range);
    requestAnimationFrame(() => editor.focus());
  }, [reveal?.at, load.status]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!focused || load.status !== "ready") return;
    const frame = requestAnimationFrame(() => editorRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focused, load.status, visible]);

  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), notice.error ? 6000 : 1500);
    return () => clearTimeout(timer);
  }, [notice]);

  const toggleEol = () => {
    const monaco = monacoRef.current;
    const model = modelRef.current;
    if (!monaco || !model) return;
    const { EndOfLineSequence } = monaco.editor;
    model.pushEOL(status.eol === "LF" ? EndOfLineSequence.CRLF : EndOfLineSequence.LF);
  };

  const cycleEncoding = () => {
    const next = ENCODINGS[(ENCODINGS.indexOf(encoding) + 1) % ENCODINGS.length];
    fileRef.current.encoding = next;
    setEncoding(next);
    updateDirty();
  };

  const openExternally = () => {
    if (target.fs.kind === "local") void fsApi.open(target.path);
    else void useExplorerStore.getState().editRemote(target.fs, target.path);
  };

  const where = target.fs.kind === "local" ? "로컬" : "SFTP";

  return (
    <div className="flex h-full w-full flex-col" style={{ background: THEMES[settings.theme].terminal.background }}>
      <div ref={containerRef} className="relative min-h-0 flex-1">
        {load.status === "loading" && (
          <div className="text-muted-foreground absolute inset-0 flex items-center justify-center gap-2 text-sm">
            <Loader2 className="size-4 animate-spin" />
            불러오는 중…
          </div>
        )}
        {load.status === "error" && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-8 text-center text-sm">
            <AlertTriangle className="text-warning size-8" strokeWidth={1.5} />
            <p className="max-w-md break-words">{load.message}</p>
            <p className="text-muted-foreground font-mono text-xs">{target.path}</p>
            <div className="flex gap-2">
              {load.external ? (
                <Button size="sm" onClick={openExternally}>
                  <ExternalLink />
                  외부 프로그램으로 열기
                </Button>
              ) : (
                <Button size="sm" onClick={() => setReloadKey((k) => k + 1)}>
                  <RotateCw />
                  다시 시도
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => useTabStore.getState().closeTab(tab.id)}>
                <X />탭 닫기
              </Button>
            </div>
          </div>
        )}
      </div>

      {/* Status bar (VS Code style). */}
      <div className="bg-sidebar text-muted-foreground flex h-[22px] shrink-0 items-center gap-3 border-t px-2 text-[11px] select-none">
        <span className="min-w-0 flex-1 truncate font-mono" title={target.path}>
          {where} · {target.path}
        </span>
        {notice && <span className={notice.error ? "text-destructive truncate" : "text-success"}>{notice.text}</span>}
        {saving && <Loader2 className="size-3 animate-spin" />}
        {load.status === "ready" && (
          <>
            <span className="shrink-0 tabular-nums">
              줄 {status.line}, 열 {status.column}
            </span>
            <button className="hover:text-foreground shrink-0" title="인코딩 바꾸기 (저장할 때 적용)" onClick={cycleEncoding}>
              {ENCODING_LABEL[encoding]}
            </button>
            <button className="hover:text-foreground shrink-0" title="줄 끝 문자 바꾸기" onClick={toggleEol}>
              {status.eol}
            </button>
            <span className="shrink-0">{status.language}</span>
          </>
        )}
      </div>
    </div>
  );
}
