// THE STRETCH ON THE ROAD (section edit, 2026-10-05): app/preview/band.js tints the stretch being edited and its two ramps on the
// road itself, so the user sees what "From", "To" and the ramps cover before anything changes. Built from the preview's own path
// and segments: each row is a cross-section of the road at a path station, as the mesh and the export lay it (src/geom/profile.js).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { toSegments, toPath } = require('../../src/core/adapter.js');
const { createCoreShell } = require('../core/coreshell.js');
const P = require('../preview/preview.js');
const { bandBatches, BAND_COLOURS, ACROSS } = require('../preview/band.js');

function road() {
  let d = extend(D.createDoc('b'), { length: 300, family: 'bowl' });
  d = extend(d, { length: 400, transition: 80, targets: { kh: 1 / 400 } }); d = extend(d, { length: 300, transition: 80, targets: { kh: 0 } });
  return { doc: d, segs: toSegments(d), path: toPath(d).path };
}
const SEC = { from: 400, to: 600, rampIn: 60, rampOut: 90 };
const ROW = 2 * ACROSS + 1;
const vtx = (b, i) => [b.positions[3 * i], b.positions[3 * i + 1], b.positions[3 * i + 2]];
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

test('no stretch, no band', () => {
  const { segs, path: p } = road();
  assert.deepEqual(bandBatches(p, segs, null), []);
});

test('the stretch and its two ramps, each in its colour, each covering its own part of the road', () => {
  const { segs, path: p } = road(), out = bandBatches(p, segs, SEC);
  const zones = out.map((b) => [b.kind, b.colour === (b.kind === 'stretch' ? BAND_COLOURS.stretch : BAND_COLOURS.ramp), b.s0 >= { ramp: 0, stretch: SEC.from }[b.kind] - 1e-9]);
  const st = out.find((b) => b.kind === 'stretch');
  assert.deepEqual([zones.map((z) => z[0]), zones.every((z) => z[1] && z[2]), st.s0 - SEC.from < 2.01, SEC.to - st.s1 < 2.01, st.s1 <= SEC.to + 1e-9], [['ramp', 'stretch', 'ramp'], true, true, true, true]);
});

test('each row lies across the road at its station: its middle point on the centreline, its ends at the road\'s edges', () => {
  const { doc, segs, path: p } = road(), st = bandBatches(p, segs, SEC).find((b) => b.kind === 'stretch');
  const rows = st.positions.length / 3 / ROW, w = doc.pieces[0].channels.w[0], problems = [];   // positions are float32: ~3e-5 m at hundreds of metres
  for (let r = 0; r < rows; r++) {
    const centre = vtx(st, r * ROW + ACROSS), m = p.samples.reduce((a, b) => (dist(b.pos, centre) < dist(a.pos, centre) ? b : a));
    const edge = dist(vtx(st, r * ROW), vtx(st, r * ROW + ROW - 1));
    if (dist(m.pos, centre) > 1e-4 || !(edge > 0.8 * w && edge <= w + 1e-3)) problems.push({ r, off: dist(m.pos, centre), edge });
  }
  assert.deepEqual(problems, []);
});

test('a long stretch is cut into meshes a 16-bit index can draw, with no gap between them', () => {
  const { segs, path: p } = road(), out = bandBatches(p, segs, { ...SEC, from: 100, to: 900 }, { maxVerts: 20 * ROW }).filter((b) => b.kind === 'stretch');
  const ok = out.every((b) => b.positions.length / 3 <= 20 * ROW && b.indices instanceof Uint16Array && b.indices.every((i) => i < b.positions.length / 3));
  assert.deepEqual([out.length > 3, ok, out.every((b, k) => !k || b.s0 === out[k - 1].s1)], [true, true, true]);
});

test('a jump\'s flight inside the stretch is left untinted: the band stops at the takeoff and starts again at the landing', () => {
  const doc = D.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'F7-hill-then-jump.core2.json'), 'utf8'));
  const segs = toSegments(doc), p = toPath(doc).path, out = bandBatches(p, segs, { from: 150, to: 330, rampIn: 30, rampOut: 30 }).filter((b) => b.kind === 'stretch');
  let a = p.samples[0].s, flight = null; for (const g of segs) { if (g.kind !== 'road') flight = [a, a + g.length]; a += g.length; }   // the flight: the gap segment
  assert.deepEqual([!!flight, out.length, out.every((b) => b.s1 <= flight[0] + 1e-6 || b.s0 >= flight[1] - 1e-6)], [true, 2, true], JSON.stringify({ flight, band: out.map((b) => [b.s0, b.s1]) }));
});

// the preview draws it: the renderer's fake GL of app/test/guides.test.js, counting surface draws
function fakeGL() {
  const gl = new Proxy({ VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4, ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, COLOR_BUFFER_BIT: 8, DEPTH_BUFFER_BIT: 16, DEPTH_TEST: 9, CULL_FACE: 10, TRIANGLES: 11, FLOAT: 12, UNSIGNED_SHORT: 13, BLEND: 14,
    getShaderParameter: () => true, getProgramParameter: () => true, createShader: () => ({}), createProgram: () => ({}), createBuffer: () => ({}), getUniformLocation: (p, n) => n, getAttribLocation: () => 0 }, { get: (t, k) => (k in t ? t[k] : () => {}) });
  let q = [];
  const win = { devicePixelRatio: 1, addEventListener() {}, removeEventListener() {}, requestAnimationFrame: (f) => q.push(f), cancelAnimationFrame() {}, step() { const f = q; q = []; for (const g of f) g(16); } };
  return { win, canvas: { clientWidth: 800, clientHeight: 500, width: 0, height: 0, getContext: () => gl, addEventListener() {}, removeEventListener() {} } };
}

test('the preview draws the band when a stretch is set, and stops when it is cleared', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 400, transition: 80, targets: { kh: 1 / 400 } });
  const f = fakeGL(), pv = P.createPreview({ canvas: f.canvas, shell: s, win: f.win });
  const draws = () => { f.win.step(); return pv.renderer.stats().draws; };   // the renderer counts each frame's draws afresh
  draws(); const plain = draws();
  pv.setSection({ from: 200, to: 400, rampIn: 50, rampOut: 50 }); const banded = draws();
  pv.setSection(null); const after = draws();
  pv.dispose();
  assert.deepEqual([banded - plain >= 3, after], [true, plain], `${plain} draws plain, ${banded} with the band`);
});

test('a stretch set with frame: true puts the camera over it, looking at its middle; without frame the camera stays where it was', async () => {
  const s = await createCoreShell({ brushFn: null }); s.extend({ length: 300, family: 'bowl' }); s.extend({ length: 400, transition: 80, targets: { kh: 1 / 400 } }); s.extend({ length: 300, transition: 80, targets: { kh: 0 } });
  const f = fakeGL(), pv = P.createPreview({ canvas: f.canvas, shell: s, win: f.win }); f.win.step();
  pv.setSection({ from: 600, to: 700, rampIn: 50, rampOut: 50 }); f.win.step(); const still = pv.view().mode;
  pv.setSection({ from: 600, to: 700, rampIn: 50, rampOut: 50, frame: true }); f.win.step();
  const v = pv.view(), samples = pv.track().path.samples, mid = samples.reduce((a, b) => (Math.abs(b.s - 650) < Math.abs(a.s - 650) ? b : a)).pos;
  // a free camera's target is one metre along its view: the check is that the view's ray passes over the stretch's middle, from above
  const e = v.pose.eye, d0 = [0, 1, 2].map((k) => v.pose.target[k] - e[k]), n = Math.hypot(...d0), d = d0.map((x) => x / n), w = [0, 1, 2].map((k) => mid[k] - e[k]);
  const along = w[0] * d[0] + w[1] * d[1] + w[2] * d[2], off = Math.hypot(...[0, 1, 2].map((k) => w[k] - along * d[k]));
  pv.dispose();
  assert.deepEqual([still, v.mode, along > 0, off < 60, e[1] > mid[1] + 30], ['build', 'free', true, true, true], JSON.stringify({ off, along, eye: e, mid }));
});

test('a tube or an edge-curved stretch builds a band too (a throw here would stop the 3D view\'s frame)', () => {
  const ok = [{ t: 300 }, { e: 40 }].map((targets) => {
    let d = extend(D.createDoc('x'), { length: 200 }); d = extend(d, { length: 300, transition: 100, targets }); d = extend(d, { length: 200 });
    const out = bandBatches(toPath(d).path, toSegments(d), { from: 150, to: 450, rampIn: 40, rampOut: 40 });
    return out.length === 3 && out.every((b) => b.positions.every(Number.isFinite));
  });
  assert.deepEqual(ok, [true, true]);
});
