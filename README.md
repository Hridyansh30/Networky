i want to build a project where people can simulate and study computer networks a drag drop based devices , routes, hubs and all 7 layerered devices to be used to create a custom network and connect them with differetn suitable cables as required, i also want each device or sever to be used as a sperate device like terminal , web ui and learn and try out all concepts of computer netwrok where we can also replicate aws vpcs, dns, rips, routing, i will send you the exact goal and feature list later lets ideate on how it can be done you can refer to newton packet tracer for referenceBuilt by Kavya and Hridyansh

---

## Phase 1: network builder (done)

Build a network on a canvas, configure each device, save it and load it back. There is no packet simulation yet (that is phase 2).

### Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm test           # model + store unit tests
npm run build      # type-check + production build
```

### How to use

- Drag a device from the left palette onto the canvas, or click a tile to drop it in the middle.
- Pick a cable type in the toolbar, then drag from one port dot to another. Impossible cables are refused with the reason.
- Click a device to edit its hostname, interface IPs (`10.0.0.1/24` or `10.0.0.1 255.255.255.0`), gateway (PC and server) and static routes (router).
- The issues bar lists config mistakes live; click one to jump to the device.
- `Delete` removes the selection, `Ctrl+Z` / `Ctrl+Shift+Z` undo and redo, Save and Load use a `.networky.json` file.

### Layout

```
src/model/   pure TypeScript: types, catalog, ops, ip, validate, serialize (+ tests). No React.
src/store/   Zustand store: current topology + layout + undo history
src/ui/      React components; React Flow nodes and edges are derived from the model
```

The model never imports from `store/` or `ui/`. Keep it that way: the phase 2 engine and later exporters read the model directly.


## Phase 2: packet engine (done)

Ping between devices and watch every frame move, one cable per step.

- **Examples** in the toolbar load ready-made networks: hub vs switch, two LANs with a router, two routers with static routes.
- In the **Simulation** tab pick a source and a destination IP, press **Ping**, then **Step** (one hop) or **Play**. Envelopes on the cables are frames: amber = ARP, blue = ICMP, red = ICMP error. Hover one to see what it is.
- **Traceroute** runs instantly and lists every router on the path.
- Select a device to see what it has *learned*: ARP cache (hosts, routers), MAC address table (switches), routing table (routers).
- Editing the network restarts every device (tables cleared). Moving devices does not.

What the engine models: hub repeating, switch MAC learning / flooding / filtering, NIC MAC filtering, ARP request/reply and caching, IPv4 + ICMP echo, host gateway logic, connected and static routes with longest-prefix match, TTL and time-exceeded, destination unreachable, point-to-point serial links, broadcast storms from switching loops.

Not yet: collisions on hubs, VLANs, STP, dynamic routing (RIP/OSPF), DHCP, NAT, ACLs, a CLI.

```
src/engine/  packets.ts (frame formats) · routing.ts (routing table + LPM) · simulation.ts (the engine) · traceroute.ts
```

The engine imports the model and nothing from React. `src/engine/simulation.test.ts` is the best place to see it work.
