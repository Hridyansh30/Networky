// Which route does a router use? The most specific route that contains the
// destination, whatever order the table lists them in.

import { formatIPv4, prefixToMaskNum } from '../../model/ip';
import type { DrillKind, DrillQuestion } from '../types';
import { privateAddress, shuffle } from './util';

const HOPS = ['R2', 'R3', 'R4', 'R5', 'ISP'];

interface Route {
  net: number;
  prefix: number;
  text: string;
}

const covers = (rt: Route, dest: number) => ((dest & prefixToMaskNum(rt.prefix)) >>> 0) === rt.net;

export const longestMatch: DrillKind = {
  id: 'longest-match',
  title: 'Longest prefix match',
  topic: 'Routing',
  summary: 'Pick the route a router uses for a destination.',
  levels: { 1: 'Two nested routes', 2: 'Three routes, one that looks close but does not match', 3: 'Four routes with a default route' },
  generate(r, level): DrillQuestion {
    const dest = privateAddress(r);
    const hops = shuffle(r, HOPS);
    const routes: Route[] = [];
    const add = (net: number, prefix: number) => {
      if (routes.some((x) => x.net === net && x.prefix === prefix)) return false;
      routes.push({ net: net >>> 0, prefix, text: '' });
      return true;
    };
    const matching = (prefix: number) => add(dest & prefixToMaskNum(prefix), prefix);
    // A near miss: same first bits as the destination, but one bit flipped inside the prefix.
    const nearMiss = (prefix: number, bit: number) => add((dest ^ (1 << (32 - bit))) & prefixToMaskNum(prefix), prefix);

    const defaultOnly = level === 3 && r.int(0, 2) === 0;
    if (!defaultOnly) {
      const shorter = r.int(8, 16);
      const longer = r.int(shorter + 4, 28);
      matching(shorter);
      matching(longer);
      if (level >= 2) {
        const p = Math.min(30, longer + r.int(1, 4));
        nearMiss(p, r.int(longer + 1, p)); // the flipped bit is inside the route's prefix, so it cannot match
      }
    } else {
      for (const p of [r.int(16, 20), r.int(22, 28)]) nearMiss(p, r.int(9, p));
    }
    if (level === 3) {
      add(0, 0);
      if (routes.length < 4) nearMiss(r.int(20, 26), r.int(9, 20));
    }
    routes.forEach((rt, i) => (rt.text = `${formatIPv4(rt.net)}/${rt.prefix} via ${hops.at(i % hops.length)}`));
    const winner = routes.filter((rt) => covers(rt, dest)).reduce((a, b) => (b.prefix > a.prefix ? b : a));
    const listed = shuffle(r, routes);
    return {
      type: 'choice',
      prompt: `A router receives a packet for ${formatIPv4(dest)}. Its routing table has these routes. Which one does it use?`,
      choices: listed.map((rt) => rt.text),
      expected: { choice: winner.text },
      explanation: [
        ...listed.map((rt) => `${rt.text}: ${covers(rt, dest) ? `contains ${formatIPv4(dest)} (${rt.prefix} bits match)` : 'does not contain it'}.`),
        `Of the routes that contain the destination, the longest prefix wins: ${winner.text}. Table order does not matter.`,
      ],
    };
  },
};
