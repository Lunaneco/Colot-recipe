import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// macOS Seatbelt blocks FSEvents, so Codex previews need polling for HMR.
const isCodexSeatbeltSandbox = process.env.CODEX_SANDBOX === "seatbelt";

export default defineConfig(({ command }) => ({
  // GitHub Pages serves project sites below /<repository>/.
  base:
    process.env.VITE_BASE_PATH ??
    (command === "build" ? "/Colot-recipe/" : "/"),
  server: isCodexSeatbeltSandbox
    ? { watch: { useFsEvents: false, usePolling: true } }
    : undefined,
  plugins: [react()],
}));
