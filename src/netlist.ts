import { DEFS, type Circuit, type Part, type Pt, type Wire } from './parts.ts';

export const rotPt = ([x, y]: Pt, r: number): Pt => { for (let i = 0; i < ((r % 4) + 4) % 4; i++) [x, y] = [-y, x]; return [x, y]; };
export const pinPos = (p: Part): Pt[] => DEFS[p.type].pins.map(q => { const [x, y] = rotPt(q, p.rot); return [p.x + x, p.y + y]; });
// wires are always drawn as an L: horizontal from a, then vertical to b
export const corner = (w: Wire): Pt => [w.b[0], w.a[1]];
const between = (v: number, a: number, b: number) => v >= Math.min(a, b) && v <= Math.max(a, b);
export const onSeg = (p: Pt, a: Pt, b: Pt) =>
  (p[0] === a[0] && a[0] === b[0] && between(p[1], a[1], b[1])) || (p[1] === a[1] && a[1] === b[1] && between(p[0], a[0], b[0]));
export const onWire = (p: Pt, w: Wire) => { const m = corner(w); return onSeg(p, w.a, m) || onSeg(p, m, w.b); };
const clean = (s: string) => (s || 'net').toLowerCase().replace(/[^a-z0-9_]/g, '_');

/** Map part id -> SPICE node name for each pin. Ground is "0", net labels name their net. */
export function nets(c: Circuit): Map<string, string[]> {
  const par = new Map<string, string>();
  const k = (p: Pt) => p[0] + ',' + p[1];
  const find = (x: string): string => {
    if (!par.has(x)) par.set(x, x);
    while (par.get(x) !== x) { par.set(x, par.get(par.get(x)!)!); x = par.get(x)!; }
    return x;
  };
  const union = (a: string, b: string) => par.set(find(a), find(b));
  const pts: Pt[] = [];
  for (const w of c.wires) { const m = corner(w); union(k(w.a), k(m)); union(k(m), k(w.b)); pts.push(w.a, w.b); }
  const pins = new Map(c.parts.map(p => [p.id, pinPos(p)]));
  for (const ps of pins.values()) for (const q of ps) { find(k(q)); pts.push(q); }
  for (const q of pts) for (const w of c.wires) if (onWire(q, w)) union(k(q), k(w.a));
  const named = new Map<string, string>();
  for (const p of c.parts) {
    const nm = p.type === 'GND' ? '0' : p.type === 'LABEL' ? clean(p.props.net) : null;
    if (nm == null) continue;
    const key = k(pins.get(p.id)![0]);
    if (named.has(nm)) union(key, named.get(nm)!); else named.set(nm, key);
  }
  const rootName = new Map<string, string>();
  if (named.has('0')) rootName.set(find(named.get('0')!), '0');
  for (const [nm, key] of named) if (!rootName.has(find(key))) rootName.set(find(key), nm);
  const used = new Set(rootName.values());
  let i = 1;
  const name = (key: string) => {
    const r = find(key);
    if (!rootName.has(r)) { let s: string; do s = 'n' + i++; while (used.has(s)); rootName.set(r, s); }
    return rootName.get(r)!;
  };
  return new Map(c.parts.map(p => [p.id, pins.get(p.id)!.map(q => name(k(q)))]));
}

export function toSpice(c: Circuit, analysis: string, pinNet = nets(c)): string {
  const models = new Set<string>(), lines = ['* OpenSim circuit'];
  for (const p of c.parts) {
    const s = DEFS[p.type].spice?.(p.name, pinNet.get(p.id)!, p.props, models);
    if (s) lines.push(s);
  }
  return [...lines, ...models, '.options rshunt=1e12', analysis, '.end'].join('\n');
}
