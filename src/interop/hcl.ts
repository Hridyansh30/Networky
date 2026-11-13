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

/** Is this entry an attribute that fits on one line (and so takes part in '=' alignment)? */
const oneLine = (e: HclBody[number]): e is [string, HclValue | HclValue[] | Record<string, never>] =>
  Array.isArray(e) && (Array.isArray(e[1]) || 'expr' in e[1] || Object.keys(e[1]).length === 0);

/**
 * Render a block such as resource "aws_vpc" "main" { ... }, laid out exactly
 * as `terraform fmt` would (CI checks this with `terraform fmt -check`):
 * the '=' of consecutive one-line attributes line up, and a nested block or a
 * multi-line map or a comment ends that run, without being padded itself.
 * (Checked against `terraform fmt` itself, not guessed.)
 */
export function renderBlock(header: string, body: HclBody, indent = ''): string[] {
  const inner = indent + '  ';
  const out = [`${indent}${header} {`];
  // Width of the run of one-line attributes that starts at each index.
  const widths: number[] = [];
  for (let i = body.length - 1, run = 0; i >= 0; i--) {
    const e = body.at(i)!;
    run = oneLine(e) ? Math.max(run, e[0].length) : 0;
    widths.unshift(run);
  }
  let width = 0;
  body.forEach((entry, i) => {
    const prev = i > 0 ? body.at(i - 1)! : undefined;
    if (oneLine(entry) && (!prev || !oneLine(prev))) width = widths.at(i)!; // a new run starts here
    if ('comment' in entry) out.push(`${inner}# ${entry.comment}`);
    else if ('block' in entry) out.push(...renderBlock(entry.block, entry.body, inner));
    else if (oneLine(entry)) {
      const [key, value] = entry;
      const rhs = Array.isArray(value) ? `[${value.map((v) => v.expr).join(', ')}]` : 'expr' in value ? (value as HclValue).expr : '{}';
      out.push(`${inner}${key.padEnd(width)} = ${rhs}`);
    } else {
      const [key, map] = entry as [string, Record<string, HclValue>];
      const keys = Object.keys(map);
      const kw = Math.max(...keys.map((k) => k.length));
      out.push(`${inner}${key} = {`);
      for (const [k, v] of Object.entries(map)) out.push(`${inner}  ${k.padEnd(kw)} = ${v.expr}`);
      out.push(`${inner}}`);
    }
  });
  out.push(`${indent}}`);
  return out;
}
