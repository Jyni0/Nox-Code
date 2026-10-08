/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const pkg = JSON.parse(readFileSync(path.resolve(import.meta.dirname, "package.json"), "utf8")) as { version: string; repository?: string | { url: string } };
const git = (cmd: string) => {
  try {
    return execSync(`git ${cmd}`, { cwd: import.meta.dirname, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    return "";
  }
};
// owner/name on GitHub: package.json "repository", else the origin remote.
const repoUrl = (typeof pkg.repository === "string" ? pkg.repository : pkg.repository?.url) || git("remote get-url origin");
const repo = /github\.com[/:]([^/]+\/[^/.]+?)(?:\.git)?\/?$/.exec(repoUrl)?.[1] ?? "";

const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // What "Check for Updates" compares against the main branch on GitHub.
  define: {
    __APP_VERSION__: JSON.stringify(pkg.version),
    __BUILD_SHA__: JSON.stringify(git("rev-parse HEAD")),
    __BUILD_BRANCH__: JSON.stringify(git("rev-parse --abbrev-ref HEAD") || "main"),
    __REPO__: JSON.stringify(repo),
  },
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  clearScreen: false,
  server: {
    port: 1439,
    strictPort: true,
    host: host || false,
    hmr: host ? { protocol: "ws", host, port: 1431 } : undefined,
    watch: { ignored: ["**/src-tauri/**"] },
  },
  build: { target: "es2022", chunkSizeWarningLimit: 4000 },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["src/tests/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
  },
});
