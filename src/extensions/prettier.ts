/** Prettier (standalone) — loaded on first use so it costs nothing at startup. */
import { languageById, languageName } from "@/editor/languages";
import { effectiveFor } from "@/stores/project";
import { extSettings } from "./registry";

export interface PrettierOptions {
  printWidth: number;
  tabWidth: number;
  useTabs: boolean;
  semi: boolean;
  singleQuote: boolean;
  trailingComma: "all" | "es5" | "none";
}

type Plugin = object;

async function pluginsFor(parser: string): Promise<Plugin[]> {
  const load = {
    babel: () => import("prettier/plugins/babel"),
    estree: () => import("prettier/plugins/estree"),
    typescript: () => import("prettier/plugins/typescript"),
    postcss: () => import("prettier/plugins/postcss"),
    html: () => import("prettier/plugins/html"),
    markdown: () => import("prettier/plugins/markdown"),
    yaml: () => import("prettier/plugins/yaml"),
  };
  const need: Array<keyof typeof load> =
    parser === "typescript" ? ["typescript", "estree"]
    : parser === "babel" || parser === "json" ? ["babel", "estree"]
    : parser === "css" ? ["postcss"]
    : parser === "yaml" ? ["yaml"]
    // HTML and Markdown can embed scripts and styles.
    : ["html", "markdown", "babel", "estree", "typescript", "postcss", "yaml"];
  const mods = await Promise.all(need.map((n) => load[n]()));
  return mods.map((m) => ((m as { default?: Plugin }).default ?? m) as Plugin);
}

export function canFormat(langId: string): boolean {
  return !!languageById(langId)?.prettier;
}

export async function formatText(
  text: string,
  langId: string,
  opts: PrettierOptions,
  cursorOffset = 0,
): Promise<{ formatted: string; cursorOffset: number }> {
  const parser = languageById(langId)?.prettier;
  if (!parser) throw new Error(`Prettier cannot format ${languageName(langId)} files`);
  const [prettier, plugins] = await Promise.all([import("prettier/standalone"), pluginsFor(parser)]);
  const res = await prettier.formatWithCursor(text, {
    parser,
    plugins,
    cursorOffset: Math.min(cursorOffset, text.length),
    printWidth: opts.printWidth,
    tabWidth: opts.tabWidth,
    useTabs: opts.useTabs,
    semi: opts.semi,
    singleQuote: opts.singleQuote,
    trailingComma: opts.trailingComma,
  });
  return { formatted: res.formatted, cursorOffset: Math.max(0, res.cursorOffset) };
}

/** Prettier options for one file: extension settings, then project overrides. */
export function prettierOptionsFor(path: string | null, langId: string): PrettierOptions {
  const o = extSettings("prettier");
  const e = effectiveFor(path, langId);
  return {
    printWidth: e.printWidth ?? (o.printWidth as number),
    tabWidth: e.tabSize,
    useTabs: !e.insertSpaces,
    semi: e.semi ?? (o.semi as boolean),
    singleQuote: e.singleQuote ?? (o.singleQuote as boolean),
    trailingComma: o.trailingComma as PrettierOptions["trailingComma"],
  };
}

/** Format on save: the project (or its language block) can turn it on or off. */
export function formatOnSaveFor(path: string | null, langId: string): boolean {
  return effectiveFor(path, langId).formatOnSave ?? !!extSettings("prettier").formatOnSave;
}
