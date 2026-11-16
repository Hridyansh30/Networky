// Given an address and a prefix: the network, first and last usable host,
// and broadcast. The core subnetting skill.

import { formatIPv4, prefixToMask, prefixToMaskNum } from '../../model/ip';
import type { DrillKind, DrillQuestion, Level } from '../types';
import { ordinal, privateAddress } from './util';

const PREFIXES: Record<Level, [number, number]> = { 1: [24, 30], 2: [16, 23], 3: [8, 15] };

export const subnetRange: DrillKind = {
  id: 'subnet-range',
  title: 'Subnet range',
  topic: 'IP Addressing',
  summary: 'Network, first and last host, and broadcast of an address.',
  levels: { 1: 'Prefixes /24 to /30: the last octet', 2: 'Prefixes /16 to /23: the third octet', 3: 'Prefixes /8 to /15: the second octet' },
  generate(r, level): DrillQuestion {
    const [lo, hi] = PREFIXES[level];
    const prefix = r.int(lo, hi);
    const addr = privateAddress(r);
    const mask = prefixToMaskNum(prefix);
    const network = (addr & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    const octet = Math.floor(prefix / 8); // 0-based index of the octet the prefix cuts
    const block = 2 ** (8 - (prefix % 8));
    const maskOctet = 256 - block;
    const value = (addr >>> (8 * (3 - octet))) & 255;
    return {
      type: 'fields',
      prompt: `A host has the address ${formatIPv4(addr)}/${prefix}. Fill in its subnet.`,
      fields: [
        { id: 'network', label: 'Network address', format: 'ipv4' },
        { id: 'first', label: 'First usable host', format: 'ipv4' },
        { id: 'last', label: 'Last usable host', format: 'ipv4' },
        { id: 'broadcast', label: 'Broadcast address', format: 'ipv4' },
      ],
      expected: {
        network: formatIPv4(network),
        first: formatIPv4(network + 1),
        last: formatIPv4(broadcast - 1),
        broadcast: formatIPv4(broadcast),
      },
      explanation: [
        prefix % 8 === 0
          ? `/${prefix} is the mask ${prefixToMask(prefix)}: it ends exactly on an octet boundary, so the first ${prefix / 8} octets are the network and the rest is host.`
          : `/${prefix} is the mask ${prefixToMask(prefix)}. The prefix ends inside the ${ordinal(octet + 1)} octet, so that is the one that matters.`,
        ...(prefix % 8 === 0
          ? []
          : [
              `Block size = 256 − ${maskOctet} = ${block}. Subnets in that octet start at 0, ${block}, ${2 * block}, …`,
              `${value} falls in the block starting at ${Math.floor(value / block) * block}, so the network is ${formatIPv4(network)} (every octet after it is 0).`,
            ]),
        `The network address has every host bit 0: ${formatIPv4(network)}. The broadcast has every host bit 1: ${formatIPv4(broadcast)}.`,
        `Usable hosts are everything in between: ${formatIPv4(network + 1)} to ${formatIPv4(broadcast - 1)}.`,
      ],
    };
  },
};
