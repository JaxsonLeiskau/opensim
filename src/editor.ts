import { DEFS, type Circuit, type Part, type Pt } from './parts.ts';
import { corner, onWire, pinPos, worldBox } from './netlist.ts';
import { buildFromSpec, type Spec } from './route.ts';

const G = 20, KEY = 'opensim.autosave';
const snap = (v: number) => Math.round(v / G) * G;
const uid = () => Math.random().toString(36).slice(2, 9);

export function createEditor(svg: SVGSVGElement, onSelect: (ids: string[]) => void) {
  let c: Circuit = JSON.parse(localStorage.getItem(KEY) || 'null') ?? { parts: [], wires: [] };
  let sel = new Set<string>(), mode: 'select' | 'place' | 'wire' = 'select', placing = '', ghostRot = 0;
  let mouse: Pt = [0, 0], wireStart: Pt | null = null, drag: any = null, pan: any = null, marquee: { a: Pt; b: Pt; add: boolean } | null = null;
  const view = { x: 40, y: 40, k: 1 }, undo: string[] = [], redo: string[] = [];
  let annot = new Map<string, string>();

  const save = () => localStorage.setItem(KEY, JSON.stringify(c));
  const mutate = (fn: () => void) => { undo.push(JSON.stringify(c)); if (undo.length > 200) undo.shift(); redo.length = 0; fn(); annot.clear(); save(); render(); };
  const nextName = (prefix: string) => {
    let n = 1; const re = new RegExp(`^${prefix}(\\d+)$`);
    for (const p of c.parts) { const m = p.name.match(re); if (m) n = Math.max(n, +m[1] + 1); }
    return prefix + n;
  };
  const newPart = (type: string, x: number, y: number, rot = 0, name?: string): Part =>
    ({ id: uid(), type, name: name || nextName(DEFS[type].prefix), x, y, rot, props: { ...DEFS[type].props } });

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
    for (const w of c.wires) o.push(`<polyline points="${w.a} ${corner(w)} ${w.b}" class="wire${sel.has(w.id) ? ' sel' : ''}"/>`);
    for (const p of c.parts) o.push(partSvg(p, sel.has(p.id) ? 'sel' : ''));
    // junction dots where 3+ things meet, or a wire ends in the middle of another
    const cnt = new Map<string, number>();
    const bump = (q: Pt, n = 1) => cnt.set(q + '', (cnt.get(q + '') || 0) + n);
    for (const w of c.wires) { bump(w.a); bump(w.b); for (const v of c.wires) if (v !== w) for (const e of [v.a, v.b]) if (onWire(e, w) && e + '' !== w.a + '' && e + '' !== w.b + '') bump(e, 2); }
    for (const p of c.parts) pinPos(p).forEach(q => bump(q));
    for (const [k, n] of cnt) if (n >= 3) o.push(`<circle cx="${k.split(',')[0]}" cy="${k.split(',')[1]}" r="3.5" class="junc"/>`);
    if (mode === 'place') o.push(partSvg(newPart(placing, mouse[0], mouse[1], ghostRot, ' '), 'ghost'));
    if (wireStart) o.push(`<polyline points="${wireStart} ${mouse[0]},${wireStart[1]} ${mouse}" class="wire ghost"/>`);
    if (mode !== 'select' || wireStart) o.push(`<circle cx="${mouse[0]}" cy="${mouse[1]}" r="3" class="cursor"/>`);
    if (marquee) { const r = rect(marquee); o.push(`<rect x="${r.x1}" y="${r.y1}" width="${r.x2 - r.x1}" height="${r.y2 - r.y1}" class="marquee"/>`); }
    svg.innerHTML = o.join('') + '</g>';
  }

  const rect = (m: { a: Pt; b: Pt }) => ({ x1: Math.min(m.a[0], m.b[0]), x2: Math.max(m.a[0], m.b[0]), y1: Math.min(m.a[1], m.b[1]), y2: Math.max(m.a[1], m.b[1]) });
  const toWorld = (e: MouseEvent): Pt => [(e.offsetX - view.x) / view.k, (e.offsetY - view.y) / view.k];
  const hitPin = (q: Pt) => { for (const p of c.parts) for (const pp of pinPos(p)) if (Math.hypot(pp[0] - q[0], pp[1] - q[1]) < 7 / Math.min(view.k, 1)) return pp; return null; };
  const hitPart = (q: Pt) => [...c.parts].reverse().find(p => { const b = worldBox(p); return q[0] >= b.x1 - 3 && q[0] <= b.x2 + 3 && q[1] >= b.y1 - 3 && q[1] <= b.y2 + 3; });
  const segDist = (q: Pt, a: Pt, b: Pt) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((q[0] - a[0]) * dx + (q[1] - a[1]) * dy) / L));
    return Math.hypot(q[0] - a[0] - t * dx, q[1] - a[1] - t * dy);
  };
  const hitWire = (q: Pt) => c.wires.find(w => Math.min(segDist(q, w.a, corner(w)), segDist(q, corner(w), w.b)) < 5);
  const select = (ids: Iterable<string>) => { sel = new Set(ids); onSelect([...sel]); render(); };
  const endsOnSomething = (q: Pt) => hitPin(q) || c.wires.some(w => onWire(q, w));

  function startDrag(at: Pt) {
    const moving = c.parts.filter(p => sel.has(p.id));
    const pins = new Set(moving.flatMap(p => pinPos(p).map(q => q + '')));
    // wires that are selected move whole; wire ends sitting on a moving pin follow it
    const ends = c.wires.flatMap(w => (['a', 'b'] as const).filter(k => sel.has(w.id) || pins.has(w[k] + '')).map(k => ({ w, k, o: [...w[k]] as Pt })));
    drag = { at: [snap(at[0]), snap(at[1])], parts: moving.map(p => ({ p, o: [p.x, p.y] })), ends, before: JSON.stringify(c), moved: false };
  }

  svg.addEventListener('contextmenu', e => e.preventDefault());
  svg.addEventListener('mousedown', e => {
    const w = toWorld(e), s: Pt = [snap(w[0]), snap(w[1])], multi = e.shiftKey || e.ctrlKey || e.metaKey;
    if (e.button === 1 || e.button === 2) { pan = { x: e.clientX - view.x, y: e.clientY - view.y }; return; }
    if (mode === 'place') {
      const p = newPart(placing, s[0], s[1], ghostRot);
      mutate(() => c.parts.push(p));
      if (!e.shiftKey) { mode = 'select'; select([p.id]); }
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
    const pin = !multi && hitPin(w);
    if (pin) { wireStart = pin; render(); return; }
    const hit = hitPart(w)?.id ?? hitWire(w)?.id;
    if (hit) {
      if (multi) { const n = new Set(sel); n.has(hit) ? n.delete(hit) : n.add(hit); select(n); return; }
      if (!sel.has(hit)) select([hit]);
      startDrag(w); return;
    }
    if (!multi) select([]);
    marquee = { a: w, b: w, add: multi };
  });
  svg.addEventListener('mousemove', e => {
    const w = toWorld(e); mouse = [snap(w[0]), snap(w[1])];
    if (pan) { view.x = e.clientX - pan.x; view.y = e.clientY - pan.y; }
    if (marquee) marquee.b = w;
    if (drag) {
      const dx = mouse[0] - drag.at[0], dy = mouse[1] - drag.at[1];
      drag.moved ||= dx !== 0 || dy !== 0;
      for (const { p, o } of drag.parts) { p.x = o[0] + dx; p.y = o[1] + dy; }
      for (const { w: wr, k, o } of drag.ends) wr[k] = [o[0] + dx, o[1] + dy];
    }
    svg.style.cursor = pan ? 'grabbing' : hitPin(w) ? 'crosshair' : hitPart(w) ? 'move' : 'default';
    render();
  });
  window.addEventListener('mouseup', () => {
    if (drag?.moved) { undo.push(drag.before); redo.length = 0; annot.clear(); save(); }
    if (marquee) {
      const r = rect(marquee), inside = (q: Pt) => q[0] >= r.x1 && q[0] <= r.x2 && q[1] >= r.y1 && q[1] <= r.y2;
      const ids = [...c.parts.filter(p => { const b = worldBox(p); return b.x1 <= r.x2 && b.x2 >= r.x1 && b.y1 <= r.y2 && b.y2 >= r.y1; }),
        ...c.wires.filter(wr => [wr.a, corner(wr), wr.b].some(inside))].map(x => x.id);
      const add = marquee.add; marquee = null;
      select(add ? [...sel, ...ids] : ids);
    }
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
    get selection() { return [...sel]; },
    mutate,
    render,
    load(nc: Circuit) { mutate(() => { c = nc; }); select([]); },
    place(type: string) { mode = 'place'; placing = type; ghostRot = 0; wireStart = null; render(); },
    wire() { mode = mode === 'wire' ? 'select' : 'wire'; wireStart = null; render(); },
    cancel() { mode = 'select'; wireStart = null; select([]); },
    selectAll() { select([...c.parts, ...c.wires].map(x => x.id)); },
    rotate() {
      if (mode === 'place') { ghostRot = (ghostRot + 1) % 4; render(); return; }
      const ps = c.parts.filter(p => sel.has(p.id));
      if (ps.length) mutate(() => ps.forEach(p => { p.rot = (p.rot + 1) % 4; }));
    },
    del() {
      if (!sel.size) return;
      const s = sel;
      mutate(() => { c.parts = c.parts.filter(p => !s.has(p.id)); c.wires = c.wires.filter(w => !s.has(w.id)); });
      select([]);
    },
    undo() { const s = undo.pop(); if (s) { redo.push(JSON.stringify(c)); c = JSON.parse(s); annot.clear(); save(); select([]); } },
    redo() { const s = redo.pop(); if (s) { undo.push(JSON.stringify(c)); c = JSON.parse(s); annot.clear(); save(); select([]); } },
    setAnnot(m: Map<string, string>) { annot = m; render(); },
    /** Build a circuit from Claude's spec: parts where it placed them, real wires between pins. Returns warnings. */
    loadSpec(spec: Spec) {
      const { circuit, warnings } = buildFromSpec(spec);
      circuit.analysis = c.analysis;
      api.load(circuit);
      return warnings;
    },
  };
  render();
  new ResizeObserver(render).observe(svg);
  return api;
}
