/**
 * A structural signature of a rendered tree: the part of the DOM the
 * stylesheets and assistive technology actually key off, with everything a
 * renderer is free to differ about stripped out.
 *
 * Two trees with the same signature are the same user interface. That is the
 * whole claim the parity tests make, so what this file chooses to keep is the
 * definition of "parity" for this migration.
 */

/** Attributes that change what a control *is*. Anything outside this list —
 *  ids, keys, inline styles, data hooks, values — is a renderer's own business. */
const SIGNIFICANT_ATTRIBUTES = [
  "type",
  "role",
  "aria-label",
  "aria-labelledby",
  "aria-describedby",
  "aria-expanded",
  "aria-hidden",
  "aria-pressed",
  "aria-live",
  "aria-atomic",
  "aria-current",
  "aria-selected",
  "title",
  "placeholder",
  "disabled",
  "readonly",
  "checked",
  "open",
  "alt",
  "accept",
  "multiple",
  "colspan",
  "for",
  "name",
] as const;

/** Assets resolve to different URLs under different bundlers, so only the file
 *  they point at is compared. */
const assetName = (value: string): string => {
  const withoutQuery = value.split("?")[0] ?? value;
  return withoutQuery.split("/").pop() ?? withoutQuery;
};

const classSignature = (element: Element): string => {
  const names = [...element.classList].toSorted();
  return names.length === 0 ? "" : `.${names.join(".")}`;
};

const attributeSignature = (element: Element): string => {
  const parts: string[] = [];
  for (const name of SIGNIFICANT_ATTRIBUTES) {
    const value = element.getAttribute(name);
    if (value === null) continue;
    // A boolean attribute is present or absent; React writes "" and Foldkit
    // writes "true" for the same fact.
    parts.push(value === "" || value === "true" ? name : `${name}=${value}`);
  }
  const src = element.getAttribute("src");
  if (src !== null) parts.push(`src=${assetName(src)}`);
  const href = element.getAttribute("href");
  if (href !== null) parts.push(`href=${href}`);
  return parts.length === 0 ? "" : `[${parts.join(" ")}]`;
};

const textOf = (node: Node): string => (node.textContent ?? "").replaceAll(/\s+/gu, " ").trim();

export interface SignatureOptions {
  /** Subtrees that are a mount's or a library's business rather than the
   *  shell's — a Lexical editor, a pdf.js canvas. Matched elements appear in
   *  the signature as an opaque marker so their presence is still compared. */
  readonly opaque?: readonly string[];
  /** Elements to drop entirely, for parts one renderer legitimately does not
   *  have — always with a reason, recorded at the call site. */
  readonly omit?: readonly string[];
  /** A last resort for a difference that is deliberate and documented: each
   *  signature line passes through this before comparison, so the deviation is
   *  written down in the test rather than hidden in the normalizer. */
  readonly rewrite?: (line: string) => string;
}

const matches = (element: Element, selectors: readonly string[]): boolean =>
  selectors.some((selector) => element.matches(selector));

const walk = (node: Node, depth: number, options: SignatureOptions, lines: string[]): void => {
  const indent = "  ".repeat(depth);
  if (node.nodeType === Node.TEXT_NODE) {
    const text = textOf(node);
    if (text !== "") lines.push(`${indent}"${text}"`);
    return;
  }
  if (!(node instanceof Element)) return;
  if (matches(node, options.omit ?? [])) return;
  const tag = node.tagName.toLowerCase();
  const head = `${indent}${tag}${classSignature(node)}${attributeSignature(node)}`;
  if (matches(node, options.opaque ?? [])) {
    lines.push(`${head} …`);
    return;
  }
  lines.push(head);
  for (const child of node.childNodes) walk(child, depth + 1, options, lines);
};

/** The signature of an element's children, so the harness's own wrapper never
 *  shows up in the comparison. */
export const signature = (root: Element, options: SignatureOptions = {}): string => {
  const lines: string[] = [];
  for (const child of root.childNodes) walk(child, 0, options, lines);
  const rewrite = options.rewrite;
  return (rewrite === undefined ? lines : lines.map(rewrite)).join("\n");
};
