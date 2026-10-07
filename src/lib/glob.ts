/** gitignore-flavoured globs: `*.ts`, `src/**`, `**\/dist`, `node_modules`. */

const cache = new Map<string, RegExp>();

export function globToRegExp(glob: string): RegExp {
  const hit = cache.get(glob);
  if (hit) return hit;
  let g = glob.trim().replace(/\\/g, "/");
  const anchored = g.startsWith("/");
  if (anchored) g = g.slice(1);
  if (g.endsWith("/")) g = g.slice(0, -1);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i];
    if (c === "*") {
      if (g[i + 1] === "*") {
        // "**/" matches any number of folders, "**" anything.
        if (g[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else if (c === "{") {
      const end = g.indexOf("}", i);
      if (end > i) {
        re += "(?:" + g.slice(i + 1, end).split(",").map(escape).join("|") + ")";
        i = end;
      } else re += "\\{";
    } else re += escape(c);
  }
  // A pattern without a slash matches a name at any depth (like .gitignore);
  // it also matches everything inside a folder of that name.
  const prefix = anchored || g.includes("/") ? "^" : "^(?:.*/)?";
  const out = new RegExp(prefix + re + "(?:/.*)?$", "i");
  cache.set(glob, out);
  return out;
}

function escape(s: string) {
  return s.replace(/[.+^$()|[\]\\]/g, "\\$&");
}

export function splitGlobs(list: string): string[] {
  return list.split(",").map((s) => s.trim()).filter(Boolean);
}

/** `rel` is a forward-slash path relative to the project root. */
export function matchesAny(rel: string, globs: string[]): boolean {
  return globs.some((g) => globToRegExp(g).test(rel));
}
