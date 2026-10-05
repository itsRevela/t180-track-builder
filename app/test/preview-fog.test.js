// THE FOG FOLLOWS THE FRAMING (layout overhaul, phase 4, 2026-10-05). A fixed 0.0012/m of fog turned a large track seen from
// Overhead (the camera 1–2 km up) into 70–90% fog colour: a dark road on a near-black background. Past FOG_FRAME_M of framing distance
// (eye to target) the renderer thins the fog as FOG_FRAME_M / distance, so the framed road keeps the colour it would keep at FOG_FRAME_M;
// nearer views, where the fog is the depth cue, are unchanged, and the fog's colour is the look's and never changes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createRenderer, FOG_FRAME_M } = require('../preview/renderer.js');

function recGL() {   // records each uniform by name (getUniformLocation returns the name)
  const log = { u: {} };
  let id = 0;
  const gl = new Proxy({
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6,
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({ id: ++id }), createProgram: () => ({ id: ++id }),
    createBuffer: () => ({ id: ++id }), getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    uniform1f: (n, v) => { log.u[n] = v; }, uniform3f: (n, a, b, c) => { log.u[n] = [a, b, c]; },
  }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  return { gl, log };
}
const tri = { key: 'k', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), normals: new Float32Array([0, 1, 0, 0, 1, 0, 0, 1, 0]),
  indices: new Uint16Array([0, 1, 2]), model: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], colour: [1, 1, 1] };
const fogAt = (eyeHeight) => { const { gl, log } = recGL(), r = createRenderer(gl);
  r.draw([tri], { eye: [0, eyeHeight, 0], target: [0, 0, 0], up: [0, 0, 1], fov: 1 }, { width: 10, height: 10 }, { look: 'words', lines: false });
  return log.u; };

test('a near view keeps the fog the look was tuned with (0.0012 per metre)', () => {
  assert.equal(fogAt(40).uFogDensity, 0.0012);
});

test('a view framed from 2 km thins the fog so the framed road keeps the colour it keeps at FOG_FRAME_M', () => {
  const kept = Math.exp(-fogAt(2000).uFogDensity * 2000);
  assert.ok(Math.abs(kept - Math.exp(-0.0012 * FOG_FRAME_M)) < 1e-9, `kept ${kept}`);
});

test('the fog colour is the look\'s at every distance', () => {
  assert.deepEqual([fogAt(40).uFog, fogAt(2000).uFog].map((c) => c.map((x) => +x.toFixed(4))), [[0.07, 0.08, 0.1], [0.07, 0.08, 0.1]]);
});
