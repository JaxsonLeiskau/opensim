import { DEFS } from './parts.ts';
import type { Spec } from './route.ts';

export const hasTauri = '__TAURI_INTERNALS__' in window;

/** Runs the local Claude Code CLI (`claude -p`) through the Tauri backend, so it uses the user's Claude subscription. */
export async function askClaude(prompt: string, images: string[]): Promise<string> {
  if (!hasTauri) throw new Error('Claude features need the desktop app (they run your local Claude Code).');
  const { invoke } = await import('@tauri-apps/api/core');
  return invoke<string>('ask_claude', { prompt, images });
}

const catalog = () => Object.entries(DEFS).filter(([t]) => t !== 'GND' && t !== 'LABEL')
  .map(([t, d]) => `- ${t} (${d.label}): pins ${d.pins.map((q, i) => `${d.pinNames[i] || 'pin'}@(${q[0] / 20},${q[1] / 20})`).join(' ')}; props ${JSON.stringify(d.props)}${d.options ? '; options ' + JSON.stringify(d.options) : ''}`).join('\n');

export const buildPrompt = (req: string) => `You convert circuits into JSON for the OpenSim circuit simulator.
Available part types:
${catalog()}

Pin positions are in grid units relative to the part centre at rotation 0 (x right, y down).

Reply with ONLY a JSON object, no prose, shaped like:
{"parts":[{"type":"R","name":"R1","props":{"value":"1k"},"nodes":["in","out"],"x":10,"y":4,"rot":0}]}
Rules:
- "nodes" gives the net name for each pin, in the pin order listed above. Use "0" for ground.
- "x","y" place the part centre on the grid (integers, y grows downward). "rot" is 0-3 quarter turns clockwise
  (rot 1 turns a horizontal resistor vertical; a pin at (x,y) moves to (-y,x)).
- Reproduce the layout exactly as drawn in the image: same relative positions, same orientations, same flow
  (e.g. supply on the left, ground at the bottom). For text-only requests use a clean textbook layout, signal left to right.
- Keep at least 3 empty grid units between parts. Wires are drawn automatically between pins sharing a net,
  so line up connected pins horizontally or vertically where the drawing does.
- Ground pins get a ground symbol automatically; don't add GND parts.
- Values use SPICE suffixes (k, meg, m, u, n, p). Only use the listed types and props.
- Include sources and instruments shown in the input. If something has no matching part, pick the closest one.
- If image files are attached below, read each one with the Read tool first.

Circuit to build:
${req || '(see attached images)'}`;

export const askPrompt = (req: string, netlist: string) => `You are an electronics tutor inside the OpenSim circuit simulator.
The user's current circuit as a SPICE netlist:
${netlist}

If image files are attached below, read them with the Read tool. Answer concisely in plain text.
Question: ${req}`;

export function parseSpec(text: string): Spec {
  const s = text.indexOf('{'), e = text.lastIndexOf('}');
  if (s < 0 || e < s) throw new Error('Claude did not return a circuit:\n' + text.slice(0, 500));
  const spec = JSON.parse(text.slice(s, e + 1));
  if (!Array.isArray(spec.parts)) throw new Error('Reply had no "parts" list');
  return spec;
}

/** Downscale to max 1568px (what Claude reads anyway) and return PNG base64 without the data: prefix. */
export async function imageToB64(blob: Blob): Promise<string> {
  const bmp = await createImageBitmap(blob), k = Math.min(1, 1568 / Math.max(bmp.width, bmp.height));
  const cv = document.createElement('canvas');
  cv.width = Math.round(bmp.width * k); cv.height = Math.round(bmp.height * k);
  cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
  return cv.toDataURL('image/png').split(',')[1];
}
