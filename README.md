# OpenSim

A free, offline circuit simulator for Windows, inspired by Multisim. It runs real SPICE (ngspice) inside the app.

## Download
Go to [Releases](../../releases/latest), download `OpenSim_x.y.z_x64-setup.exe` and run it.
Windows SmartScreen may warn because the app isn't code-signed: click **More info → Run anyway**.

## Features
- **Schematic editor**: drag parts from the left, drag from a pin to wire, R to rotate, Del to delete, wheel to zoom, right-drag to pan, Ctrl+Z/Y to undo/redo.
- **Parts**: R, C, L, potentiometer, switch, DC/AC/pulse sources, diodes, LEDs, Zeners, 2N3904/2N2222/2N3906, 2N7000/BS250, op-amps (LM358/LM741/ideal), 555 timer, logic gates.
- **Instruments**: voltage probe, multimeter (V/A), oscilloscope, Bode plotter, function generator.
- **Analyses**: DC operating point, transient, AC sweep, DC sweep, Fourier (harmonics + THD), noise, parameter sweep.
- **Breadboard view**: lays the circuit out on an 830-point breadboard using standard parts (E12 resistors, common ICs). Gates and op-amps are packed into shared chips. Includes a parts list and build notes.
- **Claude**: paste a screenshot or netlist, or describe a circuit, and Claude builds it on the schematic. You can also ask questions about your circuit. This uses your local [Claude Code](https://claude.com/code) login (no API key, no extra cost). Install Claude Code and run `claude` once to sign in.

Files save as `.osim`. **Netlist** exports a SPICE `.cir`.

## Develop
```
npm install
npm run dev        # browser preview (no Claude / file dialogs)
npm test           # simulator + breadboard self-checks
npm run tauri dev  # desktop app (needs Rust + MSVC build tools)
```
Releases are built by GitHub Actions when a `v*` tag is pushed.
