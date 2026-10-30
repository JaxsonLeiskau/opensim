import { fmt, parseVal, type Circuit, type Props } from './parts.ts';
import { nets, toSpice } from './netlist.ts';

export interface Series { name: string; y: number[]; x?: number[] }
export interface Pane { ylabel: string; series: Series[]; ylog?: boolean }
export interface Out { x?: number[]; xlabel?: string; xlog?: boolean; bars?: boolean; panes: Pane[]; table?: string[][]; op?: Record<string, number>; netlist: string }
type Run = (netlist: string) => Promise<{ result: any; errors: string[] }>;

let worker: Worker | null = null, seq = 0;
const pending = new Map<number, { res: (v: any) => void; rej: (e: Error) => void }>();
function boot() {
  worker = new Worker(new URL('./simworker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = e => {
    const p = pending.get(e.data.id); pending.delete(e.data.id);
    e.data.ok ? p?.res(e.data) : p?.rej(new Error(e.data.error));
  };
}
let run: Run = netlist => new Promise((res, rej) => {
  if (!worker) boot();
  const id = ++seq; pending.set(id, { res, rej }); worker!.postMessage({ id, netlist });
});
export const setRunner = (r: Run) => { run = r; };
export function stop() {
  worker?.terminate(); worker = null;
  for (const p of pending.values()) p.rej(new Error('Stopped'));
  pending.clear();
}

const v = (s: string) => String(parseVal(s));
export const lineFor = (kind: string, a: Props) => ({
  op: () => '.op',
  tran: () => `.tran ${v(a.step)} ${v(a.stop)} 0 ${v(a.step)}`,
  ac: () => `.ac dec ${+a.points || 20} ${v(a.fstart)} ${v(a.fstop)}`,
  dc: () => `.dc ${a.source} ${v(a.start)} ${v(a.stop)} ${v(a.incr)}`,
  noise: () => `.noise v(${a.output}) ${a.source} dec ${+a.points || 10} ${v(a.fstart)} ${v(a.fstop)}`,
}[kind]?.() ?? '.op');

/** A probe/label part name (e.g. PR1) resolves to its net; anything else is taken as a net name. */
export function resolveNet(c: Circuit, s: string, pinNet = nets(c)) {
  const p = c.parts.find(p => p.name.toLowerCase() === s.trim().toLowerCase());
  return p && pinNet.get(p.id)!.length === 1 ? pinNet.get(p.id)![0] : s.trim().toLowerCase();
}

function watch(c: Circuit, pinNet: Map<string, string[]>) {
  const nodes = new Set<string>(); let bode: string[] | null = null; const amps: string[] = [];
  for (const p of c.parts) {
    const n = pinNet.get(p.id)!;
    if (p.type === 'VPROBE') nodes.add(n[0]);
    if (p.type === 'SCOPE') n.forEach(x => nodes.add(x));
    if (p.type === 'BODE') bode = n;
    if (p.type === 'MM' && p.props.mode === 'A') amps.push(`i(v${p.name.toLowerCase()})`);
  }
  if (!nodes.size) for (const n of pinNet.values()) n.forEach(x => nodes.add(x));
  nodes.delete('0');
  return { nodes: [...nodes].sort(), bode, amps };
}
const internal = (n: string) => n.includes('.') || n.includes('#') || /_i\)$/.test(n);

async function single(c: Circuit, kind: string, a: Props): Promise<Out> {
  const pinNet = nets(c);
  if (kind === 'noise') a = { ...a, output: resolveNet(c, a.output, pinNet) };
  const netlist = toSpice(c, lineFor(kind, a), pinNet);
  const { result, errors } = await run(netlist);
  if (!result?.numPoints) throw new Error((errors || []).join('\n') || 'Simulation failed. Check that every part is connected and the circuit has a ground.');
  const get = (n: string) => result.data.find((d: any) => d.name === n)?.values;
  const w = watch(c, pinNet);
  const volts = (f: (y: any[]) => number[]) => w.nodes.map(n => ({ name: `V(${n})`, y: get(`v(${n})`) })).filter(s => s.y).map(s => ({ ...s, y: f(s.y) }));
  const id = (y: any[]) => y as number[];
  if (kind === 'op') {
    const op: Record<string, number> = {};
    for (const d of result.data) op[d.name] = d.values[0];
    const rows = result.data.filter((d: any) => !internal(d.name)).map((d: any) => [d.name, fmt(d.values[0], d.name.startsWith('i(') ? 'A' : 'V')]);
    return { panes: [], op, table: [['Quantity', 'Value'], ...rows], netlist };
  }
  if (kind === 'tran' || kind === 'dc') {
    const panes: Pane[] = [{ ylabel: 'Voltage (V)', series: volts(id) }];
    const cur = w.amps.map(n => ({ name: n.toUpperCase(), y: get(n) })).filter(s => s.y);
    if (cur.length) panes.push({ ylabel: 'Current (A)', series: cur });
    return { x: result.data[0].values, xlabel: kind === 'tran' ? 'Time (s)' : `${a.source} (V/A)`, panes, netlist };
  }
  if (kind === 'ac') {
    const x = get('frequency').map((z: any) => z.real ?? z);
    const mag = (z: any) => 20 * Math.log10(Math.hypot(z.real, z.img));
    const ph = (z: any) => Math.atan2(z.img, z.real) * 180 / Math.PI;
    let m: Series[], p: Series[];
    if (w.bode) {
      const [i, o] = w.bode.map(n => n === '0' ? null : get(`v(${n})`));
      if (!i || !o) throw new Error('Bode plotter IN and OUT must connect to non-ground nets.');
      const r = o.map((z: any, k: number) => { const d = i[k].real ** 2 + i[k].img ** 2; return { real: (z.real * i[k].real + z.img * i[k].img) / d, img: (z.img * i[k].real - z.real * i[k].img) / d }; });
      m = [{ name: 'Gain', y: r.map(mag) }]; p = [{ name: 'Phase', y: r.map(ph) }];
    } else { m = volts(y => y.map(mag)); p = volts(y => y.map(ph)); }
    return { x, xlog: true, xlabel: 'Frequency (Hz)', panes: [{ ylabel: 'Magnitude (dB)', series: m }, { ylabel: 'Phase (°)', series: p }], netlist };
  }
  if (kind === 'noise') {
    const series = ['onoise_spectrum', 'inoise_spectrum'].map(n => ({ name: n, y: get(n) })).filter(s => s.y);
    return { x: get('frequency'), xlog: true, xlabel: 'Frequency (Hz)', panes: [{ ylabel: 'Noise (V/√Hz)', series, ylog: true }], netlist };
  }
  throw new Error('Unknown analysis ' + kind);
}

function interp(t: number[], y: number[], at: number) {
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; t[m] <= at ? lo = m : hi = m; }
  const f = (at - t[lo]) / ((t[hi] - t[lo]) || 1);
  return y[lo] + (y[hi] - y[lo]) * Math.min(Math.max(f, 0), 1);
}
export function harmonics(t: number[], y: number[], f: number, cycles: number, settle: number, H: number) {
  const N = 256, M = N * cycles, per = 1 / f, s: number[] = [];
  for (let i = 0; i < M; i++) s.push(interp(t, y, settle * per + i * per / N));
  const out: { k: number; mag: number; phase: number }[] = [];
  for (let k = 0; k <= H; k++) {
    let re = 0, im = 0;
    for (let i = 0; i < M; i++) { const ang = 2 * Math.PI * k * i / N; re += s[i] * Math.cos(ang); im -= s[i] * Math.sin(ang); }
    const sc = k === 0 ? 1 / M : 2 / M;
    out.push({ k, mag: Math.hypot(re, im) * sc, phase: Math.atan2(im, re) * 180 / Math.PI });
  }
  const thd = Math.sqrt(out.slice(2).reduce((s, h) => s + h.mag ** 2, 0)) / (out[1].mag || 1);
  return { out, thd };
}

async function fourier(c: Circuit, a: Props): Promise<Out> {
  const f = parseVal(a.freq), cyc = +a.cycles || 5, settle = +a.settle || 5, H = +a.harmonics || 9;
  const per = 1 / f, node = resolveNet(c, a.node);
  const r = await single(c, 'tran', { stop: String((settle + cyc) * per), step: String(per / 200) });
  const s = r.panes[0].series.find(s => s.name === `V(${node})`);
  if (!s) throw new Error(`Net "${node}" not found. Use a net label or voltage probe name.`);
  const { out, thd } = harmonics(r.x!, s.y, f, cyc, settle, H);
  return {
    x: out.map(h => h.k * f), xlabel: 'Frequency (Hz)', bars: true, netlist: r.netlist,
    panes: [{ ylabel: `|V(${node})| (V)`, series: [{ name: 'Harmonic magnitude', y: out.map(h => h.mag) }] }],
    table: [['Harmonic', 'Frequency', 'Magnitude', 'Phase', 'Normalized'],
      ...out.map(h => [h.k ? String(h.k) : 'DC', fmt(h.k * f, 'Hz'), fmt(h.mag, 'V'), h.k ? h.phase.toFixed(1) + '°' : '', h.k ? (h.mag / (out[1].mag || 1)).toFixed(4) : '']),
      ['THD', '', (thd * 100).toFixed(3) + ' %', '', '']],
  };
}

async function sweep(c: Circuit, a: Props, S: Record<string, Props>): Promise<Out> {
  const vals = (a.values || '').split(',').map(s => s.trim()).filter(Boolean);
  if (!c.parts.some(p => p.name === a.part)) throw new Error(`No part named ${a.part}`);
  let res: Out | null = null; const table: string[][] = [];
  for (const val of vals) {
    const c2: Circuit = structuredClone(c);
    c2.parts.find(p => p.name === a.part)!.props[a.prop] = val;
    const o = await single(c2, a.inner, S[a.inner] || {});
    if (a.inner === 'op') {
      if (!table.length) table.push([`${a.part}.${a.prop}`, ...o.table!.slice(1).map(r => r[0])]);
      table.push([val, ...o.table!.slice(1).map(r => r[1])]);
      res = { panes: [], netlist: o.netlist, table };
      continue;
    }
    for (const p of o.panes) for (const s of p.series) { s.name += ` [${a.prop}=${val}]`; s.x = o.x; }
    if (!res) res = o; else o.panes.forEach((p, i) => res!.panes[i].series.push(...p.series));
  }
  if (!res) throw new Error('Enter at least one sweep value');
  return res;
}

export function analyze(c: Circuit, kind: string, S: Record<string, Props>): Promise<Out> {
  if (kind === 'fourier') return fourier(c, S.fourier);
  if (kind === 'sweep') return sweep(c, S.sweep, S);
  return single(c, kind, S[kind] || {});
}
