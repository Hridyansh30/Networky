// The check kinds a problem can use. Adding one = writing a file here and
// listing it below; removing one = deleting its line (checks/modularity test
// proves the others keep working).
import type { CheckPlugin } from '../types';
import { accessVlanCheck } from './accessVlan';
import { dhcpLeaseCheck } from './dhcpLease';
import { httpCheck } from './http';
import { interfaceIpCheck } from './interfaceIp';
import { reachCheck } from './reach';
import { routeCheck } from './route';
import { stpRootCheck } from './stpRoot';
import { tcpCheck } from './tcp';

export const DEFAULT_CHECKS: readonly CheckPlugin<never>[] = [reachCheck, tcpCheck, httpCheck, dhcpLeaseCheck, routeCheck, stpRootCheck, interfaceIpCheck, accessVlanCheck] as unknown as CheckPlugin<never>[];

export type CheckRegistry = ReadonlyMap<string, CheckPlugin<unknown>>;

export function registry(checks: readonly CheckPlugin<never>[] = DEFAULT_CHECKS): CheckRegistry {
  const map = new Map<string, CheckPlugin<unknown>>();
  for (const c of checks) {
    if (map.has(c.kind)) throw new Error(`Two checks claim the kind '${c.kind}'`);
    map.set(c.kind, c as unknown as CheckPlugin<unknown>);
  }
  return map;
}
