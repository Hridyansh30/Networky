import { describe, expect, it } from 'vitest';
import { escapeAttribute, parsePublicUrl, parseWorkspaceUrl, socialTags } from './workspaceUrl';

describe('parseWorkspaceUrl', () => {
  it('accepts an https URL and normalises it', () => {
    expect(parseWorkspaceUrl(' https://app.networky.dev ')).toEqual({ ok: true, url: 'https://app.networky.dev/' });
  });

  it('keeps a path, so the workspace can live in a sub-folder', () => {
    expect(parseWorkspaceUrl('https://example.com/networky/app/')).toEqual({ ok: true, url: 'https://example.com/networky/app/' });
  });

  it('allows plain http only on localhost', () => {
    expect(parseWorkspaceUrl('http://localhost:5173').ok).toBe(true);
    expect(parseWorkspaceUrl('http://127.0.0.1:5173').ok).toBe(true);
    expect(parseWorkspaceUrl('http://app.networky.dev').ok).toBe(false);
  });

  it('refuses missing, relative and malformed values', () => {
    expect(parseWorkspaceUrl(undefined).ok).toBe(false);
    expect(parseWorkspaceUrl('   ').ok).toBe(false);
    expect(parseWorkspaceUrl('/app').ok).toBe(false);
    expect(parseWorkspaceUrl('app.networky.dev').ok).toBe(false);
  });

  it('refuses script and data URLs', () => {
    expect(parseWorkspaceUrl('javascript:alert(1)').ok).toBe(false);
    expect(parseWorkspaceUrl('JavaScript:alert(1)').ok).toBe(false);
    expect(parseWorkspaceUrl('data:text/html,<script>alert(1)</script>').ok).toBe(false);
  });

  it('refuses credentials inside the URL', () => {
    expect(parseWorkspaceUrl('https://user:pass@app.networky.dev').ok).toBe(false);
  });

  it('percent-encodes characters that could break out of an attribute', () => {
    const r = parseWorkspaceUrl('https://app.networky.dev/"><script>');
    expect(r.ok && r.url).toBe('https://app.networky.dev/%22%3E%3Cscript%3E');
  });
});

describe('escapeAttribute', () => {
  it('escapes every character that is special inside an attribute', () => {
    expect(escapeAttribute(`a&b"c'd<e>f`)).toBe('a&amp;b&quot;c&#39;d&lt;e&gt;f');
  });
});

describe('socialTags', () => {
  it('builds absolute preview URLs from the site URL, including a sub-folder', () => {
    const tags = socialTags('https://example.com/networky/');
    expect(tags).toContain('<meta property="og:url" content="https://example.com/networky/" />');
    expect(tags).toContain('<meta property="og:image" content="https://example.com/networky/og-image.png" />');
    expect(tags).toContain('summary_large_image');
  });

  it('names the variable in errors and applies the same https rules', () => {
    const bad = parsePublicUrl('VITE_SITE_URL', 'http://networky.dev');
    expect(bad).toEqual({ ok: false, reason: expect.stringContaining('VITE_SITE_URL') });
    expect(parsePublicUrl('VITE_SITE_URL', 'javascript:alert(1)').ok).toBe(false);
  });

  it('escapes the URL before it goes into the attribute', () => {
    const tags = socialTags('https://example.com/a"b/');
    expect(tags).not.toContain('a"b');
  });
});
