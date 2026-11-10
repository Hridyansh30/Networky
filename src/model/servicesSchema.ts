// Load-time validation for Device.services and Device.dnsServer (see
// serialize.ts for why every field is typed, bounded and .strict()).
// Kept next to services.ts so the app services can grow without editing the
// main schema; serialize.ts only references these two exports.

import { z } from 'zod';
import { isValidIPv4 } from './ip';
import { LIMITS_SERVICES as L, isDnsName, isFileName, isUserName, isWebPath, servicesProblem } from './services';

/** One line of text: no control characters. */
const line = (max: number) => z.string().max(max).regex(/^[^\u0000-\u001f\u007f]*$/, 'control characters are not allowed');
/** Multi-line text (page bodies, files): tabs and newlines allowed, other control characters not. */
const block = (max: number) => z.string().max(max).regex(/^[^\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]*$/, 'control characters are not allowed');
const ipv4 = z.string().max(15).refine(isValidIPv4, 'not an IPv4 address');
const host = z.string().max(253).refine((s) => s === '' || isValidIPv4(s) || isDnsName(s), 'not an address or host name');

const account = z.object({ user: z.string().max(32).refine(isUserName, 'bad user name'), password: line(64).min(1) }).strict();

export const dnsServerSchema = ipv4;

export const servicesSchema = z
  .object({
    http: z
      .object({
        enabled: z.boolean(),
        pages: z
          .array(z.object({ path: z.string().max(65).refine(isWebPath, 'bad page path'), title: line(80), body: block(L.pageBody) }).strict())
          .max(L.pages),
      })
      .strict()
      .optional(),
    dns: z
      .object({
        enabled: z.boolean(),
        records: z.array(z.object({ name: z.string().max(253).refine(isDnsName, 'bad host name'), type: z.literal('A'), address: ipv4 }).strict()).max(L.records),
      })
      .strict()
      .optional(),
    mail: z
      .object({ enabled: z.boolean(), domain: z.string().max(253).refine(isDnsName, 'bad domain'), accounts: z.array(account).max(L.accounts) })
      .strict()
      .optional(),
    ftp: z
      .object({
        enabled: z.boolean(),
        accounts: z.array(account).max(L.accounts),
        files: z.array(z.object({ name: z.string().max(64).refine(isFileName, 'bad file name'), content: block(L.fileBytes) }).strict()).max(L.files),
      })
      .strict()
      .optional(),
    mailClient: z
      .object({
        name: line(64),
        address: line(290),
        smtpServer: host,
        pop3Server: host,
        user: z.string().max(32),
        password: line(64),
      })
      .strict()
      .optional(),
  })
  .strict()
  // Cross-field rules (duplicate paths, duplicate users...) are the same ones the editor enforces.
  .superRefine((s, ctx) => {
    const problem = servicesProblem(s);
    if (problem) ctx.addIssue({ code: 'custom', message: problem });
  });
