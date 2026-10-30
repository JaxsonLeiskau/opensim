import { DEFS, type Circuit, type Part, type Pt, type Props } from './parts.ts';
import { corner, onWire, pinPos, rotPt } from './netlist.ts';

const G = 20, KEY = 'opensim.autosave';
const snap = (v: number) => Math.round(v / G) * G;
const uid = () => Math.random().toString(36).slice(2, 9);
export type Sel = { kind: 'part' | 'wire'; id: string } | null;
export interface Spec { parts: { type: string; name?: string; props?: Props; nodes: string[] }[] }

export function createEditor(svg: SVGSVGElement, onSelect: (s: Sel) => void) {
  let c: Circuit = JSON.parse(localStorage.getItem(KEY) || 'null') ?? { parts: [], wires: [] };
  let sel: Sel = null, mode: 'select' | 'place' | 'wire' = 'select', placing = '', ghostRot = 0;
  let mouse: Pt = [0, 0], wireStart: Pt | null = null, drag: any = null, pan: any = null;
  const view = { x: 40, y: 40, k: 1 }, undo: string[] = [], redo: string[] = [];
  let annot = new Map<string, string>();

  const save = () => localStorage.setItem(KEY, JSON.stringify(c));
  const mutate = (fn: () => void) => { undo.push(JSON.stringify(c)); if (undo.length > 200) undo.shift(); redo.length = 0; fn(); annot.clear(); save(); render(); };
  const nextName = (prefix: string) => {
    let n = 1; const re = new RegExp(`^${prefix}(\\d+)$`);
    for (const p of c.parts) { const m = p.name.match(re); if (m) n = Math.max(n, +m[1] + 1); }
    return prefix + n;
  };
  const newPart = (type: string, x: number, y: number, rot = 0, props?: Props, name?: string): Part =>
    ({ id: uid(), type, name: name || nextName(DEFS[type].prefix), x, y, rot, props: { ...DEFS[type].props, ...props } });

  function worldBox(p: { x: number; y: number; rot: number; type: string }) {
    const [x1, y1, x2, y2] = DEFS[p.type].box;
    const cs = ([[x1, y1], [x2, y2]] as Pt[]).map(q => rotPt(q, p.rot));
    return { x1: p.x + Math.min(cs[0][0], cs[1][0]), x2: p.x + Math.max(cs[0][0], cs[1][0]), y1: p.y + Math.min(cs[0][1], cs[1][1]), y2: p.y + Math.max(cs[0][1], cs[1][1]) };
  }
  function partSvg(p: Part, cls: string) {
    const d = DEFS[p.type], b = worldBox(p), val = d.value?.(p.props) ?? '', a = annot.get(p.id);
    const lines = [d.hideName ? '' : p.name, val].filter(Boolean);
    if (a) lines.push(`<tspan class="annot">${a}</tspan>`);
    const vertical = p.rot % 2 === 1 && d.pins.length > 1;
    const [tx, ty, anchor] = vertical ? [b.x2 + 5, (b.y1 + b.y2) / 2 - (lines.length - 1) * 6 + 4, 'start'] : [(b.x1 + b.x2) / 2, b.y1 - 5 - (lines.length - 1) * 12, 'middle'];
    const text = lines.map((l, i) => `<tspan x="${tx}" y="${ty + i * 12}">${l}</tspan>`).join('');
    return `<g class="part ${cls}" transform="translate(${p.x},${p.y}) rotate(${p.rot * 90})">${d.svg(p.props)}</g><text class="lbl" text-anchor="${anchor}">${text}</text>`;
  }

  function render() {
    const o: string[] = [`<defs><pattern id="grid" width="${G}" height="${G}" patternUnits="userSpaceOnUse"><circle cx="0" cy="0" r="1" class="dot"/></pattern></defs>`,
      `<g transform="translate(${view.x},${view.y}) scale(${view.k})">`,
      `<rect x="${-view.x / view.k - G}" y="${-view.y / view.k - G}" width="${svg.clientWidth / view.k + 2 * G}" height="${svg.clientHeight / view.k + 2 * G}" fill="url(#grid)"/>`];
    for (const w of c.wires) o.push(`<polyline points="${w.a} ${corner(w)} ${w.b}" class="wire${sel?.id === w.id ? ' sel' : ''}"/>`);
    for (const p of c.parts) o.push(partSvg(p, sel?.id === p.id ? 'sel' : ''));
    // junction dots where 3+ things meet, or a wire ends in the middle of another
    const cnt = new Map<string, number>();
    const bump = (q: Pt, n = 1) => cnt.set(q + '', (cnt.get(q + '') || 0) + n);
    for (const w of c.wires) { bump(w.a); bump(w.b); for (const v of c.wires) if (v !== w) for (const e of [v.a, v.b]) if (onWire(e, w) && e + '' !== w.a + '' && e + '' !== w.b + '') bump(e, 2); }
    for (const p of c.parts) pinPos(p).forEach(q => bump(q));
    for (const [k, n] of cnt) if (n >= 3) o.push(`<circle cx="${k.split(',')[0]}" cy="${k.split(',')[1]}" r="3.5" class="junc"/>`);
    if (mode === 'place') o.push(partSvg(newPart(placing, mouse[0], mouse[1], ghostRot, undefined, ' '), 'ghost'));
    if (wireStart) o.push(`<polyline points="${wireStart} ${mouse[0]},${wireStart[1]} ${mouse}" class="wire ghost"/>`);
    if (mode !== 'select' || wireStart) o.push(`<circle cx="${mouse[0]}" cy="${mouse[1]}" r="3" class="cursor"/>`);
    svg.innerHTML = o.join('') + '</g>';
  }

  const toWorld = (e: MouseEvent): Pt => [(e.offsetX - view.x) / view.k, (e.offsetY - view.y) / view.k];
  const hitPin = (q: Pt) => { for (const p of c.parts) for (const pp of pinPos(p)) if (Math.hypot(pp[0] - q[0], pp[1] - q[1]) < 7 / Math.min(view.k, 1)) return pp; return null; };
  const hitPart = (q: Pt) => [...c.parts].reverse().find(p => { const b = worldBox(p); return q[0] >= b.x1 - 3 && q[0] <= b.x2 + 3 && q[1] >= b.y1 - 3 && q[1] <= b.y2 + 3; });
  const segDist = (q: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L));
    return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
  };
  const hitWire = (q: Pt) => c.wires.find(w => Math.min(segDist(q, w.a, corner(w)), segDist(q, corner(w), w.b)) < 5);
  const select = (s: Sel) => { sel = s; onSelect(s); render(); };
  const endsOnSomething = (q: Pt) => hitPin(q) || c.wires.some(w => onWire(q, w));

  svg.addEventListener('contextmenu', e => e.preventDefault());
  svg.addEventListener('mousedown', e => {
    const w = toWorld(e), s: Pt = [snap(w[0]), snap(w[1])];
    if (e.button === 1 || e.button === 2) { pan = { x: e.clientX - view.x, y: e.clientY - view.y }; return; }
    if (mode === 'place') {
      const p = newPart(placing, s[0], s[1], ghostRot);
      mutate(() => c.parts.push(p));
      if (!e.shiftKey) { mode = 'select'; select({ kind: 'part', id: p.id }); }
      return;
    }
    if (mode === 'wire' || wireStart) {
      if (!wireStart) { wireStart = s; render(); return; }
      if (s + '' !== wireStart + '') {
        const a = wireStart, onTarget = endsOnSomething(s);
        mutate(() => c.wires.push({ id: uid(), a, b: s }));
        wireStart = onTarget ? null : s;
        if (onTarget && mode !== 'wire') mode = 'select';
      }
      render(); return;
    }
    const pin = hitPin(w);
    if (pin) { wireStart = pin; render(); return; }
    const p = hitPart(w);
    if (p) {
      const pins = pinPos(p).map(q => q + '');
      const ends = c.wires.flatMap(wr => (['a', 'b'] as const).filter(k => pins.includes(wr[k] + '')).map(k => ({ wr, k, off: [wr[k][0] - p.x, wr[k][1] - p.y] })));
      drag = { p, dx: w[0] - p.x, dy: w[1] - p.y, before: JSON.stringify(c), ends, moved: false };
      select({ kind: 'part', id: p.id }); return;
    }
    const wr = hitWire(w);
    if (wr) { select({ kind: 'wire', id: wr.id }); return; }
    select(null);
    pan = { x: e.clientX - view.x, y: e.clientY - view.y };
  });
  svg.addEventListener('mousemove', e => {
    const w = toWorld(e); mouse = [snap(w[0]), snap(w[1])];
    if (pan) { view.x = e.clientX - pan.x; view.y = e.clientY - pan.y; }
    if (drag) {
      const nx = snap(w[0] - drag.dx), ny = snap(w[1] - drag.dy);
      if (nx !== drag.p.x || ny !== drag.p.y) {
        drag.p.x = nx; drag.p.y = ny; drag.moved = true;
        for (const { wr, k, off } of drag.ends) wr[k] = [nx + off[0], ny + off[1]];
      }
    }
    svg.style.cursor = pan ? 'grabbing' : hitPin(w) ? 'crosshair' : hitPart(w) ? 'move' : 'default';
    render();
  });
  window.addEventListener('mouseup', () => {
    if (drag?.moved) { undo.push(drag.before); redo.length = 0; annot.clear(); save(); }
    drag = null; pan = null;
  });
  svg.addEventListener('dblclick', e => {
    const p = hitPart(toWorld(e));
    if (p?.type === 'SWITCH') mutate(() => { p.props.closed = p.props.closed === 'true' ? 'false' : 'true'; });
  });
  svg.addEventListener('wheel', e => {
    e.preventDefault();
    const k = Math.min(4, Math.max(0.2, view.k * (e.deltaY < 0 ? 1.15 : 1 / 1.15)));
    view.x = e.offsetX - (e.offsetX - view.x) * k / view.k; view.y = e.offsetY - (e.offsetY - view.y) * k / view.k; view.k = k;
    render();
  }, { passive: false });

  const api = {
    get circuit() { return c; },
    get selection() { return sel; },
    mutate,
    render,
    load(nc: Circuit) { mutate(() => { c = nc; sel = null; }); onSelect(null); },
    place(type: string) { mode = 'place'; placing = type; ghostRot = 0; wireStart = null; render(); },
    wire() { mode = mode === 'wire' ? 'select' : 'wire'; wireStart = null; render(); },
    cancel() { mode = 'select'; wireStart = null; render(); },
    rotate() {
      if (mode === 'place') { ghostRot = (ghostRot + 1) % 4; render(); return; }
      const p = sel?.kind === 'part' && c.parts.find(p => p.id === sel!.id);
      if (p) mutate(() => { p.rot = (p.rot + 1) % 4; });
    },
    del() {
      if (!sel) return;
      const id = sel.id;
      mutate(() => { c.parts = c.parts.filter(p => p.id !== id); c.wires = c.wires.filter(w => w.id !== id); });
      select(null);
    },
    undo() { const s = undo.pop(); if (s) { redo.push(JSON.stringify(c)); c = JSON.parse(s); annot.clear(); save(); select(null); } },
    redo() { const s = redo.pop(); if (s) { undo.push(JSON.stringify(c)); c = JSON.parse(s); annot.clear(); save(); select(null); } },
    setAnnot(m: Map<string, string>) { annot = m; render(); },
    /** Build a circuit from a parts+nodes list (e.g. from Claude): grid-place parts, tie pins together with net labels. */
    loadSpec(spec: Spec) {
      const nc: Circuit = { parts: [], wires: [] }, prev = c;
      c = nc; // so nextName counts from the new circuit
      const cols = Math.ceil(Math.sqrt(spec.parts.length));
      spec.parts.forEach((sp, i) => {
        if (!DEFS[sp.type]) throw new Error(`Unknown part type "${sp.type}"`);
        const p = newPart(sp.type, 120 + (i % cols) * 220, 120 + Math.floor(i / cols) * 200, 0, sp.props, sp.name && !nc.parts.some(q => q.name === sp.name) ? sp.name : undefined);
        nc.parts.push(p);
        pinPos(p).forEach((q, j) => {
          const net = String(sp.nodes[j] ?? ''), dx = Math.sign(q[0] - p.x), dy = dx ? 0 : Math.sign(q[1] - p.y) || 1;
          if (!net) return;
          const end: Pt = [q[0] + dx * G, q[1] + dy * G];
          nc.wires.push({ id: uid(), a: q, b: end });
          const rot = net === '0' ? (dy > 0 ? 0 : dy < 0 ? 2 : dx > 0 ? 3 : 1) : 0;
          nc.parts.push(newPart(net === '0' ? 'GND' : 'LABEL', end[0], end[1], rot, net === '0' ? {} : { net }));
        });
      });
      c = prev;
      api.load(nc);
    },
  };
  render();
  new ResizeObserver(render).observe(svg);
  return api;
}
