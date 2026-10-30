import { Simulation } from 'eecircuit-engine';

const sim = new Simulation();
const ready = sim.start();
self.onmessage = async (e: MessageEvent) => {
  const { id, netlist } = e.data;
  try {
    await ready;
    sim.setNetList(netlist);
    const result = await sim.runSim();
    postMessage({ id, ok: true, result, errors: sim.getError() });
  } catch (err) {
    postMessage({ id, ok: false, error: String(err) });
  }
};
