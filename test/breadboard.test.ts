// Self-check: node test/breadboard.test.ts — every net's holes must be electrically joined on the board.
import assert from 'node:assert';
import { layout, snap } from '../src/breadboard.ts';
import { DEFS, type Circuit, type Part } from '../src/parts.ts';
import { pinPos } from '../src/netlist.ts';

assert.equal(snap(4900, [1, 1.2, 1.5, 1.8, 2.2, 2.7, 3.3, 3.9, 4.7, 5.6, 6.8, 8.2]), 4700);
assert.equal(snap(9.6e3, [1, 1.5, 2.2, 3.3, 4.7, 6.8]), 1e4);
let id = 0;
function circuit(spec: [string, string, Record<string, string>, string[]][]): Circuit {
  const parts: Part[] = [];
  spec.forEach(([type, name, props, nodes], i) => {
    const p: Part = { id: 'p' + id++, type, name, x: i * 400, y: 0, rot: 0, props: { ...DEFS[type].props, ...props } };
    parts.push(p);
    pinPos(p).forEach((q, j) => parts.push({ id: 'p' + id++, type: nodes[j] === '0' ? 'GND' : 'LABEL', name: 'L' + id, x: q[0], y: q[1], rot: 0, props: { net: nodes[j] } }));
  });
  return { parts, wires: [] };
}
// 555 astable + LED + two NAND gates + op-amp follower
const b = layout(circuit([['VDC', 'V1', { voltage: '5' }, ['vcc', '0']], ['R', 'R1', { value: '9.9k' }, ['vcc', 'dis']], ['R', 'R2', { value: '10k' }, ['dis', 'thr']],
  ['C', 'C1', { value: '10u' }, ['thr', '0']], ['NE555', 'U1', {}, ['0', 'thr', 'out', 'vcc', 'ctrl', 'thr', 'dis', 'vcc']],
  ['R', 'R3', { value: '330' }, ['out', 'led']], ['LED', 'LED1', {}, ['led', '0']], ['NAND', 'U2', {}, ['out', 'out', 'nout']], ['NAND', 'U3', {}, ['nout', 'nout', 'x']],
  ['OPAMP', 'U4', {}, ['f', 'x', 'f', 'vcc', '0']], ['NPN', 'Q1', {}, ['vcc', 'f', 'e']], ['R', 'R4', { value: '1k' }, ['e', '0']]]));
const bom = Object.fromEntries(b.bom);
assert.equal(bom['74HC00 quad NAND (DIP-14)'], 1, 'gates packed into one chip');
assert.equal(bom['LM358 dual op-amp (DIP-8)'], 1);
assert.equal(bom['Resistor 10 kΩ ¼ W (brown-black-orange)'], 2, '9.9k snapped to 10k');
assert(b.cols > 0 && b.cols <= 40, 'compact: ' + b.cols + ' columns');
assert(b.svg.startsWith('<svg') && b.svg.endsWith('</svg>'));
// union holes: same strip (column + half), same rail row, or jumper ends
const par = new Map<string, string>(), k = (h: number[]) => h.join(',');
const find = (x: string): string => { if (!par.has(x)) par.set(x, x); return par.get(x) === x ? x : find(par.get(x)!); };
const union = (a: string, b: string) => par.set(find(a), find(b));
const group = (h: number[]) => h[1] < 50 || h[1] > 220 ? 'rail' + h[1] : 'strip' + h[0] + (h[1] < 132 ? 'T' : 'B');
for (const [h] of b.leads) union(k(h), group(h));
for (const j of b.jumpers) if (j.b[1] > -1 && j.b[1] < 267) { union(k(j.a), group(j.a)); union(k(j.b), group(j.b)); union(k(j.a), k(j.b)); }
const comp = new Map<string, string>();
for (const [h, net] of b.leads) {
  const r = find(k(h));
  if (net.startsWith('__u')) continue;
  assert(!comp.has(net) || comp.get(net) === r, `net ${net} split on the board`);
  comp.set(net, r);
}
assert.equal(new Set(comp.values()).size, comp.size, 'two nets shorted together');
console.log('breadboard ok:', b.cols, 'columns;', b.bom.length, 'BOM lines;', b.notes.length, 'notes');
