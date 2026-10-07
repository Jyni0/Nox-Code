import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags as t } from "@lezer/highlight";

const v = (name: string) => `var(--syn-${name})`;

/**
 * Syntax colors point at theme variables, so switching or live-editing a
 * theme repaints open editors without rebuilding them.
 */
export const noxHighlightStyle = HighlightStyle.define([
  {
    tag: [t.keyword, t.controlKeyword, t.definitionKeyword, t.moduleKeyword, t.operatorKeyword, t.modifier, t.self],
    color: v("keyword"),
    fontStyle: "var(--syn-keyword-style)",
    fontWeight: "var(--syn-keyword-weight)",
  },
  { tag: [t.string, t.special(t.string), t.character, t.docString, t.attributeValue], color: v("string") },
  { tag: [t.comment, t.lineComment, t.blockComment, t.docComment], color: v("comment"), fontStyle: "var(--syn-comment-style)" },
  {
    tag: [t.function(t.variableName), t.function(t.propertyName), t.function(t.definition(t.variableName)), t.macroName],
    color: v("function"),
  },
  { tag: [t.variableName, t.definition(t.variableName), t.labelName], color: v("variable") },
  { tag: [t.propertyName, t.definition(t.propertyName)], color: v("property") },
  { tag: [t.typeName, t.className, t.namespace, t.definition(t.typeName), t.standard(t.typeName)], color: v("type") },
  { tag: [t.number, t.integer, t.float], color: v("number") },
  { tag: [t.bool, t.null, t.atom, t.unit, t.constant(t.variableName), t.standard(t.variableName), t.special(t.variableName)], color: v("constant") },
  {
    tag: [t.operator, t.derefOperator, t.arithmeticOperator, t.logicOperator, t.compareOperator, t.updateOperator, t.definitionOperator, t.typeOperator, t.controlOperator],
    color: v("operator"),
  },
  { tag: [t.punctuation, t.separator, t.bracket, t.angleBracket, t.squareBracket, t.paren, t.brace], color: v("punctuation") },
  { tag: [t.tagName], color: v("tag") },
  { tag: [t.attributeName], color: v("attribute") },
  { tag: [t.regexp, t.escape], color: v("regexp") },
  { tag: [t.heading, t.heading1, t.heading2, t.heading3, t.heading4, t.heading5, t.heading6], color: v("heading"), fontWeight: "700" },
  { tag: [t.link, t.url], color: v("link"), textDecoration: "underline" },
  { tag: [t.meta, t.annotation, t.processingInstruction, t.documentMeta], color: v("meta") },
  { tag: t.invalid, color: v("invalid") },
  { tag: t.emphasis, fontStyle: "italic" },
  { tag: t.strong, fontWeight: "700" },
  { tag: t.strikethrough, textDecoration: "line-through" },
  { tag: t.quote, color: v("comment"), fontStyle: "italic" },
  { tag: t.monospace, color: v("string") },
  { tag: t.inserted, color: "var(--diff-add)" },
  { tag: t.deleted, color: "var(--diff-del)" },
  { tag: t.changed, color: "var(--diff-mod)" },
  { tag: t.contentSeparator, color: v("punctuation") },
]);

export const noxHighlight = syntaxHighlighting(noxHighlightStyle, { fallback: true });
