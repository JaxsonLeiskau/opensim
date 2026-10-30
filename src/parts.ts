export type Pt = [number, number];
export type Props = Record<string, string>;
export interface Part { id: string; type: string; name: string; x: number; y: number; rot: number; props: Props }
export interface Wire { id: string; a: Pt; b: Pt }
export interface Circuit { parts: Part[]; wires: Wire[]; analysis?: any }

export interface Def {
  label: string; cat: string; prefix: string; pins: Pt[]; pinNames: string[];
  box: [number, number, number, number]; props: Props; options?: Record<string, string[]>;
  svg: (p: Props) => string;
  spice?: (name: string, n: string[], p: Props, models: Set<string>) => string;
  value?: (p: Props) => string; hideName?: boolean;
}

const SUF: Record<string, number> = { t: 1e12, g: 1e9, meg: 1e6, k: 1e3, m: 1e-3, u: 1e-6, 'µ': 1e-6, n: 1e-9, p: 1e-12, f: 1e-15 };
// "1M" means mega here (users expect that), unlike raw SPICE where M is milli
export function parseVal(s: string): number {
  const m = String(s ?? '').trim().match(/^([-+]?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?)\s*(meg|[tgkmuµnpf])?/i);
  if (!m) return NaN;
  if (m[2] === 'M') return +m[1] * 1e6;
  return +m[1] * (SUF[(m[2] || '').toLowerCase()] ?? 1);
}
export function fmt(v: number, unit = ''): string {
  if (v == null || !isFinite(v)) return String(v);
  if (v === 0) return `0 ${unit}`;
  const pre: [string, number][] = [['T', 1e12], ['G', 1e9], ['M', 1e6], ['k', 1e3], ['', 1], ['m', 1e-3], ['µ', 1e-6], ['n', 1e-9], ['p', 1e-12], ['f', 1e-15]];
  const [s, m] = pre.find(([, m]) => Math.abs(v) >= m * 0.9995) ?? pre[pre.length - 1];
  return `${+(v / m).toPrecision(4)} ${s}${unit}`;
}
const val = (s: string) => String(parseVal(s));

const P = (d: string) => `<path d="${d}"/>`;
const F = (d: string) => `<path d="${d}" class="fill"/>`;
const T = (x: number, y: number, s: string, size = 9) => `<text x="${x}" y="${y}" font-size="${size}" text-anchor="middle" class="t">${s}</text>`;
const C = (cx: number, cy: number, r: number) => `<circle cx="${cx}" cy="${cy}" r="${r}"/>`;
const two: Pt[] = [[-40, 0], [40, 0]], vert: Pt[] = [[0, -40], [0, 40]];
const src = (inner: string) => C(0, 0, 18) + P('M0-40V-18M0 18V40') + inner;
const inst = (name: string, a: string, b: string) => `<rect x="-30" y="-25" width="60" height="45" rx="3"/>` + P('M-20 20V40M20 20V40') + T(0, -5, name, 10) + T(-20, 15, a, 8) + T(20, 15, b, 8);

export const MODELS = {
  D1N4148: '.model D1N4148 D(IS=2.52n RS=0.568 N=1.752 CJO=4p M=0.4 TT=20n BV=100 IBV=100u)',
  D1N4001: '.model D1N4001 D(IS=14.11n N=1.984 RS=33.89m CJO=25.89p M=.44 VJ=.3245 BV=75 IBV=10u TT=5.7u)',
  Q2N3904: '.model Q2N3904 NPN(IS=6.734f XTI=3 EG=1.11 VAF=74.03 BF=416.4 NE=1.259 ISE=6.734f IKF=66.78m XTB=1.5 BR=.7371 NC=2 ISC=0 IKR=0 RC=1 CJC=3.638p MJC=.3085 VJC=.75 FC=.5 CJE=4.493p MJE=.2593 VJE=.75 TR=239.5n TF=301.2p ITF=.4 VTF=4 XTF=2 RB=10)',
  Q2N2222: '.model Q2N2222 NPN(IS=14.34f XTI=3 EG=1.11 VAF=74.03 BF=255.9 NE=1.307 ISE=14.34f IKF=.2847 XTB=1.5 BR=6.092 NC=2 ISC=0 IKR=0 RC=1 CJC=7.306p MJC=.3416 VJC=.75 FC=.5 CJE=22.01p MJE=.377 VJE=.75 TR=46.91n TF=411.1p ITF=.6 VTF=1.7 XTF=3 RB=10)',
  Q2N3906: '.model Q2N3906 PNP(IS=1.41f XTI=3 EG=1.11 VAF=18.7 BF=180.7 NE=1.5 ISE=0 IKF=80m XTB=1.5 BR=4.977 NC=2 ISC=0 IKR=0 RC=2.5 CJC=9.728p MJC=.5776 VJC=.75 FC=.5 CJE=8.063p MJE=.3677 VJE=.75 TR=33.42n TF=179.3p ITF=.4 VTF=4 XTF=6 RB=10)',
  M2N7000: '.model M2N7000 NMOS(LEVEL=1 VTO=2.1 KP=0.1 LAMBDA=0.01 RD=1 RS=0.5 CGSO=20p CGDO=5p)',
  MBS250: '.model MBS250 PMOS(LEVEL=1 VTO=-2.5 KP=0.05 LAMBDA=0.01 RD=2 RS=1 CGSO=20p CGDO=5p)',
  NE555: `.subckt NE555 gnd trig out reset ctrl thr dis vcc
R1 vcc ctrl 5k
R2 ctrl lo 5k
R3 lo gnd 5k
Bq q 0 V=(v(reset,gnd)<0.8) ? 0 : ((v(trig,gnd)<v(lo,gnd)) ? 1 : ((v(thr,gnd)>v(ctrl,gnd)) ? 0 : ((v(qd)>0.5) ? 1 : 0)))
Rd q qd 100
Cd qd 0 1n
Bo o 0 V=v(gnd)+((v(qd)>0.5) ? v(vcc,gnd)-1.7 : 0.1)
Ro o out 10
Sd dis gnd 0 qd S555
.model S555 SW(VT=-0.5 VH=0.1 RON=10 ROFF=100Meg)
.ends`,
};
// single-pole op-amp: 100k gain, 1 MHz GBW, output clamped hi/lo volts from the rails
const opamp = (n: string, hi: number, lo: number) => `.subckt OPAMP_${n} inp inn vp vn out
Rin inp inn 2Meg
E1 a 0 inp inn 100k
R1 a b 1k
C1 b 0 15.9u
B1 c 0 V=max(min(v(b),v(vp)-${hi}),v(vn)+${lo})
Ro c out 50
.ends`;
const OPAMPS: Record<string, string> = { LM358: opamp('LM358', 1.5, 0.05), LM741: opamp('LM741', 1.5, 1.5), Ideal: opamp('Ideal', 0, 0) };
const LEDN: Record<string, number> = { red: 1.9, yellow: 2.0, green: 2.1, blue: 2.9, white: 2.9 };
export const LEDCOL: Record<string, string> = { red: '#f33', yellow: '#fd2', green: '#3d3', blue: '#39f', white: '#eee' };

const lg = (x: string) => `(0.5+0.5*tanh(40*(v(${x})-2.5)))`;
const AND = 'M-20-25H0a25 25 0 0 1 0 50H-20Z', OR = 'M-24-25Q-8 0-24 25Q10 25 25 0Q10-25-24-25Z';
function gate(label: string, body: string, f: (a: string, b: string) => string, bubble: boolean, inX: number): Def {
  return {
    label, cat: 'Digital', prefix: 'U', pins: [[-40, -20], [-40, 20], [40, 0]], pinNames: ['A', 'B', 'Y'], box: [-40, -25, 40, 25], props: {},
    svg: () => P(body) + P(`M-40-20H${inX}M-40 20H${inX}`) + (bubble ? C(29, 0, 4) + P('M33 0H40') : P('M25 0H40')),
    spice: (nm, n) => `B${nm} ${nm}_i 0 V=5*(${f(lg(n[0]), lg(n[1]))})\nR${nm}o ${nm}_i ${n[2]} 50`,
  };
}

export const DEFS: Record<string, Def> = {
  R: { label: 'Resistor', cat: 'Basic', prefix: 'R', pins: two, pinNames: ['1', '2'], box: [-40, -10, 40, 10], props: { value: '1k' },
    svg: () => P('M-40 0H-24l4-8 8 16 8-16 8 16 8-16 8 16 4-8H40'), value: p => p.value + 'Ω',
    spice: (nm, n, p) => `${nm} ${n[0]} ${n[1]} ${val(p.value)}` },
  C: { label: 'Capacitor', cat: 'Basic', prefix: 'C', pins: two, pinNames: ['1', '2'], box: [-40, -14, 40, 14], props: { value: '1u' },
    svg: () => P('M-40 0H-5M-5-14V14M5-14V14M5 0H40'), value: p => p.value + 'F',
    spice: (nm, n, p) => `${nm} ${n[0]} ${n[1]} ${val(p.value)}` },
  L: { label: 'Inductor', cat: 'Basic', prefix: 'L', pins: two, pinNames: ['1', '2'], box: [-40, -8, 40, 4], props: { value: '1m' },
    svg: () => P('M-40 0H-24a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0a6 6 0 0 1 12 0H40'), value: p => p.value + 'H',
    spice: (nm, n, p) => `${nm} ${n[0]} ${n[1]} ${val(p.value)}` },
  POT: { label: 'Potentiometer', cat: 'Basic', prefix: 'RV', pins: [[-40, 0], [0, -40], [40, 0]], pinNames: ['1', 'W', '3'], box: [-40, -40, 40, 10], props: { value: '10k', position: '50' },
    svg: () => P('M-40 0H-24l4-8 8 16 8-16 8 16 8-16 8 16 4-8H40M0-40V-12') + F('M-5-18L0-10 5-18Z'), value: p => `${p.value}Ω ${p.position}%`,
    spice: (nm, n, p) => { const r = parseVal(p.value), k = Math.min(Math.max(+p.position / 100, 0.001), 0.999); return `R${nm}a ${n[0]} ${n[1]} ${r * k}\nR${nm}b ${n[1]} ${n[2]} ${r * (1 - k)}`; } },
  SWITCH: { label: 'Switch', cat: 'Basic', prefix: 'S', pins: two, pinNames: ['1', '2'], box: [-40, -18, 40, 6], props: { closed: 'true' }, options: { closed: ['true', 'false'] },
    svg: p => P('M-40 0H-20M20 0H40') + C(-20, 0, 2.5) + C(20, 0, 2.5) + P(p.closed === 'true' ? 'M-18 0L18-3' : 'M-18 0L15-16'), value: p => p.closed === 'true' ? 'closed' : 'open',
    spice: (nm, n, p) => `R${nm} ${n[0]} ${n[1]} ${p.closed === 'true' ? '1m' : '1e12'}` },
  GND: { label: 'Ground', cat: 'Basic', prefix: 'GND', pins: [[0, 0]], pinNames: [''], box: [-12, 0, 12, 20], props: {}, hideName: true,
    svg: () => P('M0 0V10M-12 10H12M-7 15H7M-2 20H2') },
  LABEL: { label: 'Net Label', cat: 'Basic', prefix: 'NL', pins: [[0, 0]], pinNames: [''], box: [-4, -4, 4, 4], props: { net: 'out' }, hideName: true,
    svg: () => F('M0-4L4 0 0 4-4 0Z'), value: p => p.net },
  VDC: { label: 'DC Voltage', cat: 'Sources', prefix: 'V', pins: vert, pinNames: ['+', '−'], box: [-18, -40, 18, 40], props: { voltage: '5' },
    svg: () => src(P('M-4-9H4M0-13V-5M-4 9H4')), value: p => p.voltage + 'V',
    spice: (nm, n, p) => `${nm} ${n[0]} ${n[1]} DC ${val(p.voltage)}` },
  IDC: { label: 'DC Current', cat: 'Sources', prefix: 'I', pins: vert, pinNames: ['out', 'in'], box: [-18, -40, 18, 40], props: { current: '1m' },
    svg: () => src(P('M0 10V-10M-5-4L0-10 5-4')), value: p => p.current + 'A',
    spice: (nm, n, p) => `${nm} ${n[1]} ${n[0]} DC ${val(p.current)}` },
  VAC: { label: 'AC Voltage (sine)', cat: 'Sources', prefix: 'V', pins: vert, pinNames: ['+', '−'], box: [-18, -40, 18, 40], props: { amplitude: '1', frequency: '1k', offset: '0' },
    svg: () => src(P('M-10 0c3-10 7-10 10 0s7 10 10 0')), value: p => `${p.amplitude}Vpk ${p.frequency}Hz`,
    spice: (nm, n, p) => `${nm} ${n[0]} ${n[1]} DC ${val(p.offset)} AC 1 SIN(${val(p.offset)} ${val(p.amplitude)} ${val(p.frequency)})` },
  VPULSE: { label: 'Pulse Voltage', cat: 'Sources', prefix: 'V', pins: vert, pinNames: ['+', '−'], box: [-18, -40, 18, 40],
    props: { v1: '0', v2: '5', delay: '0', rise: '1n', fall: '1n', width: '0.5m', period: '1m' },
    svg: () => src(P('M-10 6H-5V-6H3V6H10')), value: p => `${p.v1}→${p.v2}V`,
    spice: (nm, n, p) => `${nm} ${n[0]} ${n[1]} DC ${val(p.v1)} PULSE(${['v1', 'v2', 'delay', 'rise', 'fall', 'width', 'period'].map(k => val(p[k])).join(' ')})` },
  D: { label: 'Diode', cat: 'Semiconductors', prefix: 'D', pins: two, pinNames: ['A', 'K'], box: [-40, -10, 40, 10], props: { model: '1N4148' }, options: { model: ['1N4148', '1N4001'] },
    svg: () => P('M-40 0H40M8-10V10') + F('M-8-10V10L8 0Z'), value: p => p.model,
    spice: (nm, n, p, m) => { m.add(MODELS['D' + p.model]); return `${nm} ${n[0]} ${n[1]} D${p.model}`; } },
  LED: { label: 'LED', cat: 'Semiconductors', prefix: 'LED', pins: two, pinNames: ['A', 'K'], box: [-40, -22, 40, 10], props: { color: 'red' }, options: { color: Object.keys(LEDN) },
    svg: p => P('M-40 0H40M8-10V10M0-12l7-8M7-14v-6h-6M8-8l7-8M15-10v-6h-6') + `<path d="M-8-10V10L8 0Z" style="fill:${LEDCOL[p.color]}"/>`, value: p => p.color,
    spice: (nm, n, p, m) => { const c = p.color.toUpperCase(); m.add(`.model LED_${c} D(IS=1e-19 N=${LEDN[p.color] ?? 2} RS=2 BV=5 CJO=10p)`); return `D${nm} ${n[0]} ${n[1]} LED_${c}`; } },
  ZENER: { label: 'Zener Diode', cat: 'Semiconductors', prefix: 'DZ', pins: two, pinNames: ['A', 'K'], box: [-40, -12, 40, 12], props: { voltage: '5.1' },
    svg: () => P('M-40 0H40M4-12L8-10V10L12 12') + F('M-8-10V10L8 0Z'), value: p => p.voltage + 'V',
    spice: (nm, n, p, m) => { const id = 'DZ' + p.voltage.replace(/\W/g, '_'); m.add(`.model ${id} D(IS=1n N=1 RS=2 BV=${val(p.voltage)} IBV=5m CJO=100p)`); return `D${nm} ${n[0]} ${n[1]} ${id}`; } },
  NPN: { label: 'NPN Transistor', cat: 'Semiconductors', prefix: 'Q', pins: [[20, -40], [-20, 0], [20, 40]], pinNames: ['C', 'B', 'E'], box: [-20, -40, 24, 40], props: { model: '2N3904' }, options: { model: ['2N3904', '2N2222'] },
    svg: () => C(6, 0, 20) + P('M-20 0H-4M-4-12V12M-4-5L20-20V-40M-4 5L20 20V40') + F('M14 16.3L5.9 15.9 10.2 9.1Z'), value: p => p.model,
    spice: (nm, n, p, m) => { m.add(MODELS['Q' + p.model]); return `${nm} ${n[0]} ${n[1]} ${n[2]} Q${p.model}`; } },
  PNP: { label: 'PNP Transistor', cat: 'Semiconductors', prefix: 'Q', pins: [[20, 40], [-20, 0], [20, -40]], pinNames: ['C', 'B', 'E'], box: [-20, -40, 24, 40], props: { model: '2N3906' }, options: { model: ['2N3906'] },
    svg: () => C(6, 0, 20) + P('M-20 0H-4M-4-12V12M-4-5L20-20V-40M-4 5L20 20V40') + F('M4.4-10.3L12.4-10.6 8.2-17.4Z'), value: p => p.model,
    spice: (nm, n, p, m) => { m.add(MODELS['Q' + p.model]); return `${nm} ${n[0]} ${n[1]} ${n[2]} Q${p.model}`; } },
  NMOS: { label: 'N-MOSFET', cat: 'Semiconductors', prefix: 'M', pins: [[20, -40], [-20, 0], [20, 40]], pinNames: ['D', 'G', 'S'], box: [-20, -40, 22, 40], props: { model: '2N7000' }, options: { model: ['2N7000'] },
    svg: () => P('M-20 0H-6M-6-12V12M0-14V-6M0-4V4M0 6V14M0-10H20V-40M0 10H20V40M0 0H20V10') + F('M2 0l7-4v8z'), value: p => p.model,
    spice: (nm, n, p, m) => { m.add(MODELS['M' + p.model]); return `${nm} ${n[0]} ${n[1]} ${n[2]} ${n[2]} M${p.model}`; } },
  PMOS: { label: 'P-MOSFET', cat: 'Semiconductors', prefix: 'M', pins: [[20, 40], [-20, 0], [20, -40]], pinNames: ['D', 'G', 'S'], box: [-20, -40, 22, 40], props: { model: 'BS250' }, options: { model: ['BS250'] },
    svg: () => P('M-20 0H-6M-6-12V12M0-14V-6M0-4V4M0 6V14M0-10H20V-40M0 10H20V40M0 0H20V-10') + F('M18 0l-7-4v8z'), value: p => p.model,
    spice: (nm, n, p, m) => { m.add(MODELS['M' + p.model]); return `${nm} ${n[0]} ${n[1]} ${n[2]} ${n[2]} M${p.model}`; } },
  OPAMP: { label: 'Op-Amp', cat: 'ICs', prefix: 'U', pins: [[-40, -20], [-40, 20], [40, 0], [0, -40], [0, 40]], pinNames: ['−', '+', 'OUT', 'V+', 'V−'], box: [-40, -40, 40, 40],
    props: { model: 'LM358' }, options: { model: Object.keys(OPAMPS) },
    svg: () => P('M-30-35V35L30 0ZM-40-20H-30M-40 20H-30M30 0H40M0-40V-17.5M0 40V17.5M-27-20h6M-27 20h6M-24 17v6'), value: p => p.model,
    spice: (nm, n, p, m) => { m.add(OPAMPS[p.model]); return `X${nm} ${n[1]} ${n[0]} ${n[3]} ${n[4]} ${n[2]} OPAMP_${p.model}`; } },
  NE555: { label: '555 Timer', cat: 'ICs', prefix: 'U', pins: [[0, 60], [-60, 20], [60, 0], [20, -60], [60, 20], [-60, 0], [-60, -20], [0, -60]],
    pinNames: ['GND', 'TRIG', 'OUT', 'RST', 'CTRL', 'THR', 'DIS', 'VCC'], box: [-60, -60, 60, 60], props: {},
    svg: () => `<rect x="-40" y="-40" width="80" height="80" rx="3"/>` + P('M0 40V60M-60 20H-40M60 0H40M20-40V-60M60 20H40M-60 0H-40M-60-20H-40M0-40V-60')
      + T(0, 4, '555', 12) + T(0, 36, 'GND', 7) + T(-28, 23, 'TRI', 7) + T(30, 3, 'OUT', 7) + T(22, -31, 'RST', 7) + T(28, 23, 'CV', 7) + T(-28, 3, 'THR', 7) + T(-28, -17, 'DIS', 7) + T(-2, -31, 'VCC', 7),
    spice: (nm, n, _p, m) => { m.add(MODELS.NE555); return `X${nm} ${n.join(' ')} NE555`; } },
  AND: gate('AND Gate', AND, (a, b) => `${a}*${b}`, false, -20),
  NAND: gate('NAND Gate', AND, (a, b) => `1-${a}*${b}`, true, -20),
  OR: gate('OR Gate', OR, (a, b) => `1-(1-${a})*(1-${b})`, false, -21),
  NOR: gate('NOR Gate', OR, (a, b) => `(1-${a})*(1-${b})`, true, -21),
  XOR: { ...gate('XOR Gate', OR, (a, b) => `${a}+${b}-2*${a}*${b}`, false, -21), svg: () => P(OR + 'M-30-25Q-14 0-30 25') + P('M-40-20H-27M-40 20H-27M25 0H40') },
  NOT: { label: 'NOT Gate', cat: 'Digital', prefix: 'U', pins: two, pinNames: ['A', 'Y'], box: [-40, -15, 40, 15], props: {},
    svg: () => P('M-20-15V15L14 0ZM-40 0H-20M22 0H40') + C(18, 0, 4),
    spice: (nm, n) => `B${nm} ${nm}_i 0 V=5*(1-${lg(n[0])})\nR${nm}o ${nm}_i ${n[1]} 50` },
  VPROBE: { label: 'Voltage Probe', cat: 'Instruments', prefix: 'PR', pins: [[0, 0]], pinNames: [''], box: [0, -20, 20, 0], props: {},
    svg: () => P('M0 0L10-10') + C(14, -14, 6) + T(14, -11, 'V', 8) },
  MM: { label: 'Multimeter', cat: 'Instruments', prefix: 'XMM', pins: [[-20, 40], [20, 40]], pinNames: ['+', '−'], box: [-30, -25, 30, 40], props: { mode: 'V' }, options: { mode: ['V', 'A'] },
    svg: p => inst('XMM ' + p.mode, '+', '−'), value: p => p.mode === 'A' ? 'ammeter' : 'voltmeter',
    spice: (nm, n, p) => p.mode === 'A' ? `V${nm} ${n[0]} ${n[1]} 0` : '' },
  SCOPE: { label: 'Oscilloscope', cat: 'Instruments', prefix: 'XSC', pins: [[-20, 40], [20, 40]], pinNames: ['A', 'B'], box: [-30, -25, 30, 40], props: {},
    svg: () => inst('SCOPE', 'A', 'B') },
  BODE: { label: 'Bode Plotter', cat: 'Instruments', prefix: 'XBP', pins: [[-20, 40], [20, 40]], pinNames: ['IN', 'OUT'], box: [-30, -25, 30, 40], props: {},
    svg: () => inst('BODE', 'IN', 'OUT') },
  FGEN: { label: 'Function Generator', cat: 'Instruments', prefix: 'XFG', pins: vert, pinNames: ['+', 'COM'], box: [-22, -40, 22, 40],
    props: { waveform: 'sine', frequency: '1k', amplitude: '1', offset: '0', duty: '50' }, options: { waveform: ['sine', 'square', 'triangle'] },
    svg: () => `<rect x="-22" y="-18" width="44" height="36" rx="3"/>` + P('M0-40V-18M0 18V40M-10 2c3-10 7-10 10 0s7 10 10 0') + T(0, -6, 'FG', 8), value: p => `${p.waveform} ${p.frequency}Hz`,
    spice: (nm, n, p) => {
      const off = parseVal(p.offset), a = parseVal(p.amplitude), per = 1 / parseVal(p.frequency), lo = off - a, hi = off + a;
      const w = p.waveform === 'square' ? `PULSE(${lo} ${hi} 0 ${per / 1000} ${per / 1000} ${per * (+p.duty || 50) / 100} ${per})`
        : p.waveform === 'triangle' ? `PULSE(${lo} ${hi} 0 ${per / 2} ${per / 2} ${per / 1e6} ${per})` : `SIN(${off} ${a} ${1 / per})`;
      return `V${nm} ${n[0]} ${n[1]} DC ${off} AC 1 ${w}`;
    } },
};
