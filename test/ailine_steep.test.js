// THE AI LINE OVER STEEP ROAD (2026-10-05). Assetto Corsa crashed loading the AI line of an exported 29 km track: acs.exe,
// AISpline::calculateNormals, a read of address 0x90 (a null pointer) on point 300 of 4,869, where the road was tilted 74.8°; every
// point before it, tilted up to 71.4°, had loaded. Removing ai/fast_lane.ai let the same track load and lap. So a line with a point
// over road tilted past AI_MAX_TILT_DEG is left out of the export, and the export says so.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const D = require('../src/doc/index.js');
const { closeLoop } = require('../src/doc/connector.js');
const { exportTrack, AI_MAX_TILT_DEG, _internal: { steepStretch } } = require('../src/export/fromwords.js');
const { appendOld } = require('./pre_d182_words.js');

const made = [];
const tmp = () => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-ailine-steep-')); made.push(d); return d; };
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
const DEG = Math.PI / 180, kmh = (v) => v / 3.6;

// a line of n points 10 m apart whose surface normal leans by tilt(i) degrees about the forward axis
const lineOf = (tilts) => ({
  points: tilts.map((_, i) => ({ pos: [0, 0, 10 * i], length: 10 * i, id: i })),
  extra: tilts.map((t) => ({ nx: Math.sin(t * DEG), ny: Math.cos(t * DEG), nz: 0, length: 10 })),
});

test('a line that never leans past the limit has no steep stretch', () => {
  assert.equal(steepStretch(lineOf([0, 20, 45, 70, 45, 0])), null);
});

test('a line that leans past the limit names the stretch: first and last steep point, where, and how steep', () => {
  const s = steepStretch(lineOf([0, 40, 72, 80, 119, 75, 60, 0]));
  assert.deepEqual([s.first, s.last, s.fromM, s.toM, Math.round(s.maxDeg)], [2, 5, 20, 50, 119]);
});

test('the limit is under the steepest tilt AC was seen to load (71.4°)', () => {
  assert.ok(AI_MAX_TILT_DEG < 71.4);
});

// the sample loop of test/export_words.test.js, with its first two straights rolled to 80° and back over 500 m
function steepLoop() {
  let d = D.createDoc('Steep Loop');
  for (const w of ['straight', 'straight', 'tight', 'straight', 'tight']) d = appendOld(D, d, w, { speed: kmh(200) });
  d = D.editWord(d, 'w1', { handles: { length: 250, roll0: 0, roll1: 80 * DEG } });
  d = D.editWord(d, 'w2', { handles: { length: 250, roll0: 80 * DEG, roll1: 0 } });
  const c = closeLoop(d);
  assert.ok(c.candidates.length, c.reason);
  const best = c.candidates.slice().sort((a, b) => a.lengthM - b.lengthM)[0].doc;
  return best.words.reduce((x, w) => D.editWord(x, w.id, { speed: kmh(200) }), best);
}

test('a track whose road rolls past the limit exports WITHOUT ai/fast_lane.ai, and the export says why and what is lost', () => {
  const out = tmp(), r = exportTrack(steepLoop(), { outDir: out });
  const f = r.folders[0];
  assert.deepEqual([fs.existsSync(path.join(f.dir, 'ai', 'fast_lane.ai')), f.files.includes('ai/fast_lane.ai'), r.warnings.some((w) => /AI line left out/.test(w) && /AI cars/.test(w))],
    [false, false, true], r.warnings.join('\n'));
});
