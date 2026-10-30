import { LEDCOL, fmt, parseVal, type Circuit, type Part } from './parts.ts';
import { nets } from './netlist.ts';

const E12 = [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2], E6 = [1, 1.5, 2.2, 3.3, 4.7, 6.8];
const POTS = [1e3, 5e3, 1e4, 5e4, 1e5, 5e5, 1e6];
const ZENERS = [3.3, 3.6, 3.9, 4.3, 4.7, 5.1, 5.6, 6.2, 6.8, 7.5, 8.2, 9.1, 10, 11, 12]; // 1N4728A..1N4742A
const nearest = (v: number, list: number[]) => list.reduce((b, m) => Math.abs(Math.log(m / v)) < Math.abs(Math.log(b / v)) ? m : b);
export function snap(v: number, s: number[]) {
  if (!(v > 0)) return v;
  const d = 10 ** Math.floor(Math.log10(v));
  return +nearest(v, [...s, 10].map(m => m * d)).toPrecision(3);
}
const BAND = ['#000', '#8b4513', '#e00', '#f80', '#ff0', '#0a0', '#00f', '#80f', '#888', '#fff'];
const BANDN = ['black', 'brown', 'red', 'orange', 'yellow', 'green', 'blue', 'violet', 'grey', 'white'];
function bands(v: number) {
  const ex = Math.floor(Math.log10(v) + 1e-9) - 1, d = Math.round(v / 10 ** ex);
  const mult = ex >= 0 ? ex : ex === -1 ? 'gold' : 'silver';
  const idx = [Math.floor(d / 10), d % 10];
  return { colors: [BAND[idx[0]], BAND[idx[1]], typeof mult === 'number' ? BAND[mult] : mult === 'gold' ? '#d4af37' : '#c0c0c0'],
    names: `${BANDN[idx[0]]}-${BANDN[idx[1]]}-${typeof mult === 'number' ? BANDN[mult] : mult}` };
}

// 830-point board: 63 columns, strips a-e (top) and f-j (bottom), two power rails at top and bottom
const COLS = 63, PITCH = 14, X0 = 30;
const X = (c: number) => X0 + (c - 1) * PITCH;
const ROWY = { T: (r: number) => 62 + r * PITCH, B: (r: number) => 146 + r * PITCH };
const RAILY = { 'T+': 20, 'T-': 34, 'B-': 230, 'B+': 244 };
const W = X0 * 2 + (COLS - 1) * PITCH, H = 266;
type H2 = [number, number];

interface Chip { name: string; desc: string; n: number; pins: (string | null)[] }
interface Placed { kind: string; label: string; holes: H2[]; desc: string; color?: string; val?: number }

export interface Board { svg: string; bom: [string, number][]; notes: string[]; cols: number; leads: [H2, string][]; jumpers: { a: H2; b: H2 }[] }

export function layout(c: Circuit): Board {
  const pinNet = nets(c), notes: string[] = [], bom = new Map<string, number>();
  const add = (d: string, q = 1) => bom.set(d, (bom.get(d) || 0) + q);
  const byType = (t: string) => c.parts.filter(p => p.type === t);

  // power rails: first two ground-referenced DC supplies become the top and bottom + rails
  const rail = new Map<string, 'T' | 'B'>(); const external: Part[] = [];
  const gndUsed = [...pinNet.values()].some(n => n.includes('0'));
  for (const p of byType('VDC')) {
    const [pos, neg] = pinNet.get(p.id)!;
    const net = neg === '0' ? pos : pos === '0' ? neg : null;
    if (net && !rail.has(net) && rail.size < 2) {
      const side = rail.size ? 'B' : 'T'; rail.set(net, side);
      notes.push(`Power: connect a ${p.props.voltage} V supply (${p.name}) ${neg === '0' ? '+' : '−'} lead to the ${side === 'T' ? 'top' : 'bottom'} red rail and the other lead to a blue rail.`);
    } else external.push(p);
  }
  const gates = c.parts.filter(p => GATE[p.type]);
  if (gates.length && !rail.size) { rail.set('__5v', 'T'); notes.push('Power: connect a 5 V supply to the top red rail and ground to the blue rail (needed by the logic chips).'); }
  const vccNet = [...rail.keys()][0];
  if (gates.length) {
    const vdc = byType('VDC').find(p => pinNet.get(p.id)!.includes(vccNet));
    if (vdc && parseVal(vdc.props.voltage) > 6) notes.push(`Warning: 74HC chips run on 2–6 V but the top rail is ${vdc.props.voltage} V.`);
  }
  const isRail = (n: string) => n === '0' || rail.has(n);

  // ---- pack ICs ----
  const chips: Chip[] = [];
  const groups = new Map<string, Part[]>();
  for (const g of gates) { const k = GATE[g.type][0]; groups.set(k, [...(groups.get(k) || []), g]); }
  for (const [name, list] of groups) {
    const [, desc, slots] = Object.values(GATE).find(x => x[0] === name)!;
    for (let i = 0; i < list.length; i += slots.length) {
      const pins: (string | null)[] = Array(15).fill(null); pins[7] = '0'; pins[14] = vccNet;
      slots.forEach((slot, s) => {
        const g = list[i + s], n = g ? pinNet.get(g.id)! : null;
        slot.forEach((pin, j) => { pins[pin] = n ? n[j] : j < slot.length - 1 ? '0' : null; }); // unused CMOS inputs tied to ground
      });
      chips.push({ name, desc, n: 14, pins });
    }
  }
  const amps = byType('OPAMP'), duals = new Map<string, Part[]>();
  for (const a of amps) {
    const n = pinNet.get(a.id)!;
    if (a.props.model === 'LM741') {
      const pins: (string | null)[] = Array(9).fill(null);
      [pins[2], pins[3], pins[6], pins[7], pins[4]] = n;
      chips.push({ name: 'LM741', desc: 'LM741 op-amp (DIP-8)', n: 8, pins });
    } else { const k = n[3] + '|' + n[4]; duals.set(k, [...(duals.get(k) || []), a]); }
  }
  let uid = 0;
  for (const list of duals.values()) for (let i = 0; i < list.length; i += 2) {
    const pins: (string | null)[] = Array(9).fill(null);
    [[3, 2, 1], [5, 6, 7]].forEach(([ip, im, out], s) => {
      const a = list[i + s];
      if (a) { const n = pinNet.get(a.id)!; [pins[im], pins[ip], pins[out], pins[8], pins[4]] = n; }
      else { const u = '__u' + uid++; pins[ip] = '0'; pins[im] = u; pins[out] = u; } // unused half as grounded follower
    });
    chips.push({ name: 'LM358', desc: 'LM358 dual op-amp (DIP-8)', n: 8, pins });
  }
  for (const t of byType('NE555')) chips.push({ name: 'NE555', desc: 'NE555 timer (DIP-8)', n: 8, pins: [null, ...pinNet.get(t.id)!] });

  // ---- board state ----
  const strips = new Map<string, { net: string | null; used: number }>();
  for (let col = 1; col <= COLS; col++) for (const h of 'TB') strips.set(h + col, { net: null, used: 0 });
  const homes = new Map<string, string[]>(), railHoles = new Set<string>(), jumpers: { a: H2; b: H2; color: string }[] = [];
  const placed: Placed[] = [], leads: [H2, string][] = [];
  let frontier = 1, maxCol = 0;
  const colOf = (k: string) => +k.slice(1);
  const holeIn = (k: string): H2 => {
    const s = strips.get(k)!, half = k[0] as 'T' | 'B';
    const r = half === 'T' ? 4 - s.used : s.used; s.used++;
    maxCol = Math.max(maxCol, colOf(k));
    return [X(colOf(k)), ROWY[half](r)];
  };
  const railHole = (net: string, col: number, half: 'T' | 'B'): H2 => {
    const key = net === '0' ? half + '-' : rail.get(net)! + '+';
    const y = RAILY[key as keyof typeof RAILY];
    for (let d = 0; d < COLS; d++) for (const cc of [col + d, col - d]) {
      if (cc < 1 || cc > COLS || cc % 6 === 0 || railHoles.has(key + cc)) continue;
      railHoles.add(key + cc); return [X(cc), y];
    }
    throw new Error('Out of rail holes');
  };
  const alloc = (net: string, anchor: number) => {
    for (let d = 0; d < COLS; d++) for (const cc of [anchor + d, anchor - d]) for (const h of 'TB') {
      const s = strips.get(h + cc);
      if (s && !s.net) { s.net = net; homes.set(net, [...(homes.get(net) || []), h + cc]); frontier = Math.max(frontier, cc); return h + cc; }
    }
    throw new Error('Circuit is too large for one 830-point breadboard.');
  };
  const sigColors = ['#2a9d8f', '#e9a23b', '#8338ec', '#06a77d', '#3a86ff', '#ef476f'];
  let ci = 0;
  const jumper = (a: H2, b: H2, net: string) => jumpers.push({ a, b, color: net === '0' ? '#222' : rail.has(net) ? '#d00' : sigColors[ci++ % sigColors.length] });
  // a hole on this net; the 5th hole of each strip is kept free so a full strip can be extended with a jumper
  const hole = (net: string, anchor: number, half: 'T' | 'B' = 'T'): H2 & { col?: number } => {
    if (isRail(net)) return railHole(net, anchor, half);
    const hs = homes.get(net) || [];
    const k = hs.find(k => strips.get(k)!.used < 4);
    if (k) return holeIn(k);
    const nk = alloc(net, anchor);
    if (hs.length) jumper(holeIn(hs[hs.length - 1]), holeIn(nk), net);
    return holeIn(nk);
  };

  // ---- place ICs straddling the centre gap ----
  let col = 2;
  for (const ch of chips) {
    const w = ch.n / 2, holes: H2[] = [];
    for (let p = 1; p <= ch.n; p++) {
      const k = p <= w ? 'B' + (col + p - 1) : 'T' + (col + ch.n - p), s = strips.get(k)!, net = ch.pins[p];
      if (!s) throw new Error('Circuit is too large for one 830-point breadboard.');
      s.net = net ?? '__nc'; holes.push(holeIn(k));
      if (!net) { s.used = 5; continue; }
      leads.push([holes[holes.length - 1], net]);
      if (isRail(net)) jumper(holeIn(k), railHole(net, colOf(k), k[0] as 'T' | 'B'), net);
      else if (homes.has(net)) { const other = homes.get(net)!.find(h => strips.get(h)!.used < 5)!; jumper(holeIn(k), holeIn(other), net); homes.get(net)!.push(k); }
      else homes.set(net, [k]);
    }
    placed.push({ kind: 'IC', label: ch.name, holes, desc: ch.desc });
    add(ch.desc);
    col += w + 1; frontier = col;
  }

  // ---- discrete parts, in connection order so related nets land next to each other ----
  const SKIP = new Set(['GND', 'LABEL', 'VDC', 'OPAMP', 'NE555', 'VPROBE', 'SCOPE', 'BODE', ...Object.keys(GATE)]);
  const todo = c.parts.filter(p => !SKIP.has(p.type) && !(p.type === 'MM' && p.props.mode !== 'A'));
  todo.push(...external);
  const order: Part[] = [];
  const seen = new Set<string>(homes.keys());
  while (todo.length) {
    let i = todo.findIndex(p => pinNet.get(p.id)!.some(n => seen.has(n)));
    if (i < 0) i = 0;
    const p = todo.splice(i, 1)[0]; order.push(p); pinNet.get(p.id)!.forEach(n => seen.add(n));
  }
  for (const p of order) {
    const n = pinNet.get(p.id)!;
    const known = n.map(x => homes.get(x)?.[0]).find(Boolean);
    let anchor = known ? colOf(known) : frontier + 1;
    const holes: H2[] = [];
    for (const net of n) {
      const h = hole(net, anchor, holes.length && holes[0][1] > 132 ? 'B' : 'T');
      holes.push(h); leads.push([h, net]); anchor = Math.round((h[0] - X0) / PITCH) + 1;
    }
    const v = parseVal(p.props.value);
    switch (p.type) {
      case 'R': { const s = snap(v, E12); if (s !== v) notes.push(`${p.name}: ${fmt(v, 'Ω')} → nearest standard ${fmt(s, 'Ω')}`); placed.push({ kind: 'R', label: p.name, holes, desc: fmt(s, 'Ω'), val: s }); add(`Resistor ${fmt(s, 'Ω')} ¼ W (${bands(s).names})`); break; }
      case 'C': { const s = snap(v, E6); if (s !== v) notes.push(`${p.name}: ${fmt(v, 'F')} → nearest standard ${fmt(s, 'F')}`); const el = s >= 1e-6; placed.push({ kind: el ? 'CE' : 'C', label: p.name, holes, desc: fmt(s, 'F'), val: s });
        add(el ? `Electrolytic capacitor ${fmt(s, 'F')} 25 V` : `Ceramic capacitor ${fmt(s, 'F')}`); if (el) notes.push(`${p.name} is electrolytic: put its − stripe on the lower-voltage side.`); break; }
      case 'L': { const s = snap(v, E6); placed.push({ kind: 'L', label: p.name, holes, desc: fmt(s, 'H') }); add(`Inductor ${fmt(s, 'H')}`); break; }
      case 'POT': { const s = nearest(v, POTS); placed.push({ kind: 'POT', label: p.name, holes, desc: fmt(s, 'Ω') }); add(`Potentiometer ${fmt(s, 'Ω')} (linear)`); break; }
      case 'D': placed.push({ kind: 'D', label: p.name, holes, desc: p.props.model }); add(`Diode ${p.props.model}`); break;
      case 'ZENER': { const z = nearest(parseFloat(p.props.voltage), ZENERS); placed.push({ kind: 'D', label: p.name, holes, desc: `${z}V`, color: '#c63' }); add(`Zener 1N${4728 + ZENERS.indexOf(z)}A (${z} V)`); break; }
      case 'LED': placed.push({ kind: 'LED', label: p.name, holes, desc: p.props.color, color: LEDCOL[p.props.color] }); add(`LED 5 mm ${p.props.color}`); notes.push(`${p.name}: the long leg (anode) goes in the first hole shown.`); break;
      case 'NPN': case 'PNP': case 'NMOS': case 'PMOS': placed.push({ kind: 'Q', label: p.name, holes, desc: p.props.model }); add(`${p.props.model} ${p.type === 'NPN' || p.type === 'PNP' ? p.type + ' transistor' : 'MOSFET'} (TO-92)`);
        notes.push(`${p.name} (${p.props.model}) leads: ${p.type.endsWith('MOS') ? 'D, G, S' : 'C, B, E'} as shown; check the datasheet pinout before inserting.`); break;
      case 'SWITCH': placed.push({ kind: 'SW', label: p.name, holes, desc: 'switch' }); add('Tactile push button or slide switch'); break;
      case 'MM': jumper(holes[0], holes[1], n[0]); notes.push(`${p.name}: ammeter — remove this jumper and put your meter (A mode) across the two holes.`); break;
      default: { // external sources: wires run off the board edge
        const what = p.type === 'VDC' ? `${p.props.voltage} V supply` : 'signal generator';
        holes.forEach((h, i) => jumpers.push({ a: h, b: [h[0], i ? H + 12 : -12], color: i ? '#222' : '#d60' }));
        placed.push({ kind: 'EXT', label: `${p.name} ${what}`, holes, desc: what }); add(`External ${what} (${p.name})`);
        notes.push(`${p.name}: connect your ${what} + to the orange wire and − / COM to the black wire.`);
      }
    }
  }
  if (gndUsed && [...railHoles].some(h => h.startsWith('B'))) { jumper([X(1), RAILY['T-']], [X(1), RAILY['B-']], '0'); notes.push('The black jumper on the left ties the top and bottom ground rails together.'); }
  for (const p of c.parts) {
    if (p.type === 'VPROBE' || (p.type === 'MM' && p.props.mode !== 'A') || p.type === 'SCOPE') {
      const where = pinNet.get(p.id)!.map(n => n === '0' ? 'ground rail' : rail.has(n) ? 'red rail' : homes.has(n) ? `column ${colOf(homes.get(n)![0])}${homes.get(n)![0][0] === 'T' ? ' (a–e)' : ' (f–j)'}` : 'n/a');
      notes.push(`${p.name}: measure at ${where.join(' and ')}.`);
    }
  }
  if (chips.length) notes.push('Tip: add a 100 nF ceramic capacitor across each chip\'s power pins.');
  if (jumpers.length) add('Jumper wires', jumpers.length);
  add('830-point breadboard');

  return { svg: draw(strips, placed, jumpers), bom: [...bom], notes, cols: maxCol, leads, jumpers };
}

const GATE: Record<string, [string, string, number[][]]> = {
  AND: ['74HC08', '74HC08 quad AND (DIP-14)', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  OR: ['74HC32', '74HC32 quad OR (DIP-14)', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  NAND: ['74HC00', '74HC00 quad NAND (DIP-14)', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  XOR: ['74HC86', '74HC86 quad XOR (DIP-14)', [[1, 2, 3], [4, 5, 6], [9, 10, 8], [12, 13, 11]]],
  NOR: ['74HC02', '74HC02 quad NOR (DIP-14)', [[2, 3, 1], [5, 6, 4], [8, 9, 10], [11, 12, 13]]],
  NOT: ['74HC04', '74HC04 hex inverter (DIP-14)', [[1, 2], [3, 4], [5, 6], [9, 8], [11, 10], [13, 12]]],
};

function draw(strips: Map<string, { net: string | null; used: number }>, placed: Placed[], jumpers: { a: H2; b: H2; color: string }[]) {
  const o: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="-10 -30 ${W + 20} ${H + 60}" class="bb">`,
    `<rect x="0" y="0" width="${W}" height="${H}" rx="8" fill="#f3efe6" stroke="#ccc"/>`, `<rect x="0" y="126" width="${W}" height="12" fill="#e2ddd2"/>`];
  for (const [k, y] of Object.entries(RAILY)) o.push(`<line x1="${X0 - 8}" x2="${W - X0 + 8}" y1="${y + (k.endsWith('+') ? -7 : 7) * (k[0] === 'T' ? 1 : -1)}" y2="${y + (k.endsWith('+') ? -7 : 7) * (k[0] === 'T' ? 1 : -1)}" stroke="${k.endsWith('+') ? '#e33' : '#36f'}" stroke-width="1.5"/>`);
  for (const [k, s] of strips) if (s.net && !s.net.startsWith('__nc')) {
    const half = k[0] as 'T' | 'B', x = X(+k.slice(1));
    o.push(`<rect x="${x - 5}" y="${ROWY[half](0) - 5}" width="10" height="${4 * PITCH + 10}" rx="3" fill="#bde3d6" opacity=".7"><title>net ${s.net}</title></rect>`);
  }
  for (let c = 1; c <= COLS; c++) {
    for (const half of ['T', 'B'] as const) for (let r = 0; r < 5; r++) o.push(`<rect x="${X(c) - 2}" y="${ROWY[half](r) - 2}" width="4" height="4" fill="#555"/>`);
    if (c % 6) for (const y of Object.values(RAILY)) o.push(`<rect x="${X(c) - 2}" y="${y - 2}" width="4" height="4" fill="#555"/>`);
    if (c === 1 || c % 5 === 0) o.push(`<text x="${X(c)}" y="54" font-size="7" text-anchor="middle" fill="#888">${c}</text>`);
  }
  'abcde'.split('').forEach((l, r) => o.push(`<text x="14" y="${ROWY.T(r) + 3}" font-size="7" fill="#888">${l}</text>`));
  'fghij'.split('').forEach((l, r) => o.push(`<text x="14" y="${ROWY.B(r) + 3}" font-size="7" fill="#888">${l}</text>`));
  const lead = (a: H2, b: H2) => `<line x1="${a[0]}" y1="${a[1]}" x2="${b[0]}" y2="${b[1]}" stroke="#9a9a9a" stroke-width="1.6"/>`;
  for (const p of placed) {
    const [a, b] = p.holes, mx = p.holes.reduce((s, h) => s + h[0], 0) / p.holes.length, my = p.holes.reduce((s, h) => s + h[1], 0) / p.holes.length;
    const tip = `<title>${p.label} ${p.desc}</title>`;
    if (p.kind === 'IC') {
      const xs = p.holes.map(h => h[0]), x1 = Math.min(...xs) - 6, x2 = Math.max(...xs) + 6;
      o.push(`<g>${tip}<rect x="${x1}" y="114" width="${x2 - x1}" height="36" rx="2" fill="#222"/><path d="M${x1} 126a6 6 0 0 1 0 12" fill="#555"/><circle cx="${x1 + 5}" cy="144" r="1.6" fill="#888"/><text x="${(x1 + x2) / 2}" y="135" font-size="8" fill="#eee" text-anchor="middle">${p.label}</text></g>`);
      continue;
    }
    if (p.kind === 'EXT') { o.push(`<text x="${a[0] + 4}" y="-16" font-size="8" fill="#a40">${p.label}</text>`); continue; }
    const ang = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI;
    const g = (inner: string) => `<g transform="translate(${mx},${my}) rotate(${ang})">${tip}${inner}</g>`;
    o.push(p.holes.map(h => lead(h, [mx, my])).join(''));
    if (p.kind === 'R') { const bc = bands(p.val!).colors; o.push(g(`<rect x="-11" y="-3.5" width="22" height="7" rx="3" fill="#e5cf9d"/>` + bc.map((c, i) => `<rect x="${-7 + i * 3.5}" y="-3.5" width="2" height="7" fill="${c}"/>`).join('') + `<rect x="6" y="-3.5" width="2" height="7" fill="#d4af37"/>`)); }
    else if (p.kind === 'C') o.push(g(`<circle r="5" fill="#e8a33a"/>`));
    else if (p.kind === 'CE') o.push(g(`<rect x="-7" y="-6" width="14" height="12" rx="3" fill="#2b4c9b"/><rect x="3" y="-6" width="3" height="12" fill="#ccd"/>`));
    else if (p.kind === 'L') o.push(g(`<rect x="-9" y="-4" width="18" height="8" rx="4" fill="#4a7"/>`));
    else if (p.kind === 'D') o.push(g(`<rect x="-8" y="-3" width="16" height="6" fill="${p.color || '#222'}"/><rect x="4" y="-3" width="2" height="6" fill="#ddd"/>`));
    else if (p.kind === 'LED') o.push(g(`<circle r="6" fill="${p.color}" stroke="#0004"/><path d="M4-4.5V4.5" stroke="#0006"/>`));
    else if (p.kind === 'Q') o.push(`<g>${tip}<path d="M${mx - 7} ${my + 4}V${my - 1}a7 7 0 0 1 14 0V${my + 4}Z" fill="#222"/></g>`);
    else if (p.kind === 'POT') o.push(`<g>${tip}<rect x="${mx - 9}" y="${my - 9}" width="18" height="18" rx="2" fill="#2d6cdf"/><circle cx="${mx}" cy="${my}" r="5" fill="#eee"/></g>`);
    else if (p.kind === 'SW') o.push(`<g>${tip}<rect x="${mx - 7}" y="${my - 7}" width="14" height="14" fill="#333"/><circle cx="${mx}" cy="${my}" r="4" fill="#777"/></g>`);
    o.push(`<text x="${mx}" y="${my - 9}" font-size="7" text-anchor="middle" fill="#333">${p.label}</text>`);
  }
  for (const j of jumpers) o.push(`<path d="M${j.a[0]} ${j.a[1]}Q${(j.a[0] + j.b[0]) / 2} ${Math.min(j.a[1], j.b[1]) - 10} ${j.b[0]} ${j.b[1]}" fill="none" stroke="${j.color}" stroke-width="2.4" stroke-linecap="round" opacity=".9"/>`);
  o.push('</svg>');
  return o.join('');
}
