#!/usr/bin/env bash
# Build environment for machines WITHOUT Visual Studio Build Tools:
# uses the Rust GNU toolchain + LLVM-MinGW (winget: MartinStorsjo.LLVM-MinGW.MSVCRT).
# Usage:  source ./build-env.sh && npm run tauri build
# (With VS Build Tools installed, skip this file and build with the default MSVC toolchain.)
MINGW_DIR=$(ls -d "$(cygpath -u "$LOCALAPPDATA")"/Microsoft/WinGet/Packages/MartinStorsjo.LLVM-MinGW.MSVCRT*/llvm-mingw-*-msvcrt-x86_64 2>/dev/null | head -1)
if [ -z "$MINGW_DIR" ]; then
  echo "LLVM-MinGW not found: winget install MartinStorsjo.LLVM-MinGW.MSVCRT" >&2
  return 1 2>/dev/null || exit 1
fi

# rustc's windows-gnu target links -lgcc / -lgcc_eh, which llvm-mingw replaces with
# compiler-rt (added by the clang driver) and libunwind. Provide stand-ins.
SHIM_DIR="$HOME/.cargo/llvm-mingw-shim"
if [ ! -f "$SHIM_DIR/libgcc_eh.a" ]; then
  mkdir -p "$SHIM_DIR"
  cp "$MINGW_DIR/x86_64-w64-mingw32/lib/libunwind.a" "$SHIM_DIR/libgcc_eh.a"
  printf '!<arch>\n' > "$SHIM_DIR/libgcc.a"
fi

export PATH="$HOME/.cargo/bin:$MINGW_DIR/bin:$PATH"
export RUSTUP_TOOLCHAIN=stable-x86_64-pc-windows-gnu
export RUSTFLAGS="-L native=$(cygpath -w "$SHIM_DIR")"
echo "Rust: $(rustc --version)  |  C: $(x86_64-w64-mingw32-gcc --version | head -1)"
