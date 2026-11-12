// A tiny, safe writer for Terraform's language (HCL).
//
// Why not build the text with template strings directly? Because names in a
// project (hostnames, the project name) end up inside HCL strings, and HCL
// strings are not inert: "${...}" and "%{...}" inside them are evaluated by
// Terraform. A project file you downloaded could carry a name like
// ${file("~/.aws/credentials")} and turn "terraform plan" into a leak. So
// every string goes through hclString(), which escapes quotes, backslashes,
// newlines AND the two template openers. This is the HCL version of escaping
// HTML: never paste untrusted text into code, encode it for that language.

/** An HCL string literal, with every special sequence escaped. */
export function hclString(s: string): string {
  const body = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t')
    // A function, not the string '$${': in String.replace a '$$' in the
    // replacement string means ONE '$', which would silently undo the escape.
    .replace(/\$\{/g, () => '$${')
    .replace(/%\{/g, () => '%%{');
  return `"${body}"`;
}

/**
 * A Terraform resource name (an identifier, not a string): lower case
 * letters, digits and underscores, starting with a letter, unique in `used`.
 */
export function hclName(raw: string, used: Set<string>): string {
  let base = raw.toLowerCase().replace(/[^a-z0-9_]+/g, '_').replace(/^_+|_+$/g, '') || 'x';
  if (!/^[a-z]/.test(base)) base = `n_${base}`;
  base = base.slice(0, 48);
  let name = base;
  for (let k = 2; used.has(name); k++) name = `${base}_${k}`;
  used.add(name);
  return name;
}

/** A value inside a block: a raw expression (reference, number, bool) or an already-encoded string. */
export type HclValue = { expr: string };
export const expr = (e: string): HclValue => ({ expr: e });
export const str = (s: string): HclValue => ({ expr: hclString(s) });

export type HclBody = (
  | [key: string, value: HclValue | HclValue[] | Record<string, HclValue>]
  | { block: string; body: HclBody }
  | { comment: string }
)[];

/** Render a block such as resource "aws_vpc" "main" { ... }, aligned like `terraform fmt`. */
export function renderBlock(header: string, body: HclBody, indent = ''): string[] {
  const inner = indent + '  ';
  const out = [`${indent}${header} {`];
  // terraform fmt aligns the '=' of consecutive attributes
  const width = Math.max(0, ...body.filter((e): e is [string, HclValue] => Array.isArray(e)).map(([k]) => k.length));
  for (const entry of body) {
    if ('comment' in entry) out.push(`${inner}# ${entry.comment}`);
    else if ('block' in entry) out.push(...renderBlock(entry.block, entry.body, inner));
    else {
      const [key, value] = entry;
      const pad = key.padEnd(width);
      if (Array.isArray(value)) out.push(`${inner}${pad} = [${value.map((v) => v.expr).join(', ')}]`);
      else if ('expr' in value) out.push(`${inner}${pad} = ${(value as HclValue).expr}`);
      else {
        const map = value as Record<string, HclValue>;
        const kw = Math.max(...Object.keys(map).map((k) => k.length));
        out.push(`${inner}${pad} = {`);
        for (const [k, v] of Object.entries(map)) out.push(`${inner}  ${k.padEnd(kw)} = ${v.expr}`);
        out.push(`${inner}}`);
      }
    }
  }
  out.push(`${indent}}`);
  return out;
}
