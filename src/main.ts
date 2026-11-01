import { DEFS, fmt, type Circuit, type Props } from './parts.ts';
import { nets, toSpice } from './netlist.ts';
import { createEditor } from './editor.ts';
import { analyze, lineFor, stop, type Out } from './sim.ts';
import { plot, readout, COLORS } from './plot.ts';
import { layout } from './breadboard.ts';
import { askClaude, askPrompt, buildPrompt, hasTauri, imageToB64, parseSpec } from './claude.ts';

const $ = <T extends HTMLElement = HTMLElement>(s: string) => document.querySelector(s) as T;
const esc = (s: string) => String(s).replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]!));
const status = (s: string, err = false) => { $('#status').textContent = s; $('#status').className = err ? 'err' : ''; };

const ed = createEditor($<any>('#schematic'), showProps);

// ---------- palette ----------
// single-key shortcuts for the common parts (Space / Ctrl+R rotate, W wire)
const HOT: Record<string, string> = { r: 'R', c: 'C', l: 'L', v: 'VDC', i: 'IDC', a: 'VAC', g: 'GND', d: 'D', e: 'LED', q: 'NPN', o: 'OPAMP', s: 'SWITCH', n: 'LABEL', p: 'VPROBE' };
const keyOf = Object.fromEntries(Object.entries(HOT).map(([k, t]) => [t, k.toUpperCase()]));
const cats = [...new Set(Object.values(DEFS).map(d => d.cat))];
$('#palette').innerHTML = cats.map(cat => `<h4>${cat}</h4>` + Object.entries(DEFS).filter(([, d]) => d.cat === cat)
  .map(([t, d]) => `<button data-part="${t}">${d.label}${keyOf[t] ? `<kbd>${keyOf[t]}</kbd>` : ''}</button>`).join('')).join('');
$('#palette').onclick = e => { const t = (e.target as HTMLElement).closest<HTMLElement>('[data-part]')?.dataset.part; if (t) ed.place(t); };

// ---------- properties ----------
function showProps(ids: string[]) {
  const pane = $('[data-pane="props"]');
  const p = ids.length === 1 && ed.circuit.parts.find(p => p.id === ids[0]);
  if (!p) {
    pane.innerHTML = `<p class="hint">${ids.length ? `${ids.length} item${ids.length > 1 ? 's' : ''} selected. Drag to move them, Delete removes them, Space rotates parts.`
      : 'Click a part on the left (or press its key), then click the canvas to place it. Drag from a pin to draw a wire. Drag on empty space to box-select; Shift/Ctrl+click adds to the selection; Ctrl+A selects all. Space or Ctrl+R rotates, Del deletes, wheel zooms, right-drag pans. Shift+click places repeatedly.'}</p>`;
    return;
  }
  const d = DEFS[p.type];
  const field = (k: string, v: string) => d.options?.[k]
    ? `<label>${k}</label><select data-k="${k}">${d.options[k].map(o => `<option${o === v ? ' selected' : ''}>${o}</option>`).join('')}</select>`
    : `<label>${k}</label><input data-k="${k}" value="${esc(v)}">`;
  pane.innerHTML = `<h3>${d.label}</h3>` + (d.hideName ? '' : field('name', p.name)) + Object.entries(p.props).map(([k, v]) => field(k, v)).join('')
    + `<p class="hint">Pins: ${d.pinNames.filter(Boolean).join(', ') || '1'}. Values accept k, M (mega), m, u, n, p.</p>`;
  pane.querySelectorAll<HTMLInputElement>('[data-k]').forEach(el => el.onchange = () => ed.mutate(() => {
    if (el.dataset.k === 'name') p.name = el.value.trim() || p.name; else p.props[el.dataset.k!] = el.value;
  }));
}
showProps([]);

// ---------- analysis settings ----------
const AN: Record<string, [string, string, string][]> = {
  op: [],
  tran: [['stop', 'Stop time', '10m'], ['step', 'Max time step', '10u']],
  ac: [['fstart', 'Start frequency', '1'], ['fstop', 'Stop frequency', '1meg'], ['points', 'Points per decade', '20']],
  dc: [['source', 'Source to sweep (e.g. V1)', 'V1'], ['start', 'Start', '0'], ['stop', 'Stop', '5'], ['incr', 'Increment', '0.1']],
  fourier: [['node', 'Net or probe name (e.g. PR1)', 'PR1'], ['freq', 'Fundamental frequency', '1k'], ['harmonics', 'Harmonics', '9'], ['cycles', 'Cycles analysed', '5'], ['settle', 'Settling cycles skipped', '5']],
  noise: [['output', 'Output net or probe', 'PR1'], ['source', 'Input source', 'V1'], ['fstart', 'Start frequency', '10'], ['fstop', 'Stop frequency', '100k'], ['points', 'Points per decade', '10']],
  sweep: [['part', 'Part name (e.g. R1)', 'R1'], ['prop', 'Property', 'value'], ['values', 'Values, comma separated', '1k, 2k, 5k'], ['inner', 'Analysis per value: op / tran / ac / dc', 'tran']],
};
const settings = (): Record<string, Props> & { kind?: any } => {
  const c = ed.circuit;
  c.analysis ??= { kind: 'tran' };
  for (const [k, fs] of Object.entries(AN)) { c.analysis[k] ??= {}; for (const [f, , d] of fs) c.analysis[k][f] ??= d; }
  return c.analysis;
};
function showAnalysis() {
  const S = settings(), kind = S.kind;
  $<HTMLSelectElement>('#kind').value = kind;
  const extra = kind === 'sweep' ? `<p class="hint">Uses the ${S.sweep.inner} settings from that analysis.</p>` : '';
  const help: Record<string, string> = {
    op: 'DC voltages and currents. Voltage probes and multimeters show their reading on the schematic.',
    tran: 'Voltage over time. Plots Oscilloscope channels and Voltage Probes (or every net if there are none).',
    ac: 'Frequency response. With a Bode Plotter it plots OUT/IN gain and phase.',
    dc: 'Sweeps a DC source and plots the probed nets.',
    fourier: 'Harmonics and THD of a periodic signal.', noise: 'Output and input-referred noise spectrum.', sweep: 'Re-runs an analysis for each value of one part property.',
  };
  $('[data-pane="analysis"]').innerHTML = `<p class="hint">${help[kind]}</p>` + AN[kind].map(([f, l]) => `<label>${l}</label><input data-f="${f}" value="${esc(S[kind][f])}">`).join('') + extra;
  $('[data-pane="analysis"]').querySelectorAll<HTMLInputElement>('[data-f]').forEach(el => el.onchange = () => ed.mutate(() => { settings()[kind][el.dataset.f!] = el.value; }));
}
$<HTMLSelectElement>('#kind').onchange = e => { ed.mutate(() => { settings().kind = (e.target as HTMLSelectElement).value; }); showAnalysis(); tab('analysis'); };
showAnalysis();

// ---------- results ----------
let last: Out | null = null, toX: ((px: number) => number) | null = null;
const hidden = new Set<string>();
function showResults() {
  const cv = $<HTMLCanvasElement>('#plot');
  const series = last?.panes.flatMap(p => p.series) ?? [];
  cv.classList.toggle('empty', !series.length);
  $('#legend').innerHTML = series.map((s, i) => `<span data-s="${esc(s.name)}" class="${hidden.has(s.name) ? 'off' : ''}" style="color:${COLORS[i % COLORS.length]}">■ ${esc(s.name)}</span>`).join('');
  $('#table').innerHTML = last?.table ? `<table>${last.table.map(r => `<tr>${r.map(c => `<td>${esc(c)}</td>`).join('')}</tr>`).join('')}</table>` : '';
  toX = series.length ? plot(cv, last!, hidden) : null;
}
$('#legend').onclick = e => { const s = (e.target as HTMLElement).dataset.s; if (s) { hidden.has(s) ? hidden.delete(s) : hidden.add(s); showResults(); } };
$('#plot').onmousemove = e => { if (toX && last) $('#readout').textContent = `x=${fmt(toX(e.offsetX))}  ` + readout(last, hidden, toX(e.offsetX)).join('  '); };
new ResizeObserver(() => last && showResults()).observe($('#plot'));

async function run() {
  const S = settings(), c = ed.circuit;
  if (!c.parts.some(p => DEFS[p.type].spice)) return status('Add some parts first.', true);
  if (!c.parts.some(p => p.type === 'GND')) return status('Add a Ground part — every circuit needs one.', true);
  status('Simulating…');
  const t0 = performance.now();
  try {
    last = await analyze(c, S.kind, S);
    hidden.clear();
    if (last.op) {
      const op = last.op, pinNet = nets(c), v = (n: string) => n === '0' ? 0 : op[`v(${n})`];
      const ann = new Map<string, string>();
      for (const p of c.parts) {
        const n = pinNet.get(p.id)!;
        if (p.type === 'VPROBE') ann.set(p.id, fmt(v(n[0]), 'V'));
        if (p.type === 'MM') ann.set(p.id, p.props.mode === 'A' ? fmt(op[`i(v${p.name.toLowerCase()})`], 'A') : fmt(v(n[0]) - v(n[1]), 'V'));
      }
      ed.setAnnot(ann);
    }
    status(`Done in ${Math.round(performance.now() - t0)} ms`);
  } catch (e: any) { last = null; status(e.message, true); }
  showResults();
}

// ---------- files ----------
async function saveText(text: string, name: string, ext: string) {
  if (hasTauri) {
    const { save } = await import('@tauri-apps/plugin-dialog'), { invoke } = await import('@tauri-apps/api/core');
    const path = await save({ defaultPath: name, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (path) { await invoke('write_text', { path, contents: text }); status('Saved ' + path); }
    return;
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text])); a.download = name; a.click();
}
async function openFile() {
  let text: string | null = null;
  if (hasTauri) {
    const { open } = await import('@tauri-apps/plugin-dialog'), { invoke } = await import('@tauri-apps/api/core');
    const path = await open({ filters: [{ name: 'OpenSim circuit', extensions: ['osim', 'json'] }] });
    if (typeof path === 'string') text = await invoke<string>('read_text', { path });
  } else {
    const inp = Object.assign(document.createElement('input'), { type: 'file', accept: '.osim,.json' });
    text = await new Promise(res => { inp.onchange = () => inp.files?.[0]?.text().then(res); inp.click(); });
  }
  if (!text) return;
  try {
    const c: Circuit = JSON.parse(text);
    if (!Array.isArray(c.parts) || !Array.isArray(c.wires) || c.parts.some(p => !DEFS[p.type])) throw new Error();
    ed.load(c); showAnalysis(); status('Opened');
  } catch { status('Not a valid OpenSim file', true); }
}

// ---------- breadboard ----------
let view = 'schematic';
function showBreadboard() {
  try {
    const b = layout(ed.circuit);
    $('#breadboard').innerHTML = `<div>${b.svg}<p class="hint">${b.cols} of 63 columns used. Hover parts for values.</p></div>
      <div><h3>Parts list</h3><table>${b.bom.map(([d, q]) => `<tr><td>${q}×</td><td>${esc(d)}</td></tr>`).join('')}</table>
      <h3>Build notes</h3><ul>${b.notes.map(n => `<li>${esc(n)}</li>`).join('')}</ul></div>`;
  } catch (e: any) { $('#breadboard').innerHTML = `<p class="err">${esc(e.message)}</p>`; }
}
function setView(v: string) {
  view = v;
  document.querySelectorAll<HTMLElement>('#views button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
  $('#schematic').style.display = v === 'schematic' ? '' : 'none';
  $('#breadboard').hidden = v !== 'breadboard';
  if (v === 'breadboard') showBreadboard(); else ed.render();
}
$('#views').onclick = e => { const v = (e.target as HTMLElement).dataset.view; if (v) setView(v); };

// ---------- side tabs ----------
function tab(t: string) {
  document.querySelectorAll<HTMLElement>('.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
  document.querySelectorAll<HTMLElement>('[data-pane]').forEach(p => p.hidden = p.dataset.pane !== t);
}
$('.tabs').onclick = e => { const t = (e.target as HTMLElement).dataset.tab; if (t) tab(t); };

// ---------- Claude ----------
const images: string[] = [];
const showImgs = () => { $('#cl-imgs').innerHTML = images.map((b, i) => `<img src="data:image/png;base64,${b}" data-i="${i}" title="Click to remove">`).join(''); };
$('#cl-imgs').onclick = e => { const i = (e.target as HTMLElement).dataset.i; if (i) { images.splice(+i, 1); showImgs(); } };
window.addEventListener('paste', async e => {
  const files = [...(e.clipboardData?.items ?? [])].filter(i => i.type.startsWith('image/')).map(i => i.getAsFile()!).filter(Boolean);
  if (!files.length) return;
  e.preventDefault(); tab('claude');
  for (const f of files) images.push(await imageToB64(f));
  showImgs();
});
async function claude(build: boolean) {
  const text = $<HTMLTextAreaElement>('#cl-text').value.trim(), out = $('#cl-out');
  if (!text && !images.length) return;
  out.textContent = 'Asking Claude… (this can take a minute)';
  document.querySelectorAll<HTMLButtonElement>('#cl-build, #cl-ask').forEach(b => b.disabled = true);
  try {
    if (build) {
      const reply = await askClaude(buildPrompt(text), images);
      const warnings = ed.loadSpec(parseSpec(reply));
      setView('schematic');
      out.textContent = ['Circuit built. Drag parts to tidy it up; Ctrl+Z undoes.', ...warnings].join('\n\n');
    } else {
      out.textContent = await askClaude(askPrompt(text, toSpice(ed.circuit, '* (analysis set in app)')), images);
    }
  } catch (e: any) { out.textContent = 'Error: ' + (e.message ?? e); }
  document.querySelectorAll<HTMLButtonElement>('#cl-build, #cl-ask').forEach(b => b.disabled = false);
}
$('#cl-build').onclick = () => claude(true);
$('#cl-ask').onclick = () => claude(false);

// ---------- toolbar & keys ----------
const acts: Record<string, () => void> = {
  new: () => { if (confirm('Clear the current circuit?')) { ed.load({ parts: [], wires: [] }); showAnalysis(); } },
  open: openFile,
  save: () => saveText(JSON.stringify(ed.circuit, null, 1), 'circuit.osim', 'osim'),
  netlist: () => { const S = settings(), k = ['fourier', 'sweep'].includes(S.kind) ? 'tran' : S.kind; saveText(toSpice(ed.circuit, lineFor(k, S[k])), 'circuit.cir', 'cir'); },
  undo: () => { ed.undo(); showAnalysis(); }, redo: () => { ed.redo(); showAnalysis(); },
  wire: () => ed.wire(), rotate: () => ed.rotate(), del: () => ed.del(),
  run, stop: () => { stop(); status('Stopped'); },
};
$('#toolbar').onclick = e => { const a = (e.target as HTMLElement).closest<HTMLElement>('[data-act]')?.dataset.act; if (a) acts[a](); };
window.addEventListener('keydown', e => {
  if ((e.target as HTMLElement).matches('input, textarea, select')) return;
  const k = e.key.toLowerCase(), ctrl = e.ctrlKey || e.metaKey;
  if (ctrl && k === 'z') acts.undo(); else if (ctrl && k === 'y') acts.redo();
  else if (ctrl && k === 's') acts.save(); else if (ctrl && k === 'o') acts.open();
  else if (ctrl && k === 'a') ed.selectAll(); else if (ctrl && k === 'r') ed.rotate();
  else if (e.key === 'F5') run();
  else if (ctrl) return;
  else if (k === ' ') ed.rotate(); else if (k === 'w') ed.wire(); else if (HOT[k]) ed.place(HOT[k]);
  else if (k === 'delete' || k === 'backspace') ed.del(); else if (k === 'escape') ed.cancel();
  else return;
  e.preventDefault();
});
