import React from "react";
import ReactDOM from "react-dom/client";
import "@xterm/xterm/css/xterm.css";
import "./styles/index.css";
import { initBackend } from "./lib/backend";
import { App } from "./app/App";

// Settings, session and recent commands saved before the rename to Nox Code.
try {
  for (const key of ["settings", "session", "recentCommands"]) {
    const old = localStorage.getItem(`tachyon.${key}`);
    if (old !== null && localStorage.getItem(`nox.${key}`) === null) {
      localStorage.setItem(`nox.${key}`, old.replace(/"tachyon-(dark|light)"/g, '"nox-$1"'));
    }
    localStorage.removeItem(`tachyon.${key}`);
  }
} catch {
  /* storage unavailable */
}

// The default context menu ("Back / Reload / Inspect") does not belong in an
// editor: the code and the terminal never show it (the code has its own menu).
// Plain text fields keep it for cut / copy / paste.
window.addEventListener("contextmenu", (e) => {
  const t = e.target as HTMLElement;
  if (t.closest(".cm-editor, .xterm") || !t.closest("input, textarea, .selectable")) e.preventDefault();
});

void initBackend().then(() => {
  ReactDOM.createRoot(document.getElementById("root")!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
});
