// Self-check: node test/route.test.ts — Claude-style specs must route to exactly the requested nets.
import assert from 'node:assert';
import { buildFromSpec, type Spec } from '../src/route.ts';
import { DEFS } from '../src/parts.ts';

// common-emitter stage laid out like a textbook drawing (grid units)
const ce: Spec = { parts: [
  { type: 'VDC', name: 'VCC', props: { voltage: '12' }, nodes: ['vcc', '0'], x: 0, y: 4 },
  { type: 'R', name: 'RC', props: { value: '2.2k' }, nodes: ['vcc', 'c'], x: 10, y: 2, rot: 1 },
  { type: 'R', name: 'RB', props: { value: '100k' }, nodes: ['vcc', 'b'], x: 4, y: 2, rot: 1 },
  { type: 'NPN', name: 'Q1', nodes: ['c', 'b', 'e'], x: 9, y: 8 },
  { type: 'R', name: 'RE', props: { value: '470' }, nodes: ['e', '0'], x: 10, y: 13, rot: 1 },
  { type: 'C', name: 'CIN', nodes: ['in', 'b'], x: 2, y: 8 },
  { type: 'VAC', name: 'VIN', nodes: ['in', '0'], x: -3, y: 11 },
] };
let r = buildFromSpec(ce);
assert.deepEqual(r.warnings, [], r.warnings.join('\n'));
assert(!r.circuit.parts.some(p => p.type === 'LABEL'), 'no net labels');
assert(r.circuit.wires.length >= 6);

// random messy layouts: any "Check" warning means a short or open slipped through
let seed = 7; const rnd = (n: number) => (seed = (seed * 16807) % 2147483647) % n;
const types = ['R', 'C', 'D', 'NPN', 'OPAMP', 'VDC', 'LED'];
let labels = 0;
for (let t = 0; t < 40; t++) {
  const parts = Array.from({ length: 6 + rnd(6) }, () => {
    const type = types[rnd(types.length)];
    return { type, nodes: DEFS[type].pins.map(() => ['a', 'b', 'c', 'd', '0'][rnd(5)]), x: rnd(30), y: rnd(20), rot: rnd(4) };
  });
  r = buildFromSpec({ parts });
  assert(!r.warnings.some(w => w.startsWith('Check')), `layout ${t}: ` + r.warnings.join('; '));
  labels += r.circuit.parts.filter(p => p.type === 'LABEL').length;
}
console.log('route ok; label fallbacks in 40 random layouts:', labels);
