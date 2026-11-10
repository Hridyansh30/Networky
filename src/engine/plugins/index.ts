// The protocol line-up. Each entry is independent: delete one from this list
// (and its import) and the simulator still runs; only that protocol vanishes.
// Order matters only for hooks without an explicit priority (first answer wins).

import type { EnginePlugin } from '../plugin';
import { aclPlugin } from './acl';
import { dhcpPlugin } from './dhcp';
import { ipv6Plugin } from './ipv6';
import { natPlugin } from './nat';
import { ospfPlugin } from './ospf';
import { ripPlugin } from './rip';
import { stpPlugin } from './stp';
import { tcpPlugin } from './tcp';

export const DEFAULT_PLUGINS: readonly EnginePlugin[] = [
  stpPlugin,
  dhcpPlugin,
  aclPlugin,
  natPlugin,
  ripPlugin,
  ospfPlugin,
  ipv6Plugin,
  tcpPlugin,
];

export { aclPlugin, dhcpPlugin, ipv6Plugin, natPlugin, ospfPlugin, ripPlugin, stpPlugin, tcpPlugin };
