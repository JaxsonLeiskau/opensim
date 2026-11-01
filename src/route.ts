import { DEFS, type Circuit, type Part, type Pt, type Props, type Wire } from './parts.ts';
import { corner, nets, onWire, pinPos, worldBox } from './netlist.ts';

const G = 20;
export interface SpecPart { type: string; name?: string; props?: Props; nodes: string[]; x?: number; y?: number; rot?: number }
export interface Spec { parts: SpecPart[] }
const uid = () => Math.random().toString(36).slice(2, 9);
const snap = (v: number) => Math.round(v / G) * G;
type Box = { x1: number; y1: number; x2: number; y2: number };
const overlap = (a: Box, b: Box, m: number) => a.x1 < b.x2 + m && b.x1 < a.x2 + m && a.y1 < b.y2 + m && b.y1 < a.y2 + m;
// does a straight segment pass through the inside of a box (touching the edge is fine)
function crosses(p: Pt, q: Pt, b: Box) {
  const i = { x1: b.x1 + 3, x2: b.x2 - 3, y1: b.y1 + 3, y2: b.y2 - 3 };
  if (p[1] === q[1]) return p[1] > i.y1 && p[1] < i.y2 && Math.max(p[0], q[0]) > i.x1 && Math.min(p[0], q[0]) < i.x2;
  return p[0] > i.x1 && p[0] < i.x2 && Math.max(p[1], q[1]) > i.y1 && Math.min(p[1], q[1]) < i.y2;
}

/** Place parts where the spec says (grid units) and draw real wires between pins of the same net. */
export function buildFromSpec(spec: Spec): { circuit: Circuit; warnings: string[] } {
  const parts: Part[] = [], wires: (Wire & { net: string })[] = [], warnings: string[] = [];
  const nameFor = (pre: string, want?: string) => {
    if (want && !parts.some(p => p.name === want)) return want;
    let n = 1; while (parts.some(p => p.name === pre + n)) n++; return pre + n;
  };
  const placed = spec.parts.every(s => Number.isFinite(s.x) && Number.isFinite(s.y));
  const minX = placed ? Math.min(...spec.parts.map(s => s.x!)) : 0, minY = placed ? Math.min(...spec.parts.map(s => s.y!)) : 0;
  const cols = Math.ceil(Math.sqrt(spec.parts.length));
  const pins: { pt: Pt; net: string }[] = [], owner: { part: Part; nodes: string[] }[] = [];

  spec.parts.forEach((s, i) => {
    const d = DEFS[s.type];
    if (!d) throw new Error(`Unknown part type "${s.type}"`);
    const props = Object.fromEntries(Object.entries(s.props ?? {}).map(([k, v]) => [k, String(v)]));
    const p: Part = {
      id: uid(), type: s.type, name: nameFor(d.prefix, s.name), rot: ((Math.round(s.rot ?? 0) % 4) + 4) % 4, props: { ...d.props, ...props },
      x: placed ? snap((s.x! - minX + 6) * G) : 120 + (i % cols) * 220, y: placed ? snap((s.y! - minY + 6) * G) : 120 + Math.floor(i / cols) * 200,
    };
    // keep a grid square between parts so pins of different parts never touch by accident
    while (parts.some(q => overlap(worldBox(p), worldBox(q), G))) p.x += 2 * G;
    parts.push(p);
    const nodes = s.nodes.map(n => n == null || n === '' ? '' : String(n).toLowerCase());
    owner.push({ part: p, nodes });
    pinPos(p).forEach((pt, j) => pins.push({ pt, net: nodes[j] || '#nc' + uid() }));
  });

  const ok = (ws: Wire[], net: string, strict: boolean) => ws.every(w =>
    pins.every(p => p.net === net || !onWire(p.pt, w)) &&
    wires.every(o => o.net === net || !(onWire(o.a, w) || onWire(o.b, w) || onWire(w.a, o) || onWire(w.b, o))) &&
    (!strict || parts.every(q => { const b = worldBox(q); return !crosses(w.a, corner(w), b) && !crosses(corner(w), w.b, b); })));
  const W = (a: Pt, b: Pt): Wire => ({ id: uid(), a, b });
  function* routes(a: Pt, b: Pt): Generator<Wire[]> {
    yield [W(a, b)]; yield [W(b, a)];
    const offs = [0, 1, -1, 2, -2, 3, -3, 4, -4, 6, -6].map(k => k * G);
    for (const o of offs) { const mx = snap((a[0] + b[0]) / 2) + o; yield [W(a, [mx, b[1]]), W([mx, b[1]], b)]; }
    for (const o of offs) { const my = snap((a[1] + b[1]) / 2) + o; yield [W([a[0], my], a), W([a[0], my], b)]; }
  }
  const clean = (ws: Wire[]) => ws.filter(w => w.a + '' !== w.b + '');

  const byNet = new Map<string, Pt[]>();
  for (const p of pins) if (!p.net.startsWith('#nc') && p.net !== '0') byNet.set(p.net, [...(byNet.get(p.net) || []), p.pt]);
  for (const [net, pts] of byNet) {
    // Prim's tree: join each pin to the nearest already-connected pin
    const tree = [pts[0]], rest = pts.slice(1);
    while (rest.length) {
      let best = [0, 0, Infinity];
      tree.forEach((t, i) => rest.forEach((r, j) => { const dd = Math.abs(t[0] - r[0]) + Math.abs(t[1] - r[1]); if (dd < best[2]) best = [i, j, dd]; }));
      const a = tree[best[0]], b = rest.splice(best[1], 1)[0];
      tree.push(b);
      if (a + '' === b + '') continue;
      let got: Wire[] | null = null;
      for (const strict of [true, false]) { for (const r of routes(a, b)) if (ok(clean(r), net, strict)) { got = clean(r); break; } if (got) break; }
      if (got) wires.push(...got.map(w => ({ ...w, net })));
      else {
        for (const q of [a, b]) parts.push({ id: uid(), type: 'LABEL', name: nameFor('NL'), x: q[0], y: q[1], rot: 0, props: { net } });
        warnings.push(`Couldn't find a clear wire path for net "${net}", so two pins there use net labels.`);
      }
    }
  }
  // each ground pin gets its own ground symbol on a short stub pointing away from the part
  for (const { part, nodes } of owner) pinPos(part).forEach((q, j) => {
    if (nodes[j] !== '0') return;
    const dx = Math.sign(q[0] - part.x), dy = dx ? 0 : Math.sign(q[1] - part.y) || 1;
    const end: Pt = [q[0] + dx * G, q[1] + dy * G], stub = W(q, end);
    const useStub = ok([stub], '0', false);
    if (useStub) wires.push({ ...stub, net: '0' });
    parts.push({ id: uid(), type: 'GND', name: nameFor('GND'), x: useStub ? end[0] : q[0], y: useStub ? end[1] : q[1], rot: dy > 0 ? 0 : dy < 0 ? 2 : dx > 0 ? 3 : 1, props: {} });
  });

  const circuit: Circuit = { parts, wires: wires.map(({ net: _n, ...w }) => w) };
  // self-check: the drawn wiring must give exactly the requested nets
  const got = nets(circuit), want2got = new Map<string, string>(), got2want = new Map<string, string>();
  for (const { part, nodes } of owner) got.get(part.id)!.forEach((g, j) => {
    const w = nodes[j]; if (!w) return;
    if ((want2got.get(w) ?? g) !== g || (got2want.get(g) ?? w) !== w) warnings.push(`Check ${part.name} pin ${DEFS[part.type].pinNames[j] || j + 1}: its wiring may not match net "${w}".`);
    want2got.set(w, g); got2want.set(g, w);
  });
  return { circuit, warnings };
}
