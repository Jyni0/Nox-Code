/**
 * Syntax highlighting outside an editor (search excerpts): parse once with
 * the file's language and hand back colored tokens per line, using the same
 * HighlightStyle — and so the same theme variables — as the editor.
 */
import { highlightCode } from "@lezer/highlight";
import type { Parser } from "@lezer/common";
import { Language, LanguageSupport } from "@codemirror/language";
import { StyleModule } from "style-mod";
import { languageById } from "./languages";
import { noxHighlightStyle } from "./highlight";

export interface Token {
  text: string;
  cls: string;
}

/** Big files are shown plain: parsing them would stall the UI. */
const MAX_PARSE = 400_000;

const parsers = new Map<string, Promise<Parser | null>>();

function parserFor(langId: string): Promise<Parser | null> {
  let p = parsers.get(langId);
  if (!p) {
    const def = languageById(langId);
    p = def
      ? def
          .load()
          .then((ext) => (ext instanceof LanguageSupport ? ext.language : ext instanceof Language ? ext : null)?.parser ?? null)
          .catch(() => null)
      : Promise.resolve(null);
    parsers.set(langId, p);
  }
  return p;
}

let mounted = false;
function mountStyles() {
  if (mounted || typeof document === "undefined") return;
  mounted = true;
  if (noxHighlightStyle.module) StyleModule.mount(document, noxHighlightStyle.module);
}

/** Lines of `text` (LF or CRLF) as highlighted tokens. */
export async function highlightLines(text: string, langId: string): Promise<Token[][]> {
  const src = text.replace(/\r\n?/g, "\n");
  const parser = src.length <= MAX_PARSE ? await parserFor(langId) : null;
  if (!parser) return src.split("\n").map((l) => [{ text: l, cls: "" }]);
  mountStyles();
  const lines: Token[][] = [[]];
  highlightCode(
    src,
    parser.parse(src),
    noxHighlightStyle,
    (t, cls) => lines[lines.length - 1].push({ text: t, cls }),
    () => lines.push([]),
  );
  return lines;
}
