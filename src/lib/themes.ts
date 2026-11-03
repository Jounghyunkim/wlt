import type { ITheme } from "@xterm/xterm";

export type ThemeName =
  | "dracula"
  | "nord"
  | "oneDark"
  | "vscodeDark"
  | "light"
  | "solarizedLight"
  | "synthwave"
  | "starryNight"
  | "blueprint"
  | "hanji";

export interface AppTheme {
  label: string;
  /** Dark chrome; light themes also get a higher minimum text contrast in the terminal. */
  dark: boolean;
  /**
   * CSS `background` drawn behind the terminal text (pattern / image). The
   * terminal itself is then transparent; `terminal.background` stays the base
   * color for contrast and the editor.
   */
  backdrop?: string;
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

// ── Backdrops (patterns / images behind the terminal text) ──────────────────
// Drawn with CSS gradients and inline SVG: no image files (offline, no
// licensing), and they stay sharp at any window size. Kept low-contrast so the
// text stays readable. Star / fiber positions come from a fixed seed so they
// look the same on every start.

function seeded(seed: number) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const svgUrl = (svg: string) => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

/** Neon grid fading into a purple horizon glow. */
const SYNTHWAVE_BACKDROP = [
  "linear-gradient(to bottom, rgba(26,16,51,0) 55%, rgba(255,62,165,0.10) 100%)",
  "repeating-linear-gradient(to bottom, rgba(255,62,165,0.07) 0 1px, transparent 1px 44px)",
  "repeating-linear-gradient(to right, rgba(3,237,249,0.06) 0 1px, transparent 1px 44px)",
  "radial-gradient(ellipse 120% 60% at 50% 115%, #5a1f7a 0%, rgba(26,16,51,0) 70%)",
  "#1a1033",
].join(", ");

/** Night sky: stars, a moon, and two mountain ridges along the bottom. */
const STARRY_NIGHT_BACKDROP = (() => {
  const rand = seeded(7);
  const stars = Array.from({ length: 160 }, () => {
    const r = 0.5 + rand() * 1.3;
    return `<circle cx="${(rand() * 1600).toFixed(1)}" cy="${(rand() * 760).toFixed(1)}" r="${r.toFixed(2)}" fill="#fff" opacity="${(0.25 + rand() * 0.6).toFixed(2)}"/>`;
  }).join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 1000" preserveAspectRatio="xMidYMax slice">` +
    `<defs><radialGradient id="sky" cx="0.75" cy="0.1" r="1.1"><stop offset="0" stop-color="#1c2a5c"/><stop offset="0.55" stop-color="#0d1430"/><stop offset="1" stop-color="#070b1d"/></radialGradient>` +
    `<radialGradient id="glow"><stop offset="0" stop-color="#fdf3c4" stop-opacity="0.18"/><stop offset="1" stop-color="#fdf3c4" stop-opacity="0"/></radialGradient></defs>` +
    `<rect width="1600" height="1000" fill="url(#sky)"/>${stars}` +
    `<circle cx="1290" cy="170" r="120" fill="url(#glow)"/><circle cx="1290" cy="170" r="40" fill="#fbf1cc" opacity="0.85"/>` +
    `<path d="M0 820 L180 700 L320 770 L520 640 L700 760 L880 680 L1060 790 L1260 660 L1440 760 L1600 700 L1600 1000 L0 1000Z" fill="#0d1534"/>` +
    `<path d="M0 900 L220 800 L420 870 L640 780 L860 880 L1080 800 L1300 890 L1600 810 L1600 1000 L0 1000Z" fill="#070b1d"/>` +
    `</svg>`;
  return `${svgUrl(svg)} center bottom / cover no-repeat, #0b1026`;
})();

/** Engineering drawing grid: fine 20px lines, stronger every 100px. */
const BLUEPRINT_BACKDROP = [
  "repeating-linear-gradient(to right, rgba(255,255,255,0.13) 0 1px, transparent 1px 100px)",
  "repeating-linear-gradient(to bottom, rgba(255,255,255,0.13) 0 1px, transparent 1px 100px)",
  "repeating-linear-gradient(to right, rgba(255,255,255,0.05) 0 1px, transparent 1px 20px)",
  "repeating-linear-gradient(to bottom, rgba(255,255,255,0.05) 0 1px, transparent 1px 20px)",
  "radial-gradient(ellipse at 50% 35%, #15528c 0%, #0f3d6e 70%)",
].join(", ");

/** Korean mulberry paper: fine grain plus a few long fibers. */
const HANJI_BACKDROP = (() => {
  const noise =
    `<svg xmlns="http://www.w3.org/2000/svg" width="240" height="240">` +
    `<filter id="n"><feTurbulence type="fractalNoise" baseFrequency="0.85" numOctaves="3" stitchTiles="stitch"/>` +
    `<feColorMatrix values="0 0 0 0 0.42  0 0 0 0 0.33  0 0 0 0 0.20  0 0 0 0.11 0"/></filter>` +
    `<rect width="240" height="240" filter="url(#n)"/></svg>`;
  const rand = seeded(11);
  const fibers = Array.from({ length: 26 }, () => {
    const x = rand() * 480;
    const y = rand() * 480;
    const len = 40 + rand() * 110;
    const a = rand() * Math.PI;
    const [dx, dy] = [Math.cos(a) * len, Math.sin(a) * len];
    const bend = (rand() - 0.5) * 30;
    return `<path d="M${x.toFixed(0)} ${y.toFixed(0)} q${(dx / 2 + bend).toFixed(0)} ${(dy / 2 - bend).toFixed(0)} ${dx.toFixed(0)} ${dy.toFixed(0)}" stroke="#8a6d45" stroke-width="${(0.4 + rand() * 0.7).toFixed(2)}" fill="none" opacity="${(0.08 + rand() * 0.12).toFixed(2)}"/>`;
  }).join("");
  const fiberSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="480">${fibers}</svg>`;
  return `${svgUrl(fiberSvg)} repeat, ${svgUrl(noise)} repeat, radial-gradient(ellipse at 50% 25%, #f9f4e8 0%, #efe5cf 100%)`;
})();

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
  synthwave: {
    label: "Synthwave",
    dark: true,
    backdrop: SYNTHWAVE_BACKDROP,
    terminal: {
      background: "#1a1033",
      foreground: "#f4e9ff",
      cursor: "#ff3ea5",
      cursorAccent: "#1a1033",
      selectionBackground: "#ff3ea555",
      black: "#2a1f4a",
      red: "#fe4450",
      green: "#72f1b8",
      yellow: "#fede5d",
      blue: "#36f9f6",
      magenta: "#ff7edb",
      cyan: "#03edf9",
      white: "#e8dfff",
      brightBlack: "#6d5a99",
      brightRed: "#ff6b7a",
      brightGreen: "#9cffd3",
      brightYellow: "#fff08a",
      brightBlue: "#7dfcfa",
      brightMagenta: "#ffa6e9",
      brightCyan: "#7af6ff",
      brightWhite: "#ffffff",
    },
    ui: {
      background: "#1a1033",
      sidebar: "#140c29",
      card: "#21153f",
      muted: "#2a1c4d",
      mutedForeground: "#a593c9",
      accent: "#38265f",
      border: "#33235a",
      primary: "#ff3ea5",
      primaryForeground: "#1a1033",
      destructive: "#fe4450",
      success: "#72f1b8",
      warning: "#fede5d",
    },
  },
  starryNight: {
    label: "Starry Night",
    dark: true,
    backdrop: STARRY_NIGHT_BACKDROP,
    terminal: {
      background: "#0b1026",
      foreground: "#dfe6ff",
      cursor: "#ffd479",
      cursorAccent: "#0b1026",
      selectionBackground: "#3d4f8a99",
      black: "#1b2240",
      red: "#ff7a90",
      green: "#8fe3a8",
      yellow: "#ffd479",
      blue: "#7aa7ff",
      magenta: "#c79bff",
      cyan: "#7fdcff",
      white: "#d6ddf5",
      brightBlack: "#5a6694",
      brightRed: "#ff9fb0",
      brightGreen: "#b2f0c4",
      brightYellow: "#ffe3a3",
      brightBlue: "#a3c3ff",
      brightMagenta: "#dcbfff",
      brightCyan: "#a8e9ff",
      brightWhite: "#ffffff",
    },
    ui: {
      background: "#0b1026",
      sidebar: "#080c1e",
      card: "#121a38",
      muted: "#18214a",
      mutedForeground: "#8f9cc8",
      accent: "#222d5c",
      border: "#1f2950",
      primary: "#ffd479",
      primaryForeground: "#0b1026",
      destructive: "#ff7a90",
      success: "#8fe3a8",
      warning: "#ffd479",
    },
  },
  blueprint: {
    label: "Blueprint",
    dark: true,
    backdrop: BLUEPRINT_BACKDROP,
    terminal: {
      background: "#0f3d6e",
      foreground: "#eaf4ff",
      cursor: "#ffffff",
      cursorAccent: "#0f3d6e",
      selectionBackground: "#ffffff40",
      black: "#0a2a4d",
      red: "#ff8a80",
      green: "#a5f2c0",
      yellow: "#ffe38a",
      blue: "#9fd0ff",
      magenta: "#f0b3ff",
      cyan: "#8ff0ff",
      white: "#dbeaff",
      brightBlack: "#6f95c2",
      brightRed: "#ffb1aa",
      brightGreen: "#c6f8d6",
      brightYellow: "#fff0b8",
      brightBlue: "#c4e3ff",
      brightMagenta: "#f6d1ff",
      brightCyan: "#bdf6ff",
      brightWhite: "#ffffff",
    },
    ui: {
      background: "#0f3d6e",
      sidebar: "#0b3159",
      card: "#124677",
      muted: "#16507f",
      mutedForeground: "#a9c6e6",
      accent: "#1d5c90",
      border: "#2a6599",
      primary: "#ffffff",
      primaryForeground: "#0f3d6e",
      destructive: "#ff8a80",
      success: "#a5f2c0",
      warning: "#ffe38a",
    },
  },
  hanji: {
    label: "Hanji (한지)",
    dark: false,
    backdrop: HANJI_BACKDROP,
    terminal: {
      background: "#f3ecdc",
      foreground: "#3b2f23",
      cursor: "#a0522d",
      cursorAccent: "#f3ecdc",
      selectionBackground: "#c9a97a66",
      black: "#3b2f23",
      red: "#b03a2e",
      green: "#4f7a28",
      yellow: "#9a6b00",
      blue: "#2e5c8a",
      magenta: "#8a3c78",
      cyan: "#2a7a78",
      white: "#7d6e5b",
      brightBlack: "#6b5b48",
      brightRed: "#c9523f",
      brightGreen: "#679a38",
      brightYellow: "#b88200",
      brightBlue: "#3f74a8",
      brightMagenta: "#a54d91",
      brightCyan: "#349693",
      brightWhite: "#9c8b74",
    },
    ui: {
      background: "#f3ecdc",
      sidebar: "#ebe2cd",
      card: "#f7f1e4",
      muted: "#e5dac2",
      mutedForeground: "#7a6a55",
      accent: "#e0d3b6",
      border: "#d8cbaf",
      primary: "#a0522d",
      primaryForeground: "#ffffff",
      destructive: "#b03a2e",
      success: "#4f7a28",
      warning: "#9a6b00",
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
