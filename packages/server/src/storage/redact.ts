// Strips `<private>...</private>` blocks from a string before it leaves
// the developer's machine. The markdown on disk keeps the original tags
// (it's the dev's reference), but anything served to an agent, an HTTP
// caller, or the read-only web viewer goes through this redactor first.
//
// Robustness over strictness: nesting, malformed pairs, and stray opens
// without close are all collapsed into the placeholder. Better to redact
// too much than to leak a line of private context because the user typed
// the wrong tag.

const DEFAULT_REPLACEMENT = '[redacted]';
const PRIVATE_PAIR = /<private>([\s\S]*?)<\/private>/g;
const TRAILING_OPEN = /<private>[\s\S]*$/;
const LEADING_CLOSE = /^[\s\S]*<\/private>/;

export interface StripPrivateOptions {
  replacement?: string;
}

export function stripPrivate(
  text: string,
  options: StripPrivateOptions = {},
): string {
  if (!text || (!text.includes('<private>') && !text.includes('</private>'))) {
    return text;
  }

  const replacement = options.replacement ?? DEFAULT_REPLACEMENT;

  // Iterative pass: each replacement removes the innermost matched pairs,
  // so a second pass collapses any nesting that survived the lazy regex.
  let cur = text;
  let prev = '';
  while (cur !== prev) {
    prev = cur;
    cur = cur.replace(PRIVATE_PAIR, replacement);
  }

  // Defensive cleanup: if a stray opening or closing tag is left over
  // (malformed input), redact aggressively from there to the boundary.
  if (cur.includes('<private>')) {
    cur = cur.replace(TRAILING_OPEN, replacement);
  }
  if (cur.includes('</private>')) {
    cur = cur.replace(LEADING_CLOSE, replacement);
  }

  return cur;
}

export function containsPrivate(text: string): boolean {
  return text.includes('<private>') || text.includes('</private>');
}
