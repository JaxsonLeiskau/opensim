// Self-check: node test/sim.test.ts — builds circuits in code and checks simulated values.
import assert from 'node:assert';
import { Simulation } from 'eecircuit-engine';
import { analyze, setRunner } from '../src/sim.ts';
import { DEFS, type Circuit, type Part } from '../src/parts.ts';
import { pinPos } from '../src/netlist.ts';

const sim = new Simulation(); await sim.start();
setRunner(async n => { sim.setNetList(n); return { result: await sim.runSim(), errors: sim.getError() }; });

let id = 0;
// place a part and attach a net label (or ground) to every pin, so connectivity goes through the real net code
function circuit(spec: [string, string, Record<string, string>, string[]][]): Circuit {
  const parts: Part[] = [];
  spec.forEach(([type, name, props, nodes], i) => {
    const p: Part = { id: 'p' + id++, type, name, x: i * 400, y: 0, rot: 0, props: { ...DEFS[type].props, ...props } };
    parts.push(p);
    pinPos(p).forEach((q, j) => parts.push({ id: 'p' + id++, type: nodes[j] === '0' ? 'GND' : 'LABEL', name: 'L' + id, x: q[0], y: q[1], rot: 0, props: { net: nodes[j] } }));
  });
  return { parts, wires: [] };
}
const S: any = { tran: { stop: '5m', step: '5u' }, op: {}, fourier: { node: 'out', freq: '1k', cycles: '4', settle: '2', harmonics: '5' } };

// divider
let o = await analyze(circuit([['VDC', 'V1', { voltage: '10' }, ['in', '0']], ['R', 'R1', { value: '1k' }, ['in', 'out']], ['R', 'R2', { value: '1k' }, ['out', '0']]]), 'op', S);
assert(Math.abs(o.op!['v(out)'] - 5) < 1e-3, 'divider');
// inverting op-amp gain -10
o = await analyze(circuit([['VDC', 'V1', { voltage: '0.5' }, ['in', '0']], ['VDC', 'V2', { voltage: '12' }, ['vp', '0']], ['VDC', 'V3', { voltage: '12' }, ['0', 'vn']],
  ['R', 'R1', { value: '1k' }, ['in', 'm']], ['R', 'R2', { value: '10k' }, ['m', 'out']], ['OPAMP', 'U1', { model: 'LM741' }, ['m', '0', 'out', 'vp', 'vn']]]), 'op', S);
assert(Math.abs(o.op!['v(out)'] + 5) < 0.01, 'opamp ' + o.op!['v(out)']);
// NAND gate
o = await analyze(circuit([['VDC', 'V1', { voltage: '5' }, ['a', '0']], ['NAND', 'U1', {}, ['a', 'a', 'out']]]), 'op', S);
assert(o.op!['v(out)'] < 0.1, 'nand');
// 555 astable: f = 1.44/((R1+2R2)C) = 1.44/(30k*100n) = 480 Hz
o = await analyze(circuit([['VDC', 'V1', { voltage: '9' }, ['vcc', '0']], ['R', 'R1', { value: '10k' }, ['vcc', 'dis']], ['R', 'R2', { value: '10k' }, ['dis', 'thr']],
  ['C', 'C1', { value: '100n' }, ['thr', '0']], ['C', 'C2', { value: '10n' }, ['ctrl', '0']], ['NE555', 'U1', {}, ['0', 'thr', 'out', 'vcc', 'ctrl', 'thr', 'dis', 'vcc']]]), 'tran', { tran: { stop: '20m', step: '10u' } });
const t = o.x!, y = o.panes[0].series.find(s => s.name === 'V(out)')!.y;
const edges = t.filter((_, i) => i && y[i - 1] < 4.5 && y[i] >= 4.5);
const f = (edges.length - 2) / (edges[edges.length - 1] - edges[1]);
assert(f > 380 && f < 580, '555 freq ' + f);
// fourier of a pure sine: THD ~ 0
o = await analyze(circuit([['VAC', 'V1', { amplitude: '1', frequency: '1k' }, ['out', '0']]]), 'fourier', S);
assert(parseFloat(o.table!.at(-1)![2]) < 0.5, 'thd ' + o.table!.at(-1)![2]);
console.log('sim ok, 555 f =', f.toFixed(0), 'Hz');
process.exit(0);
