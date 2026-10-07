/** The sample project the browser build opens — a little of every language. */

export const DEMO_ROOT = "/demo/nox-playground";

const README = `# Nox Code Playground

Welcome to **Nox Code** — a code editor for the night shift.

> A tachyon is a hypothetical particle that always travels faster than light.
> This editor tries to keep up.

## Try this

- Press \`Ctrl+P\` to jump to any file
- Press \`Ctrl+Shift+P\` for every command
- Press \`Ctrl+\\\\\` to split the editor
- Press \`Ctrl+\`\` for the terminal
- Open **Settings → Appearance** and build your own theme

| Shortcut | Action |
| --- | --- |
| \`Ctrl+S\` | Save |
| \`Ctrl+B\` | Toggle sidebar |
| \`Shift+Alt+F\` | Format document |

- [x] Syntax highlighting for 30+ languages
- [x] Themes, icon themes, extensions
- [ ] Warp drive
`;

const MAIN_TS = `import { Particle, lightSpeed } from "./physics/particle";
import { render } from "./ui/render";

// TODO: replace the constant with a measured value
const SPEED_OF_LIGHT = 299_792_458; // m/s

export interface Tachyon extends Particle {
  /** Always greater than one — that is the whole point. */
  readonly velocityRatio: number;
  imaginaryMass: boolean;
}

export function createTachyon(energy: number): Tachyon {
  // FIXME: energy below zero should throw
  const velocityRatio = Math.sqrt(1 + (1 / Math.max(energy, 1e-9)) ** 2);
  return {
    id: crypto.randomUUID(),
    name: "tachyon",
    velocityRatio,
    imaginaryMass: true,
    speed: () => velocityRatio * SPEED_OF_LIGHT,
  };
}

const swarm = Array.from({ length: 12 }, (_, i) => createTachyon(i + 1));
const fastest = swarm.reduce((a, b) => (a.velocityRatio > b.velocityRatio ? a : b));

console.log(\`Fastest tachyon: \${fastest.speed().toFixed(0)} m/s\`, lightSpeed());
render(document.querySelector("#app")!, swarm);
`;

const PARTICLE_TS = `export interface Particle {
  id: string;
  name: string;
  speed(): number;
}

export const lightSpeed = (): number => 299_792_458;

export class Detector<T extends Particle> {
  #seen = new Map<string, T>();

  record(p: T): void {
    this.#seen.set(p.id, p);
  }

  get count(): number {
    return this.#seen.size;
  }
}
`;

const RENDER_TSX = `import type { Tachyon } from "../main";

type Props = { swarm: Tachyon[] };

export function Swarm({ swarm }: Props) {
  return (
    <ul className="swarm">
      {swarm.map((t) => (
        <li key={t.id} style={{ color: "#7ee7ff" }}>
          {t.name} — {t.velocityRatio.toFixed(3)}c
        </li>
      ))}
    </ul>
  );
}

export function render(el: Element, swarm: Tachyon[]) {
  el.textContent = \`\${swarm.length} tachyons detected\`;
}
`;

const THEME_CSS = `:root {
  --cherenkov: #5b8cff;
  --particle: #7ee7ff;
  --void: #0c0c11;
  --glow: rgba(126, 231, 255, 0.35);
}

.swarm {
  display: grid;
  gap: 8px;
  background: var(--void);
  color: hsl(190, 90%, 75%);
  box-shadow: 0 0 24px var(--glow);
}

.swarm li:hover {
  color: #ffd866;
  transform: translateX(4px);
}
`;

const RUST = `use std::f64::consts::PI;

/// A particle that never slows below the speed of light.
#[derive(Debug, Clone)]
pub struct Tachyon {
    pub energy: f64,
    pub velocity_ratio: f64,
}

impl Tachyon {
    pub fn new(energy: f64) -> Self {
        let velocity_ratio = (1.0 + (1.0 / energy).powi(2)).sqrt();
        Self { energy, velocity_ratio }
    }

    pub fn cherenkov_angle(&self, n: f64) -> f64 {
        (1.0 / (n * self.velocity_ratio)).acos() * 180.0 / PI
    }
}

fn main() {
    let swarm: Vec<Tachyon> = (1..=5).map(|e| Tachyon::new(e as f64)).collect();
    for t in &swarm {
        println!("{:.3}c — angle {:.1}°", t.velocity_ratio, t.cherenkov_angle(1.33));
    }
}
`;

const PYTHON = `"""Build script for the playground."""
from dataclasses import dataclass
from pathlib import Path
import json


@dataclass
class Target:
    name: str
    optimize: bool = True


def build(targets: list[Target], out: Path = Path("dist")) -> dict:
    # NOTE: this is a toy — nothing is really compiled
    out.mkdir(exist_ok=True)
    report = {t.name: {"optimized": t.optimize} for t in targets}
    (out / "report.json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    print(build([Target("web"), Target("desktop", optimize=False)]))
`;

const PACKAGE_JSON = `{
  "name": "nox-playground",
  "version": "1.0.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc && vite build"
  },
  "dependencies": {
    "react": "^18.3.1"
  }
}
`;

const CONFIG_JSON = `{
  "warpFactor": 9.975,
  "shields": true,
  "crew": ["Kirk", "Spock", "Uhura"],
  "palette": { "primary": "#388bfd", "secondary": "#ff5ac5" }
}
`;

const SETTINGS_YAML = `# Detector settings
detector:
  name: cherenkov-array
  sensitivity: 0.97
  channels:
    - id: 1
      enabled: true
    - id: 2
      enabled: false
`;

const INDEX_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>Nox Code Playground</title>
    <link rel="stylesheet" href="/src/styles/theme.css" />
  </head>
  <body>
    <div id="app" class="swarm"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
`;

const LOGO_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <rect width="64" height="64" rx="14" fill="#14141b"/>
  <path d="M44 20 L12 42 L14 44 Z" fill="#5b8cff"/>
  <circle cx="44" cy="20" r="7" fill="#7ee7ff"/>
</svg>
`;

const GITIGNORE = `node_modules
dist
*.log
`;

const SHELL = `#!/usr/bin/env bash
set -euo pipefail

echo "Engaging warp drive…"
for i in {1..3}; do
  echo "  stage $i"
done
`;

const CHANGELOG = `# Changelog

## 1.0.0
- First light.
`;

const NOTES = `Ideas
=====

* Teach the swarm to sing
* HACK: the detector needs recalibration every full moon
`;

/** Content committed to the fake repository (HEAD). */
export const DEMO_FILES: Record<string, string> = {
  "README.md": README,
  "package.json": PACKAGE_JSON,
  "index.html": INDEX_HTML,
  ".gitignore": GITIGNORE,
  "src/main.ts": MAIN_TS,
  "src/physics/particle.ts": PARTICLE_TS,
  "src/ui/render.tsx": RENDER_TSX,
  "src/styles/theme.css": THEME_CSS,
  "crates/tachyon/src/main.rs": RUST,
  "scripts/build.py": PYTHON,
  "scripts/warp.sh": SHELL,
  "data/config.json": CONFIG_JSON,
  "data/settings.yaml": SETTINGS_YAML,
  "assets/logo.svg": LOGO_SVG,
  "docs/CHANGELOG.md": CHANGELOG,
};

/** Working-tree edits on top of HEAD, so Source Control has something to show. */
export const DEMO_WORKING_CHANGES: Record<string, string | null> = {
  "src/main.ts": MAIN_TS.replace("const swarm = Array.from({ length: 12 }", "const swarm = Array.from({ length: 24 }"),
  "README.md": README.replace("- [ ] Warp drive", "- [ ] Warp drive\n- [ ] Time travel (pending review)"),
  "notes.txt": NOTES,
};
