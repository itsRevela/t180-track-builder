// BATCHING THE KN5's MESHES (2026-10-05). An exported 29 km equation track ran at 20 fps or less in Assetto Corsa: its kn5 held 30,269
// meshes (one per 2 m road cell, one per underside cell), and AC pays a draw call per mesh, and more for its shadows. batchForAc merges
// consecutive meshes of one kind (the physics road, the underside skin, …), one material and the same flags into meshes of up to
// BATCH_MAX_VERTS vertices (a kn5 index is 16 bits), each named after its first member. Paint marks and markers are left as they are.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { batchForAc, BATCH_MAX_VERTS, BATCH_MAX_SPAN_M } = require('../src/export/acready.js');
const { exportSegments, buildFromSegments } = require('../src/export/fromwords.js');
const { readKn5 } = require('../tools/kn5.cjs');

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-batch-test-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

// a quad (2 triangles, 4 vertices) at z, under its own name and material
const quad = (name, z, { material = 0, castShadows = true, n = 4 } = {}) => {
  const P = [], N = [], UV = [], I = [];
  for (let k = 0; k < n; k += 4) { P.push(0, 0, z, 1, 0, z, 0, 0, z + 1, 1, 0, z + 1); N.push(0, 1, 0, 0, 1, 0, 0, 1, 0, 0, 1, 0); UV.push(0, 0, 1, 0, 0, 1, 1, 1); I.push(k, k + 2, k + 1, k + 1, k + 2, k + 3); }
  return { type: 'mesh', name, material, positions: Float32Array.from(P), normals: Float32Array.from(N), uvs: Float32Array.from(UV), indices: Uint16Array.from(I), castShadows, visible: true, transparent: false, renderable: true };
};
const scene = (children) => ({ textures: [], materials: [{ name: 'a' }, { name: 'b' }], root: { type: 'dummy', name: 't180b_track', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children } });
const tris = (m) => { const out = []; for (let i = 0; i < m.indices.length; i += 3) out.push([0, 1, 2].map((k) => Array.from(m.positions.slice(3 * m.indices[i + k], 3 * m.indices[i + k] + 3)).join(',')).join('|')); return out; };

test('consecutive road cells of one material become one mesh named after the first, with every triangle where it was', () => {
  const cells = [0, 1, 2, 3].map((z) => quad(`1ROAD_p1_body_${z}`, z)), out = batchForAc(scene(cells)).root.children;
  assert.deepEqual([out.length, out[0].name, tris(out[0]).sort()], [1, '1ROAD_p1_body_0', cells.flatMap(tris).sort()]);
});

test('road, underside skin, paint and markers are never merged with one another; paint and markers are left as they are', () => {
  const marker = { type: 'dummy', name: 'AC_START_0', matrix: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], children: [] };
  const out = batchForAc(scene([quad('1ROAD_p1_body_0', 0), quad('UNDERSKIN_p1_body_0', 0), quad('1ROAD_p1_body_1', 1), quad('UNDERSKIN_p1_body_1', 1), quad('PAINT_line_0', 0), quad('PAINT_line_1', 1), marker])).root.children;
  assert.deepEqual(out.map((m) => m.name).sort(), ['1ROAD_p1_body_0', 'AC_START_0', 'PAINT_line_0', 'PAINT_line_1', 'UNDERSKIN_p1_body_0']);
});

test('a different material or shadow flag starts a new mesh, and so does the next piece, part or lane: each is still found by its name', () => {
  const out = batchForAc(scene([quad('1ROAD_p1_body_0', 0), quad('1ROAD_p1_body_1', 1, { material: 1 }), quad('1ROAD_p1_body_2', 2, { castShadows: false }), quad('1ROAD_p2_body_0', 3), quad('1ROAD_p2_land_0', 4), quad('1ROAD_PIT_lane_0', 5)])).root.children;
  assert.deepEqual(out.map((m) => m.name), ['1ROAD_p1_body_0', '1ROAD_p1_body_1', '1ROAD_p1_body_2', '1ROAD_p2_body_0', '1ROAD_p2_land_0', '1ROAD_PIT_lane_0']);
});

// AC runs a car's physics against the meshes near it, and culls what is off screen per mesh, so a batch is a stretch of road, not a lap
test('no batch spans more than BATCH_MAX_SPAN_M (its box\'s diagonal), so physics and culling stay local', () => {
  const box = (m) => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; for (let i = 0; i < m.positions.length; i++) { lo[i % 3] = Math.min(lo[i % 3], m.positions[i]); hi[i % 3] = Math.max(hi[i % 3], m.positions[i]); } return Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2]); };
  const out = batchForAc(scene(Array.from({ length: 300 }, (_, k) => quad(`1ROAD_p1_body_${k}`, 2 * k)))).root.children;
  assert.ok(out.length > 1 && out.every((m) => box(m) <= BATCH_MAX_SPAN_M), out.map(box).join(','));
});

test('no batch passes BATCH_MAX_VERTS vertices (a kn5 index is 16 bits)', () => {
  const big = Array.from({ length: 40 }, (_, k) => quad(`1ROAD_p1_body_${k}`, k, { n: 4000 })), out = batchForAc(scene(big)).root.children;
  assert.ok(BATCH_MAX_VERTS <= 65535 && out.length > 1 && out.every((m) => m.positions.length / 3 <= BATCH_MAX_VERTS), out.map((m) => m.positions.length / 3).join(','));
});

// an EQUATION track is meshed per 2 m cell (src/core/adapter.js segments of segM = 2), which is where the 30,269 came from; a word
// track is meshed per word and gains little. The closed half-pipe lap fixture, through the core shell's own start layout
test('an exported equation lap carries a tenth of the meshes or fewer (one per 2 m cell before), and reads back with its markers and unique names', () => {
  const CD = require('../src/core/document.js'), { toSegments } = require('../src/core/adapter.js'), { startLayout } = require('../app/core/coreshell.js');
  const doc = CD.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'F2-halfpipe-default-lap-closed.core2.json'), 'utf8'));
  const segs = toSegments(doc), start = { pos: doc.start.pos, theta: doc.start.heading, p: doc.start.pitch };
  const opts = { markers: startLayout(segs, null, start), start };
  const out = tmp(), r = exportSegments(segs, { name: 'Batch Lap', via: 'test' }, { outDir: out, ...opts }), f = r.folders[0];
  const k = readKn5(path.join(f.dir, `${f.folder}.kn5`)), road = k.meshes.filter((m) => /^\d/.test(m.name));
  let cells = 0; (function walk(n) { if (n.type === 'mesh' && /^\d/.test(n.name)) cells++; for (const c of n.children || []) walk(c); })(buildFromSegments(segs, { name: 'Batch Lap', via: 'test' }, opts).scene.root);
  assert.deepEqual([cells > 100, road.length <= cells / 10, new Set(k.meshes.map((m) => m.name)).size === k.meshes.length, k.dummies.some((x) => x.name === 'AC_START_0')], [true, true, true, true], `road meshes ${road.length} for ${cells} road cells, all ${k.meshes.length}`);
});
