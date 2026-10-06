// DRAW BATCHES FOR A LONG TRACK (2026-10-05). The editor was "very laggy" on a 29 km track: the preview drew it as 15,791 surface
// batches and 28,979 line sets a frame, 114 ms of draw calls before the GPU did any work (measured with a counting GL). app/preview/merge.js
// merges consecutive batches that draw alike (the same colour, or the same AC material) into batches of up to MERGE_MAX_VERTS vertices,
// baked into world space, their road lines with them; a track under MERGE_FROM batches is drawn as before.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { createCoreShell } = require('../core/coreshell.js');
const { linesFor } = require('../preview/look.js');
const { createMerger, MERGE_FROM, MERGE_MAX_VERTS } = require('../preview/merge.js');
const P = require('../preview/preview.js');

// a batch: a quad strip of `rows` rows, 3 across, at x = dx, under a model matrix that turns it 90° about y and moves it by (tx, 0, tz)
function strip(key, { rows = 4, dx = 0, tx = 0, tz = 0, colour = [0.5, 0.5, 0.5], material = 0, seam = false } = {}) {
  const K = 3, pos = [], nrm = [], uv = [], idx = [];
  for (let r = 0; r < rows; r++) for (let k = 0; k < K; k++) { pos.push(dx + k, 0, r); nrm.push(0, 1, 0); uv.push(k, r); }
  for (let r = 0; r + 1 < rows; r++) for (let k = 0; k + 1 < K; k++) { const v = r * K + k; idx.push(v, v + K, v + 1, v + 1, v + K, v + K + 1); }
  // row-vector (world = local · M): x' = z, z' = −x, plus the translation
  const model = [0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, tx, 0, tz, 1];
  return { key, seam, model, positions: Float32Array.from(pos), normals: Float32Array.from(nrm), uvs: Float32Array.from(uv), indices: Uint16Array.from(idx), colour, materialIndex: material, cols: K, us: [-1, 0, 1], rowS: Array.from({ length: rows }, (_, r) => 2 * r) };
}
const world = (b, i) => { const M = b.model, x = b.positions[3 * i], y = b.positions[3 * i + 1], z = b.positions[3 * i + 2]; return [x * M[0] + y * M[4] + z * M[8] + M[12], x * M[1] + y * M[5] + z * M[9] + M[13], x * M[2] + y * M[6] + z * M[10] + M[14]]; };
const triangles = (bs) => crypto.createHash('sha256').update(bs.flatMap((b) => { const out = []; for (let t = 0; t < b.indices.length; t += 3) out.push([0, 1, 2].map((j) => world(b, b.indices[t + j]).map((v) => v.toFixed(4)).join(',')).join('|')); return out; }).sort().join('\n')).digest('hex');
const many = (n, opts = {}) => Array.from({ length: n }, (_, i) => strip(`c${i}`, { tz: 4 * i, ...opts }));
const byColour = (b) => b.colour.join(',');

test('a short track (under MERGE_FROM batches) is drawn as it was: the same batch objects', () => {
  const bs = many(MERGE_FROM - 1), out = createMerger()(bs, byColour);
  assert.equal(out, bs);
});

test('a long track is drawn in a few merged batches with exactly the same triangles where they were (world space)', () => {
  const bs = many(2000), out = createMerger()(bs, byColour);
  assert.deepEqual([out.length < bs.length / 10, triangles(out) === triangles(bs), out.every((b) => b.model.every((v, i) => v === (i % 5 === 0 ? 1 : 0)))], [true, true, true]);
});

test('normals are turned with their batch into world space', () => {
  const out = createMerger()(many(MERGE_FROM).map((b) => ({ ...b, normals: Float32Array.from({ length: b.normals.length }, (_, i) => (i % 3 === 0 ? 1 : 0)) })), byColour);
  assert.deepEqual(Array.from(out[0].normals.slice(0, 3)), [0, 0, -1]);   // +x locally is −z in the world under this model
});

test('no merged batch passes MERGE_MAX_VERTS vertices (a 16-bit index), and batches that draw differently are never merged', () => {
  const bs = many(3000).map((b, i) => ({ ...b, colour: i < 1500 ? [1, 0, 0] : [0, 0, 1] })), out = createMerger()(bs, byColour);
  assert.deepEqual([out.every((b) => b.positions.length / 3 <= MERGE_MAX_VERTS), out.every((b) => new Set(b.members.map(byColour)).size === 1)], [true, true]);
});

test('the road lines go with their batches: the same edge and tie segments, in world space', () => {
  const bs = many(MERGE_FROM), out = createMerger()(bs, byColour);
  const segs = (list) => list.flatMap((L) => { const o = []; for (let i = 0; i < L.length; i += 3) o.push([L[i], L[i + 1], L[i + 2]].map((v) => v.toFixed(4)).join(',')); return o; }).sort().join(';');
  const mine = bs.flatMap((b) => { const L = linesFor(b); return [L.edges, L.ties].map((arr) => { const w = new Float32Array(arr.length); for (let i = 0; i < arr.length; i += 3) { const M = b.model, [x, y, z] = [arr[i], arr[i + 1], arr[i + 2]]; w[i] = x * M[0] + y * M[4] + z * M[8] + M[12]; w[i + 1] = x * M[1] + y * M[5] + z * M[9] + M[13]; w[i + 2] = x * M[2] + y * M[6] + z * M[10] + M[14]; } return w; }); });
  assert.equal(segs(out.flatMap((b) => [b.lines.edges, b.lines.ties])), segs(mine));
});

test('the same batches give the same merged batches (no work in a frame where nothing changed); an edit rebuilds only its own group', () => {
  const merge = createMerger(), bs = many(12000), first = merge(bs, byColour), again = merge(bs, byColour);   // 144,000 vertices: three merged batches
  const edited = bs.slice(); edited[11990] = strip('c11990', { tz: 4 * 11990, dx: 0.5 });
  const after = merge(edited, byColour);
  assert.deepEqual([again === first, after[0] === first[0], after[after.length - 1] === first[first.length - 1]], [true, true, false]);
});

// the preview, through the real shell, with the counting GL of app/test/preview-band.test.js
function countingGL() {
  const calls = { drawElements: 0, drawArrays: 0 };
  const gl = new Proxy({ VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14,
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0,
    drawElements() { calls.drawElements++; }, drawArrays() { calls.drawArrays++; } }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [];
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, step() { const f = q; q = []; for (const g of f) g(16); } };
  return { calls, win, canvas: { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} } };
}

test('the preview draws a 4 km track in a tenth of the draw calls it has batches, in both looks', async () => {
  const s = await createCoreShell({ brushFn: null });
  s.extend({ length: 1200, family: 'half-pipe' }); s.extend({ length: 1600, transition: 200, targets: { kh: 1 / 600 } }); s.extend({ length: 1200, transition: 200, targets: { kh: 0 } });
  const f = countingGL(), pv = P.createPreview({ canvas: f.canvas, shell: s, win: f.win }); f.win.step();
  const n = pv.view().track.batches.length, frame = () => { f.calls.drawElements = 0; f.calls.drawArrays = 0; f.win.step(); return f.calls.drawElements + f.calls.drawArrays; };
  const ac = frame(); pv.setLook('words'); const words = frame(); pv.dispose();
  assert.ok(n >= MERGE_FROM && ac <= n / 10 && words <= n / 10, `${n} batches: ${ac} calls in the AC look, ${words} in word colours`);
});

test('cells that alternate between two looks (a body cell, a darker seam cell, …) still merge: batches are grouped by look across the track', () => {
  const bs = many(3000).map((b, i) => ({ ...b, colour: i % 2 ? [0.3, 0.3, 0.3] : [0.6, 0.6, 0.6] })), out = createMerger()(bs, byColour);
  assert.deepEqual([out.length <= 4, triangles(out) === triangles(bs)], [true, true], `${out.length} batches`);
});
