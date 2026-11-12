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

- Labs (Projects → Sample labs, or Learn) load ready-made networks.
- Switch the top bar to **Simulation**, send a ping from the bottom panel, then **Step** (one hop) or **Play**. Envelopes on the cables are frames, coloured by protocol (see the legend). Click a row in the event list to open the frame by OSI layer.
- `tracert` in a host's Command Prompt (or `traceroute` in a router's CLI) lists every router on the path.
- The **Tables** tab shows what a device has *learned*: ARP cache, MAC address table, routing table and more.
- Editing the network restarts every device (tables cleared). Moving devices does not.

What the engine models: hub repeating, switch MAC learning / flooding / filtering, NIC MAC filtering, ARP request/reply and caching, IPv4 + ICMP echo, host gateway logic, connected and static routes with longest-prefix match, TTL and time-exceeded, destination unreachable, point-to-point serial links, broadcast storms from switching loops.

Phase 3 added VLANs, STP, dynamic routing, DHCP, NAT, ACLs, IPv6, TCP and a CLI (below). Still not modelled: collisions on hubs.

```
src/engine/  packets.ts (frame formats) · routing.ts (routing table + LPM) · simulation.ts (the engine) · traceroute.ts
```

The engine imports the model and nothing from React. `src/engine/simulation.test.ts` is the best place to see it work.


## Phase 3: protocols, CLI and the new interface (done)

### What you can do

- **Pages:** Home, Projects (saved networks with thumbnails, star, rename, export, delete, plus sample labs), Learn (10 labs filtered by level and topic, each with exercises), and the Workspace.
- **Lab links:** `#/lab/<id>` opens a fresh, unsaved copy of a sample lab in the workspace (ids are the `id` field in `src/model/examples.ts`, e.g. `#/lab/ospf-cheapest-path`). An unknown id goes to Learn; unsaved work is never replaced without asking.
- **Workspace:** device palette and a topology outline on the left, the canvas in the middle, an inspector on the right, and a bottom panel with results, the event list, configuration issues and lab exercises.
- **Device window:** double-click a device.
  - PC and laptop: **Desktop** (IP Configuration, Command Prompt, Web Browser, Email, Messaging and FTP Client) and **Config** (IP mode DHCP/static, address, subnet mask, MAC, status, IPv6 with SLAAC, gateways, DNS server).
  - Server: the same, plus a **DHCP Server** app and a **Services** tab (HTTP pages, DNS records, mail domain and accounts, FTP accounts and files).
  - Router and switch: **Config**, **CLI** and **Tables**.
  - Hub: **Config** only.
- **CLI:** IOS-style modes (`>`, `#`, `(config)#`, `(config-if)#`, router, DHCP pool and named-ACL modes), unique-prefix abbreviations (`conf t`, `sh ip int br`), `?` help, Tab completion, `no` and `do`, and a caret under invalid input. `show running-config` is generated from the model.
- **Realtime / Simulation:** Realtime is the converged network, where everything answers at once. Simulation moves frames one hop per step. **Watch boot** replays STP, RIP/OSPF and DHCP starting up.
- **Light and dark themes.** Every colour lives in `src/theme/tokens.css`.

### Protocols

| Protocol | Where | What is modelled |
|---|---|---|
| VLANs, 802.1Q | engine core + switch | access and trunk ports, native VLAN, allowed lists, router-on-a-stick subinterfaces |
| STP | `plugins/stp.ts` | root election by priority then MAC, root/designated/alternate ports, blocking shown as amber port lights |
| DHCP | `plugins/dhcp.ts` | DORA, pools with excluded addresses, default router and DNS, relay through `ip helper-address` |
| ACL | `plugins/acl.ts` | standard and extended, numbered and named, in/out per interface, implicit deny, hit counters |
| NAT | `plugins/nat.ts` | static NAT and PAT (overload) with a translation table |
| RIP | `plugins/rip.ts` | RIPv2, hop count, split horizon, 16 = unreachable |
| OSPF | `plugins/ospf.ts` | hellos, neighbours, LSAs, Dijkstra, cost = 100 Mbps ÷ bandwidth, `ip ospf cost` |
| IPv6 | `plugins/ipv6.ts` | link-local (EUI-64), NDP neighbour discovery, SLAAC, ICMPv6, static routes |
| TCP | `plugins/tcp.ts` | connection tests: SYN, SYN-ACK or RST, through ACLs and NAT |
| HTTP, DNS, SMTP, POP3, FTP, chat | `plugins/apps/` | one request and reply per exchange, over the same TCP/UDP path, so ACLs, NAT and unreachable routes apply |

Route preference follows administrative distance: connected 0, static 1, OSPF 110, RIP 120.

### Where Networky is simpler than real IOS / Packet Tracer

These are deliberate. Each one keeps the model small enough to read.
- STP: one tree for all VLANs (not per-VLAN), and ports go straight to forwarding or blocking with no listening or learning timers.
- OSPF: a single area with no DR/BDR election. The process id always shows as 1.
- RIP sends triggered updates only, with no 30-second timer and no hold-down.
- DHCP leases never expire.
- NAT translates ICMP by echo id.
- No DTP: trunks are set explicitly.
- No hub collisions.
- Simulated time: one tick is one hop, shown as 1 ms.

### Architecture

```
model/    pure data + ops (no React). Every edit is an op that returns a new Topology or throws.
engine/   Simulation (the clock) + EnginePlugin hooks. Each protocol is one plugin in engine/plugins/.
cli/      IOS command registry, show commands, running-config, host command prompt
inspect/  tables (show commands as data) and PDU details by OSI layer
interop/  importers and exporters: Cisco IOS config in/out, Terraform for AWS, Networky JSON
storage/  ProjectRepository interface: IndexedDB in the browser, memory in tests
store/    Zustand stores: topology (+ undo), simulation, terminals, project, UI
ui/       React: workspace components, device window, Desktop app registry (ui/apps)
pages/    Home, Projects, Learn, Workspace (hash router in app/router.ts)
```

Dependencies only point down the list: the model knows nothing above it, and the engine knows nothing about React. The CLI and the forms call the **same** model ops, so they can never disagree.

### Adding a protocol

1. Create `src/engine/plugins/<name>.ts` exporting an `EnginePlugin`. Keep its state in `sim.state('<name>', init)`, and only use the `SimApi` it is given.
2. Use the hooks you need (all optional, see `src/engine/plugin.ts`): `boot` and `onIdle`; `handleFrame` / `handleSwitchFrame` / `portForwards` for layer 2; `ipv4Ingress` / `ipv4Egress` to filter or rewrite packets; `routes`, `ipv4Of`, `gatewayOf`, `deliverIpv4`, `startProbe`; `tag`, `describe` and `portStatus` for what the UI shows.
3. Add it to `DEFAULT_PLUGINS` in `src/engine/plugins/index.ts`. Removing it from that list removes the feature. `plugins/__tests__/modularity.test.ts` checks that the rest still works.
4. Add its config to `model/types.ts`, an op to `model/ops.ts`, a strict schema to `model/serialize.ts`, and CLI commands to `cli/ios.ts`.

### Adding a Desktop app

Add an entry to `HOST_APPS` in `src/ui/apps/index.ts`: `{ id, title, icon, kinds, Component }`. The device window shows a tile for it on every device whose kind is listed. Nothing else changes.

### Security

- Opened files are untrusted. `deserialize` rejects files over 2 MB, enforces count limits, and runs strict Zod schemas (unknown keys are refused). A JSON reviver blocks `__proto__`, `constructor` and `prototype` keys, which prevents prototype pollution.
- Saved projects are stored as text and re-validated on every load.
- The production build ships a Content-Security-Policy with no network access (`connect-src 'none'`) and no inline scripts. Set `frame-ancestors` as an HTTP header when deploying. Zod runs in jitless mode (`src/zodConfig.ts`, the first import in `main.tsx`), so the policy never needs `'unsafe-eval'`.
- Terminal input is capped at 512 characters per line and scrollback at 2000 lines.
- Web pages served by a simulated server are never given to the real browser as HTML. `apps/html.ts` parses them into an allow-list of tags (no attributes except a checked `href`), and React renders that tree as text. No `innerHTML` anywhere.
- Passwords in mail and FTP accounts are stored in plain text on purpose, so you can watch them cross the wire, which is exactly why plain FTP and POP3 are unsafe.

## Phase 4: import and export (done)

**Export** (top bar, Export) shows a live preview of the file before you download or copy it:

| Format | File | What is in it |
|---|---|---|
| Networky project | `<name>.networky.json` | Everything. Open it again with Open. |
| Cisco IOS configuration | `<name>-cisco.txt` | The running-config of every router and switch, ready to paste after `configure terminal`. Cables and end devices are listed as `!` comments. |
| Terraform for an AWS VPC | `<name>-aws.tf` | The network translated into AWS resources. Review it, then run `terraform init / plan / apply` yourself. |

**Import** (top bar, Import) takes a pasted or chosen `show running-config` from one or more devices. Each `hostname` line starts a device; a device that does not exist yet is created. The report updates as you type and shows exactly what Apply will do: which devices, which lines failed and why, and what was skipped. **Merge** adds to the existing config (like `copy tftp running-config`); **Replace** resets each listed device first and keeps its cables. Either way it is one undo step.

### How the Terraform translation works

AWS is not a router you configure; it is a set of managed resources. So the exporter translates meaning, not commands, and lists everything it could not translate in the file header and in the dialog.

| In Networky | In AWS |
|---|---|
| The LAN behind a router interface (or a VLAN subinterface) | `aws_subnet` in one `aws_vpc`; the VPC CIDR is the smallest block that covers them, extra /16s become secondary CIDR blocks |
| A link between two routers only | Nothing: the VPC router already knows every subnet. Static routes, RIP and OSPF are not exported |
| Switches, hubs, VLANs, STP | Nothing: AWS runs layer 2 for you |
| PAT (`ip nat inside source ... overload`) | Internet gateway + Elastic IP + NAT gateway in a new public subnet, and a private route table for the inside LANs |
| An ACL applied `in` on a LAN interface | That subnet's network ACL **egress** rules (traffic leaving the subnet), in order |
| An ACL applied `out` | **ingress** rules |
| DHCP pool `dns-server` | `aws_vpc_dhcp_options` |
| PCs, laptops, servers | `aws_instance`, off unless `create_instances = true` (they cost money) |

Rules AWS cannot express are reported, not guessed: an ACL line that matches only part of a subnet (that is a security group's job), addresses AWS reserves (the first four and the last of each subnet), and mixing two RFC 1918 blocks in one VPC.

### Import safety

- Limits: 200 KB, 5000 lines, 512 characters per line, 50 devices. Text with control characters is refused.
- Lines are replayed through the **same** CLI as the terminal, in an offline mode where `ping`, `traceroute` and other exec commands cannot run.
- Passwords, secrets, `username`, `enable secret`, SNMP communities and keys are never imported. Banners, `line`, `clock` and other commands Networky does not model are listed as skipped.
- Nothing changes until you press Apply. The text is never stored or sent anywhere.
- Every string written into Terraform goes through `hclString` (`src/interop/hcl.ts`), which escapes `${` and `%{`. A device or project named `${file("~/.aws/credentials")}` stays a harmless string instead of becoming an expression `terraform plan` would run.
- Networky never contacts AWS and never sees credentials. You run Terraform on your own machine.

### Adding an exporter

Write a function from `{ topology, layout, name }` to `{ fileName, mime, text, notes }` (see `src/interop/types.ts`) and add it to `EXPORTERS` in `src/interop/index.ts`. The Export dialog lists it, previews it and downloads it. Exporters are pure TypeScript with no React or DOM, so they are easy to test.

## Tests

`npm test` runs about 370 tests:
- model ops, validation and serialization, including the security cases;
- every protocol plugin and a modularity check;
- every lab exercise, booted and run;
- the CLI;
- UI tests (jsdom) that type into a device's terminal and fill in the device window the way a user would.
- import/export: every lab round-trips through Cisco export and import with no errors, every lab exports to well-formed Terraform, and the HCL injection cases.
