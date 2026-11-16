// What does a switch do with a frame? It learns the SOURCE MAC on the port
// the frame came in on, then forwards by the DESTINATION: known -> that port
// only; unknown or broadcast -> every port except the one it came in on;
// known on the arrival port -> filtered (dropped).

import type { DrillKind, DrillQuestion, Level } from '../types';
import { shuffle } from './util';

const FRAMES: Record<Level, number> = { 1: 2, 2: 3, 3: 4 };
const BROADCAST = 'everyone (broadcast)';

export const macTable: DrillKind = {
  id: 'mac-table',
  title: 'MAC learning',
  topic: 'Switching',
  summary: 'Predict whether a switch forwards, floods or filters a frame.',
  levels: { 1: 'Two earlier frames', 2: 'Three earlier frames and broadcasts', 3: 'A hub on one port: frames can be filtered' },
  generate(r, level): DrillQuestion {
    const ports = ['Fa0/1', 'Fa0/2', 'Fa0/3', 'Fa0/4'];
    const hosts = shuffle(r, ['PC-A', 'PC-B', 'PC-C', 'PC-D']);
    const portOf = new Map<string, string>(hosts.map((h, i) => [h, ports.at(i)!]));
    if (level === 3) portOf.set('PC-E', portOf.get(hosts.at(3)!)!); // PC-E shares the hub with the 4th host
    const all = [...portOf.keys()];
    const frames: [string, string][] = [];
    for (let i = 0; i < FRAMES[level]; i++) {
      const src = r.pick(all);
      const dst = level >= 2 && r.int(0, 3) === 0 ? BROADCAST : r.pick(all.filter((h) => h !== src));
      frames.push([src, dst]);
    }
    // The last frame. At level 3, half the time it stays behind the hub.
    const src = r.pick(all);
    const hubPair = level === 3 && r.int(0, 1) === 0;
    const hubHosts = all.filter((h) => portOf.get(h) === portOf.get(hosts.at(3)!));
    const [fSrc, fDst] = hubPair ? shuffle(r, hubHosts) : [src, r.pick(all.filter((h) => h !== src))];
    const inPort = portOf.get(fSrc)!;
    const learned = new Map<string, string>();
    for (const [s] of frames) learned.set(s, portOf.get(s)!);
    const known = learned.get(fDst);
    const flood = `Flood: out every port except ${inPort}`;
    const filter = `Filter: drop it, ${fDst} is on the port it came in on`;
    const forwardTo = (p: string) => `Forward out ${p} only`;
    const answer = known === undefined ? flood : known === inPort ? filter : forwardTo(known);
    const other = ports.filter((p) => p !== inPort && p !== portOf.get(fDst));
    const options = new Set([answer, flood, forwardTo(portOf.get(fDst)!), forwardTo(r.pick(other))]);
    if (level === 3) options.add(filter);
    options.delete(forwardTo(inPort)); // never offer "out the port it came in on"
    options.add(answer);
    const table = [...learned].map(([h, p]) => `${h} on ${p}`).join(', ') || 'empty';
    return {
      type: 'choice',
      prompt: [
        `A switch has just booted: its MAC table is empty. Cabling: ${hosts.map((h) => `${h} on ${portOf.get(h)}`).join(', ')}${level === 3 ? `, and PC-E on the same hub as ${hosts.at(3)} (${portOf.get('PC-E')})` : ''}.`,
        'These frames cross it, in order:',
        ...frames.map(([s, d], i) => `${i + 1}) ${s} to ${d}`),
        `Then ${fSrc} sends a frame to ${fDst}. What does the switch do with it?`,
      ].join('\n'),
      choices: shuffle(r, [...options]),
      expected: { choice: answer },
      explanation: [
        'A switch learns only from source addresses; destinations teach it nothing.',
        `After the earlier frames its table holds: ${table}.`,
        known === undefined
          ? `${fDst} is not in the table yet, so the frame is flooded out every port except ${inPort}.`
          : known === inPort
            ? `${fDst} was learned on ${inPort}, the port this frame arrived on, so the switch drops it (the hub already delivered it).`
            : `${fDst} was learned on ${known}, so the frame goes out ${known} only.`,
      ],
    };
  },
};
