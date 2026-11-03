// Runs right before Tauri bundles the installer (tauri.conf.json → beforeBundleCommand).
//
// On the GNU toolchain (build-env.sh) wlt.exe links WebView2Loader.dll
// dynamically, and the bundler only ships that DLL if it sits next to the exe.
// webview2-com-sys copies it there only when its build script runs, so a
// missing copy (deleted, renamed while WLT was running, …) would silently
// produce an installer whose app can't start. Restore it, or fail the build.
import { copyFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? process.env.RUSTUP_TOOLCHAIN ?? "";
if (!triple.includes("gnu")) process.exit(0); // MSVC links the loader statically

const profile = process.env.TAURI_ENV_DEBUG === "true" ? "debug" : "release";
const outDir = join("src-tauri", "target", profile);
const dll = join(outDir, "WebView2Loader.dll");
if (existsSync(dll)) process.exit(0);

const buildDir = join(outDir, "build");
const source = (existsSync(buildDir) ? readdirSync(buildDir) : [])
  .filter((d) => d.startsWith("webview2-com-sys-"))
  .map((d) => join(buildDir, d, "out", "x64", "WebView2Loader.dll"))
  .find(existsSync);

if (!source) {
  console.error(`✖ ${dll} is missing and no webview2-com-sys copy was found. Run "cargo clean -p webview2-com-sys" and build again.`);
  process.exit(1);
}
copyFileSync(source, dll);
console.log(`✔ restored ${dll} (from ${source})`);
