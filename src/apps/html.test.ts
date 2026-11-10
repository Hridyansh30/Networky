import { describe, expect, it } from 'vitest';
import { parseHtml, safeHref, textOf, type HtmlNode } from './html';

const tags = (nodes: HtmlNode[]): string[] => nodes.flatMap((n) => (n.type === 'el' ? [n.tag, ...tags(n.children)] : []));

describe('the browser HTML engine', () => {
  it('keeps the allowed structure', () => {
    const t = parseHtml('<h1>Hi</h1><p>A <b>bold</b> <a href="/about.html">link</a></p><ul><li>one<li>two</ul>');
    expect(tags(t)).toEqual(['h1', 'p', 'b', 'a', 'ul', 'li', 'li']);
    expect(textOf(t)).toBe('HiA bold linkonetwo');
    const a = (t[1] as { children: HtmlNode[] }).children[3];
    expect(a).toMatchObject({ tag: 'a', href: '/about.html' });
  });

  it('removes scripts, styles and frames with their content', () => {
    const t = parseHtml('<p>ok</p><script>alert(1)</script><style>*{}</style><iframe src="//evil"></iframe><svg><script>x</script></svg>');
    expect(textOf(t)).toBe('ok');
    expect(tags(t)).toEqual(['p']);
  });

  it('drops every attribute that could run code or load anything', () => {
    const t = parseHtml('<p onclick="alert(1)" style="x"><img src=x onerror=alert(1)>text</p><a href="javascript:alert(1)">x</a><a href="  java\tscript:alert(1)">y</a><a href="data:text/html,x">z</a>');
    expect(tags(t)).toEqual(['p', 'a', 'a', 'a']);
    expect(JSON.stringify(t)).not.toMatch(/onclick|onerror|style|javascript|data:/);
    for (const n of t.slice(1)) expect((n as { href?: string }).href).toBeUndefined();
  });

  it('only follows in-browser paths and http URLs', () => {
    expect(safeHref('/index.html')).toBe('/index.html');
    expect(safeHref('http://www.networky.lab/a.html')).toBe('http://www.networky.lab/a.html');
    expect(safeHref('https://google.com')).toBeUndefined();
    expect(safeHref('//evil.com')).toBeUndefined();
    expect(safeHref('&#106;avascript:alert(1)')).toBeUndefined();
    expect(safeHref('/../../etc')).toBeUndefined();
  });

  it('decodes entities into text, so React escapes them again when drawing', () => {
    expect(textOf(parseHtml('<p>&lt;script&gt; &amp; &#169; &#x41;</p>'))).toBe('<script> & © A');
  });

  it('survives broken markup and huge input', () => {
    expect(() => parseHtml('<p><b>unclosed <i>tags</p></b> <!-- open comment')).not.toThrow();
    const deep = '<blockquote>'.repeat(5000) + 'x';
    expect(textOf(parseHtml(deep))).toBe('x');
    expect(parseHtml('<b>a</b>'.repeat(20000)).length).toBeLessThanOrEqual(4000);
  });
});
