// Small helpers every route uses: errors with a status, a body reader with a
// hard size cap, and encoding helpers.

import type { Context } from 'hono';
import { z } from 'zod';
import type { AppEnv } from './env';

/** An error the client is meant to see. Anything else becomes a plain 500. */
export class ApiError extends Error {
  constructor(
    readonly status: 400 | 401 | 403 | 404 | 409 | 413 | 415 | 429 | 503,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * Reads a JSON body, refusing anything larger than `maxBytes` BEFORE parsing
 * it, and validates it with a strict schema. Parsing a 50 MB body just to
 * reject it would itself be the denial of service.
 */
export async function readJson<T>(c: Context<AppEnv>, schema: z.ZodType<T>, maxBytes: number): Promise<T> {
  const type = c.req.header('Content-Type') ?? '';
  if (!type.toLowerCase().startsWith('application/json')) throw new ApiError(415, 'json_only', 'Send the body as application/json.');
  const declared = Number(c.req.header('Content-Length') ?? '0');
  if (declared > maxBytes) throw new ApiError(413, 'too_large', `The request is larger than ${Math.round(maxBytes / 1024)} KB.`);
  const text = await c.req.text();
  if (new TextEncoder().encode(text).length > maxBytes) throw new ApiError(413, 'too_large', `The request is larger than ${Math.round(maxBytes / 1024)} KB.`);
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new ApiError(400, 'bad_json', 'The body is not valid JSON.');
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ApiError(400, 'bad_request', `${first.path.join('.') || 'body'}: ${first.message}`);
  }
  return parsed.data;
}

export const toHex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export async function sha256Hex(text: string): Promise<string> {
  return toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

export async function sha256Base64Url(text: string): Promise<string> {
  return toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))));
}

/** A random id: 16 bytes as 32 hex characters. */
export const newId = (c: Context<AppEnv>) => toHex(c.var.deps.randomBytes(16));

/** Compares two strings in time that does not depend on where they differ. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
