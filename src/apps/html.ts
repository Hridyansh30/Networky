// The web browser's HTML engine, deliberately tiny and safe.
//
// Page bodies come from server configs, and a project file can come from
// anyone (a classmate's lab, a download). So a page is NEVER handed to the
// real browser as HTML (no innerHTML, no dangerouslySetInnerHTML, no iframe).
// Instead this module parses it into a small tree of allowed elements, and
// the React view builds DOM from that tree, with all text escaped by React.
//
//   allowed  h1 h2 h3 p br hr ul ol li b strong i em u code pre blockquote a
//   dropped  every attribute except href on <a>
//   removed  script, style, iframe, object, embed, template, svg, math,
//            textarea, title, noscript: tag AND content
//   unwrapped any other tag: the tag goes, its text stays
//   links    only paths ('/about.html') or http:// URLs. They navigate inside
//            the simulated browser, never the real one.

export type HtmlNode = { type: 'text'; text: string } | { type: 'el'; tag: AllowedTag; href?: string; children: HtmlNode[] };

const ALLOWED = ['h1', 'h2', 'h3', 'p', 'br', 'hr', 'ul', 'ol', 'li', 'b', 'strong', 'i', 'em', 'u', 'code', 'pre', 'blockquote', 'a'] as const;
export type AllowedTag = (typeof ALLOWED)[number];

const isAllowed = (t: string): t is AllowedTag => (ALLOWED as readonly string[]).includes(t);
const VOID = new Set(['br', 'hr', 'img', 'input', 'meta', 'link', 'wbr', 'source', 'area', 'base', 'col', 'embed', 'param', 'track']);
const DROP_WITH_CONTENT = new Set(['script', 'style', 'iframe', 'object', 'embed', 'template', 'svg', 'math', 'textarea', 'title', 'noscript', 'head', 'frameset', 'frame']);

const MAX_NODES = 4000;
const MAX_DEPTH = 32;

const ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', copy: '©', mdash: '—', ndash: '–', hellip: '…' };

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]{1,6}|#[0-9]{1,7}|[a-z]{2,8});/gi, (m, e: string) => {
    if (e[0] === '#') {
      const code = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      const valid = code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff);
      return String.fromCodePoint(valid ? code : 0xfffd); // U+FFFD, the replacement character
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** A link target the simulated browser may follow, or undefined. */
export function safeHref(raw: string): string | undefined {
  const href = decodeEntities(raw).trim();
  // Strip whitespace and control characters anywhere: 'java\tscript:' tricks.
  const compact = href.replace(/[\u0000- \u007f]/g, '');
  if (/^\/[A-Za-z0-9._~-]{0,64}$/.test(compact)) return compact;
  if (/^http:\/\/[A-Za-z0-9.-]{1,253}(:80)?(\/[A-Za-z0-9._~-]{0,64})?$/i.test(compact)) return compact;
  return undefined;
}

function hrefOf(attrs: string): string | undefined {
  const m = /(?:^|\s)href\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/i.exec(attrs);
  return m ? safeHref(m[1] ?? m[2] ?? m[3] ?? '') : undefined;
}

/** Parse a page body into the allowed tree. Never throws. */
export function parseHtml(input: string): HtmlNode[] {
  const root: HtmlNode & { type: 'el' } = { type: 'el', tag: 'p', children: [] };
  const stack: (HtmlNode & { type: 'el' })[] = [root];
  let nodes = 0;
  let dropping: string | null = null;
  const re = /<!--[\s\S]*?(?:-->|$)|<(\/?)([a-zA-Z][a-zA-Z0-9-]*)([^>]*)>|<!?[^>]*>/g;
  let last = 0;
  let m: RegExpExecArray | null;

  const top = () => stack[stack.length - 1];
  const addText = (raw: string) => {
    if (dropping || !raw || nodes >= MAX_NODES) return;
    const text = decodeEntities(raw);
    const kids = top().children;
    const prev = kids[kids.length - 1];
    if (prev?.type === 'text') prev.text += text;
    else {
      kids.push({ type: 'text', text });
      nodes++;
    }
  };

  while ((m = re.exec(input))) {
    addText(input.slice(last, m.index));
    last = re.lastIndex;
    const tag = m[2]?.toLowerCase();
    if (!tag) continue; // comment, doctype, stray '<!'
    const closing = m[1] === '/';

    if (dropping) {
      if (closing && tag === dropping) dropping = null;
      continue;
    }
    if (!closing && DROP_WITH_CONTENT.has(tag)) {
      if (!VOID.has(tag) && !/\/\s*$/.test(m[3])) dropping = tag;
      continue;
    }
    if (!isAllowed(tag)) continue; // unwrap: keep the text, lose the tag

    if (closing) {
      const i = stack.map((n) => n.tag).lastIndexOf(tag);
      if (i > 0) stack.length = i; // closes it and anything left open inside
      continue;
    }
    // Too deep or too many elements: unwrap (keep the text, lose the tag).
    if (nodes >= MAX_NODES || (stack.length >= MAX_DEPTH && !VOID.has(tag))) continue;
    const el: HtmlNode & { type: 'el' } = { type: 'el', tag, children: [] };
    if (tag === 'a') el.href = hrefOf(m[3]);
    top().children.push(el);
    nodes++;
    if (!VOID.has(tag)) stack.push(el);
  }
  addText(input.slice(last));
  return root.children;
}

/** Plain text of a tree (for titles and tests). */
export function textOf(nodes: HtmlNode[]): string {
  return nodes.map((n) => (n.type === 'text' ? n.text : textOf(n.children))).join('');
}
