import type { ITheme } from "@xterm/xterm";

export type ThemeName = "dracula" | "nord" | "oneDark" | "vscodeDark" | "light" | "solarizedLight";

export interface AppTheme {
  label: string;
  /** Dark chrome; light themes also get a higher minimum text contrast in the terminal. */
  dark: boolean;
  terminal: ITheme;
  /** shadcn/ui tokens for the surrounding chrome. */
  ui: {
    background: string;
    sidebar: string;
    card: string;
    muted: string;
    mutedForeground: string;
    accent: string;
    border: string;
    primary: string;
    primaryForeground: string;
    destructive: string;
    success: string;
    warning: string;
  };
}

export const THEMES: Record<ThemeName, AppTheme> = {
  dracula: {
    label: "Dracula",
    dark: true,
    terminal: {
      background: "#282a36",
      foreground: "#f8f8f2",
      cursor: "#f8f8f2",
      cursorAccent: "#282a36",
      selectionBackground: "#44475a",
      black: "#21222c",
      red: "#ff5555",
      green: "#50fa7b",
      yellow: "#f1fa8c",
      blue: "#bd93f9",
      magenta: "#ff79c6",
      cyan: "#8be9fd",
      white: "#f8f8f2",
      brightBlack: "#6272a4",
      brightRed: "#ff6e6e",
      brightGreen: "#69ff94",
      brightYellow: "#ffffa5",
      brightBlue: "#d6acff",
      brightMagenta: "#ff92df",
      brightCyan: "#a4ffff",
      brightWhite: "#ffffff",
    },
    ui: {
      background: "#282a36",
      sidebar: "#21222c",
      card: "#21222c",
      muted: "#343746",
      mutedForeground: "#9ea3c0",
      accent: "#44475a",
      border: "#3b3e4f",
      primary: "#bd93f9",
      primaryForeground: "#191a21",
      destructive: "#ff5555",
      success: "#50fa7b",
      warning: "#f1fa8c",
    },
  },
  nord: {
    label: "Nord",
    dark: true,
    terminal: {
      background: "#2e3440",
      foreground: "#d8dee9",
      cursor: "#d8dee9",
      cursorAccent: "#2e3440",
      selectionBackground: "#434c5e",
      black: "#3b4252",
      red: "#bf616a",
      green: "#a3be8c",
      yellow: "#ebcb8b",
      blue: "#81a1c1",
      magenta: "#b48ead",
      cyan: "#88c0d0",
      white: "#e5e9f0",
      brightBlack: "#4c566a",
      brightRed: "#bf616a",
      brightGreen: "#a3be8c",
      brightYellow: "#ebcb8b",
      brightBlue: "#81a1c1",
      brightMagenta: "#b48ead",
      brightCyan: "#8fbcbb",
      brightWhite: "#eceff4",
    },
    ui: {
      background: "#2e3440",
      sidebar: "#272c36",
      card: "#272c36",
      muted: "#3b4252",
      mutedForeground: "#a1aabb",
      accent: "#434c5e",
      border: "#3b4252",
      primary: "#88c0d0",
      primaryForeground: "#2e3440",
      destructive: "#bf616a",
      success: "#a3be8c",
      warning: "#ebcb8b",
    },
  },
  oneDark: {
    label: "One Dark",
    dark: true,
    terminal: {
      background: "#282c34",
      foreground: "#abb2bf",
      cursor: "#528bff",
      cursorAccent: "#282c34",
      selectionBackground: "#3e4451",
      black: "#282c34",
      red: "#e06c75",
      green: "#98c379",
      yellow: "#e5c07b",
      blue: "#61afef",
      magenta: "#c678dd",
      cyan: "#56b6c2",
      white: "#abb2bf",
      brightBlack: "#5c6370",
      brightRed: "#e06c75",
      brightGreen: "#98c379",
      brightYellow: "#e5c07b",
      brightBlue: "#61afef",
      brightMagenta: "#c678dd",
      brightCyan: "#56b6c2",
      brightWhite: "#ffffff",
    },
    ui: {
      background: "#282c34",
      sidebar: "#21252b",
      card: "#21252b",
      muted: "#2c313a",
      mutedForeground: "#8b929e",
      accent: "#3e4451",
      border: "#353b45",
      primary: "#61afef",
      primaryForeground: "#1e2127",
      destructive: "#e06c75",
      success: "#98c379",
      warning: "#e5c07b",
    },
  },
  vscodeDark: {
    label: "VS Code Dark",
    dark: true,
    terminal: {
      background: "#1e1e1e",
      foreground: "#cccccc",
      cursor: "#aeafad",
      cursorAccent: "#1e1e1e",
      selectionBackground: "#264f78",
      black: "#000000",
      red: "#cd3131",
      green: "#0dbc79",
      yellow: "#e5e510",
      blue: "#2472c8",
      magenta: "#bc3fbc",
      cyan: "#11a8cd",
      white: "#e5e5e5",
      brightBlack: "#666666",
      brightRed: "#f14c4c",
      brightGreen: "#23d18b",
      brightYellow: "#f5f543",
      brightBlue: "#3b8eea",
      brightMagenta: "#d670d6",
      brightCyan: "#29b8db",
      brightWhite: "#e5e5e5",
    },
    ui: {
      background: "#1e1e1e",
      sidebar: "#181818",
      card: "#252526",
      muted: "#2a2d2e",
      mutedForeground: "#9d9d9d",
      accent: "#37373d",
      border: "#2b2b2b",
      primary: "#0078d4",
      primaryForeground: "#ffffff",
      destructive: "#f14c4c",
      success: "#23d18b",
      warning: "#cca700",
    },
  },
  light: {
    label: "Light",
    dark: false,
    terminal: {
      background: "#ffffff",
      foreground: "#24292f",
      cursor: "#0969da",
      cursorAccent: "#ffffff",
      selectionBackground: "#b6d7ff",
      black: "#24292f",
      red: "#cf222e",
      green: "#116329",
      yellow: "#7d4e00",
      blue: "#0969da",
      magenta: "#8250df",
      cyan: "#1b7c83",
      white: "#6e7781",
      brightBlack: "#57606a",
      brightRed: "#a40e26",
      brightGreen: "#1a7f37",
      brightYellow: "#633c01",
      brightBlue: "#218bff",
      brightMagenta: "#a475f9",
      brightCyan: "#3192aa",
      brightWhite: "#8c959f",
    },
    ui: {
      background: "#ffffff",
      sidebar: "#f6f8fa",
      card: "#ffffff",
      muted: "#eaeef2",
      mutedForeground: "#57606a",
      accent: "#e7ecf0",
      border: "#d0d7de",
      primary: "#0969da",
      primaryForeground: "#ffffff",
      destructive: "#cf222e",
      success: "#1a7f37",
      warning: "#9a6700",
    },
  },
  solarizedLight: {
    label: "Solarized Light",
    dark: false,
    terminal: {
      background: "#fdf6e3",
      foreground: "#586e75",
      cursor: "#586e75",
      cursorAccent: "#fdf6e3",
      selectionBackground: "#e0d8c0",
      black: "#073642",
      red: "#dc322f",
      green: "#859900",
      yellow: "#b58900",
      blue: "#268bd2",
      magenta: "#d33682",
      cyan: "#2aa198",
      white: "#93a1a1",
      brightBlack: "#002b36",
      brightRed: "#cb4b16",
      brightGreen: "#586e75",
      brightYellow: "#657b83",
      brightBlue: "#839496",
      brightMagenta: "#6c71c4",
      brightCyan: "#93a1a1",
      brightWhite: "#eee8d5",
    },
    ui: {
      background: "#fdf6e3",
      sidebar: "#eee8d5",
      card: "#fdf6e3",
      muted: "#e9e2cc",
      mutedForeground: "#6c7f86",
      accent: "#e4ddc8",
      border: "#ddd6c1",
      primary: "#268bd2",
      primaryForeground: "#ffffff",
      destructive: "#dc322f",
      success: "#859900",
      warning: "#b58900",
    },
  },
};

/**
 * Terminal fonts. Bundled ones ship with the app (see main.tsx); system ones
 * come with Windows (D2Coding only if the user installed it).
 */
export const FONTS = [
  { name: "JetBrains Mono", bundled: true },
  { name: "Cascadia Code", bundled: true },
  { name: "Fira Code", bundled: true },
  { name: "Source Code Pro", bundled: true },
  { name: "IBM Plex Mono", bundled: true },
  { name: "Roboto Mono", bundled: true },
  { name: "Ubuntu Mono", bundled: true },
  { name: "Inconsolata", bundled: true },
  { name: "Victor Mono", bundled: true },
  { name: "Consolas", bundled: false },
  { name: "Cascadia Mono", bundled: false },
  { name: "Courier New", bundled: false },
  { name: "Lucida Console", bundled: false },
  { name: "D2Coding", bundled: false },
] as const;
export type FontFamily = (typeof FONTS)[number]["name"];

/** CSS font stack with Korean-capable fallbacks for CJK glyphs. */
export function fontStack(font: FontFamily): string {
  return `"${font}", "Cascadia Mono", Consolas, "D2Coding", "Malgun Gothic", monospace`;
}

/** Pushes the theme's UI palette into the shadcn CSS variables. */
export function applyUiTheme(name: ThemeName) {
  const { ui, terminal, dark } = THEMES[name];
  const vars: Record<string, string> = {
    "--background": ui.background,
    "--foreground": terminal.foreground ?? "#ffffff",
    "--card": ui.card,
    "--card-foreground": terminal.foreground ?? "#ffffff",
    "--popover": ui.card,
    "--popover-foreground": terminal.foreground ?? "#ffffff",
    "--primary": ui.primary,
    "--primary-foreground": ui.primaryForeground,
    "--secondary": ui.muted,
    "--secondary-foreground": terminal.foreground ?? "#ffffff",
    "--muted": ui.muted,
    "--muted-foreground": ui.mutedForeground,
    "--accent": ui.accent,
    "--accent-foreground": terminal.foreground ?? "#ffffff",
    "--destructive": ui.destructive,
    "--border": ui.border,
    "--input": ui.border,
    "--ring": ui.primary,
    "--sidebar": ui.sidebar,
    "--success": ui.success,
    "--warning": ui.warning,
  };
  const root = document.documentElement;
  for (const [k, v] of Object.entries(vars)) root.style.setProperty(k, v);
  // Native controls (scrollbars, inputs) follow `color-scheme`; `dark:` variants follow the class.
  root.classList.toggle("dark", dark);
  root.style.colorScheme = dark ? "dark" : "light";
}
