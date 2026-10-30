import { fmt } from './parts.ts';
import type { Out } from './sim.ts';

export const COLORS = ['#4fc3f7', '#ffb74d', '#81c784', '#e57373', '#ba68c8', '#fff176', '#4db6ac', '#f06292', '#a1887f', '#90a4ae'];
const L = 64, R = 14, T = 10, B = 26;

function ticks(a: number, b: number, n = 6) {
  const span = b - a || 1, st = 10 ** Math.floor(Math.log10(span / n)), e = span / n / st;
  const step = st * (e >= 7.5 ? 10 : e >= 3.5 ? 5 : e >= 1.5 ? 2 : 1), out: number[] = [];
  for (let v = Math.ceil(a / step) * step; v <= b + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}
const logTicks = (a: number, b: number) => { const o: number[] = []; for (let e = Math.ceil(a); e <= Math.floor(b); e++) o.push(e); return o; };

/** Draws all panes stacked; returns px->x mapping for the hover readout. */
export function plot(cv: HTMLCanvasElement, o: Out, hidden: Set<string>) {
  const dpr = devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
  cv.width = w * dpr; cv.height = h * dpr;
  const g = cv.getContext('2d')!;
  g.scale(dpr, dpr); g.clearRect(0, 0, w, h); g.font = '11px system-ui'; g.lineWidth = 1;
  const xs = (s: { x?: number[] }) => s.x ?? o.x ?? [];
  const tx = (v: number) => o.xlog ? Math.log10(Math.max(v, 1e-30)) : v;
  const all = o.panes.flatMap(p => p.series).filter(s => !hidden.has(s.name));
  let x0 = Infinity, x1 = -Infinity;
  for (const s of all) for (const v of xs(s)) { const t = tx(v); if (isFinite(t)) { x0 = Math.min(x0, t); x1 = Math.max(x1, t); } }
  if (!isFinite(x0)) return null;
  if (x0 === x1) { x0 -= 1; x1 += 1; }
  const px = (v: number) => L + (tx(v) - x0) / (x1 - x0) * (w - L - R);
  const ph = (h - B) / o.panes.length;
  let ci = 0;
  o.panes.forEach((p, i) => {
    const top = i * ph + T, bot = (i + 1) * ph - 4, ty = (v: number) => p.ylog ? Math.log10(Math.max(v, 1e-30)) : v;
    const ser = p.series.filter(s => !hidden.has(s.name));
    let y0 = Infinity, y1 = -Infinity;
    for (const s of ser) for (const v of s.y) { const t = ty(v); if (isFinite(t)) { y0 = Math.min(y0, t); y1 = Math.max(y1, t); } }
    if (o.bars) y0 = Math.min(y0, 0);
    if (!isFinite(y0)) { y0 = 0; y1 = 1; }
    if (y0 === y1) { y0 -= 1; y1 += 1; }
    const pad = (y1 - y0) * 0.05; y0 -= pad; y1 += pad;
    const py = (v: number) => bot - (ty(v) - y0) / (y1 - y0) * (bot - top);
    g.strokeStyle = '#333'; g.fillStyle = '#999'; g.textAlign = 'right';
    for (const t of p.ylog ? logTicks(y0, y1) : ticks(y0, y1, 5)) {
      const yy = bot - (t - y0) / (y1 - y0) * (bot - top);
      g.beginPath(); g.moveTo(L, yy); g.lineTo(w - R, yy); g.stroke();
      g.fillText(p.ylog ? fmt(10 ** t) : fmt(t), L - 4, yy + 4);
    }
    g.save(); g.translate(12, (top + bot) / 2); g.rotate(-Math.PI / 2); g.textAlign = 'center'; g.fillText(p.ylabel, 0, 0); g.restore();
    g.strokeStyle = '#555'; g.strokeRect(L, top, w - L - R, bot - top);
    g.save(); g.beginPath(); g.rect(L, top, w - L - R, bot - top); g.clip();
    for (const s of p.series) {
      const col = COLORS[ci++ % COLORS.length];
      if (hidden.has(s.name)) continue;
      g.strokeStyle = g.fillStyle = col; g.lineWidth = 1.5; g.beginPath();
      const x = xs(s);
      s.y.forEach((v, k) => {
        if (o.bars) { g.fillRect(px(x[k]) - 3, py(v), 6, py(Math.max(y0, 0)) - py(v)); return; }
        k ? g.lineTo(px(x[k]), py(v)) : g.moveTo(px(x[k]), py(v));
      });
      if (!o.bars) g.stroke();
    }
    g.restore();
  });
  g.fillStyle = '#999'; g.textAlign = 'center'; g.lineWidth = 1;
  for (const t of o.xlog ? logTicks(x0, x1) : ticks(x0, x1, 8)) {
    const xx = L + (t - x0) / (x1 - x0) * (w - L - R);
    g.strokeStyle = '#333'; g.beginPath(); g.moveTo(xx, T); g.lineTo(xx, h - B); g.stroke();
    g.fillText(o.xlog ? fmt(10 ** t) : fmt(t), xx, h - B + 14);
  }
  g.fillText(o.xlabel ?? '', w / 2, h - 2);
  return (pxv: number) => { const t = x0 + (pxv - L) / (w - L - R) * (x1 - x0); return o.xlog ? 10 ** t : t; };
}

/** Values of every visible series at x (nearest sample). */
export function readout(o: Out, hidden: Set<string>, x: number) {
  return o.panes.flatMap(p => p.series).filter(s => !hidden.has(s.name)).map(s => {
    const xs = s.x ?? o.x ?? [];
    let lo = 0, hi = xs.length - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; xs[m] <= x ? lo = m : hi = m; }
    const k = Math.abs(xs[hi] - x) < Math.abs(xs[lo] - x) ? hi : lo;
    return `${s.name}: ${fmt(s.y[k])}`;
  });
}
