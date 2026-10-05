// THE JUMP INTENT (app/core/intents.js): a gap, a drop and a landing angle, and an optional KICKER (a take-off ramp at an
// angle, as real T-180 jumps are flown: a median 7.2° up, FINDINGS §8), placed as the core's own flight piece
// (src/core/document.js flightPiece), whose landing ramp the adapter sizes for both measured landings (src/validate/jumps.js).
// Every check is made on the REAL path the adapter builds and on the real validator.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const { toPath } = require('../../src/core/adapter.js');
const { extend } = require('../../src/core/extend.js');
const { validate } = require('../../src/validate/index.js');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const I = require('../core/intents.js');

const DEG = 180 / Math.PI;
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} (±${tol})`);
const straightDoc = (L = 300) => extend(D.createDoc('t'), extendOptions({ length: L, empty: true }));
/** The take-off lip and the landing lip on the real path: the last road sample before the gap and the first after it. */
function lips(doc) {
  const { path, segments } = toPath(doc, { step: 0.5 }), S = path.samples;
  const i = S.findIndex((p) => segments[p.seg].kind === 'gap'), j = S.findIndex((p, k) => k > i && segments[p.seg].kind !== 'gap');
  return { lip: S[i - 1], land: S[j], path, segments };
}

test('a jump places a flight of the gap and drop asked, as the core\'s own flight piece', () => {
  const d = I.applyIntent(straightDoc(), { kind: 'jump', gap: 81, drop: 14, land: -2 });
  const last = d.pieces[d.pieces.length - 1], { lip, land } = lips(d);
  const across = Math.hypot(land.pos[0] - lip.pos[0], land.pos[2] - lip.pos[2]);
  assert.deepEqual([last.type, Math.round(across), Math.round((lip.pos[1] - land.pos[1]) * 10) / 10], ['flight', 81, 14]);
});

test('a jump off a level road at the default 81 m is caught at both landings at the design speed (the validator\'s own check)', () => {
  const d = I.applyIntent(straightDoc(), { kind: 'jump', gap: 81, drop: 14, land: -2 });
  const { path, segments } = toPath(d, { step: 2 }), j = validate(path, segments, { csp: true, designSpeed: 460 / 3.6 }).jumps[0];
  assert.deepEqual([j.reachable, j.landings.map((l) => l.caught)], [true, [true, true]]);
});

test('a jump on an equation track draws no red: its gap is a jump, not a hole in the road (found in the window: 1 red, gap-in-road)', () => {
  const d = I.applyIntent(I.applyIntent(straightDoc(), { kind: 'jump', gap: 81, drop: 14, land: -2 }), { kind: 'straight', length: 200, blend: 20 });
  const { path, segments } = toPath(d, { step: 2 });
  assert.deepEqual(validate(path, segments, { csp: true, designSpeed: 460 / 3.6 }).red.map((r) => `${r.reason} ${r.s0}-${r.s1}`), []);
});

test('a kicker raises the take-off to its angle, and the jump leaves from it', () => {
  const d = I.applyIntent(straightDoc(), { kind: 'jump', gap: 125, drop: 14, land: -2, kickerDeg: 7.2, kickerLength: 40 });
  near(Math.asin(lips(d).lip.T[1]) * DEG, 7.2, 0.05, 'pitch at the take-off lip (°)');
});

test('the road after a jump goes on: a straight placed after it starts from the landing', () => {
  const d = I.applyIntent(I.applyIntent(straightDoc(), { kind: 'jump', gap: 81, drop: 14, land: -2 }), { kind: 'straight', length: 200, blend: 20 });
  assert.equal(d.pieces[d.pieces.length - 1].type, 'road');
});

test('the readout gives the take-off speed both landings need, and whether the design speed clears it', () => {
  const short = I.intentReadout(straightDoc(), { kind: 'jump', gap: 81, drop: 14, land: -2 });
  const long = I.intentReadout(straightDoc(), { kind: 'jump', gap: 200, drop: 14, land: -2 });
  assert.deepEqual([short.clearsAtDesign, short.minSpeedKmh < 460, long.clearsAtDesign, long.minSpeedKmh > 460], [true, true, false, true]);
});

test('a kicker lowers the speed a long jump needs, in the readout as in the flight', () => {
  const flat = I.intentReadout(straightDoc(), { kind: 'jump', gap: 160, drop: 14, land: -2 });
  const kicked = I.intentReadout(straightDoc(), { kind: 'jump', gap: 160, drop: 14, land: -2, kickerDeg: 7.2, kickerLength: 40 });
  assert.ok(kicked.minSpeedKmh < flat.minSpeedKmh, `kicked ${kicked.minSpeedKmh} km/h, flat ${flat.minSpeedKmh} km/h`);
});

test('a landing too deep to reach is placed (guardrails, not gates) but the readout says the car cannot reach it', () => {
  const r = I.intentReadout(straightDoc(), { kind: 'jump', gap: 81, drop: 60, land: -2 });
  const d = I.applyIntent(straightDoc(), { kind: 'jump', gap: 81, drop: 60, land: -2 });
  assert.deepEqual([r.reachable, d.pieces[d.pieces.length - 1].type], [false, 'flight']);
});

test('a jump needs road to take off from: refused on an empty track and straight after another jump, and nothing changes', () => {
  const after = I.applyIntent(straightDoc(), { kind: 'jump', gap: 81, drop: 14, land: -2 });
  for (const d of [D.createDoc('t'), after]) assert.throws(() => I.applyIntent(d, { kind: 'jump', gap: 81, drop: 14, land: -2 }), (e) => e.name === 'IntentError' && /road to take off/.test(e.message));
  assert.throws(() => I.applyIntent(straightDoc(), { kind: 'jump', gap: 0, drop: 14, land: -2 }), (e) => e.name === 'IntentError');
});

test('a jump with its kicker is ONE undo step through the shell', async () => {
  const s = await createCoreShell({});
  s.extendIntent({ kind: 'straight', length: 300, blend: 20 });
  const before = s.getState().history.present;
  s.extendIntent({ kind: 'jump', gap: 125, drop: 14, land: -2, kickerDeg: 7.2, kickerLength: 40 });
  const added = s.getState().history.present.pieces.length - before.pieces.length;
  s.undo();
  assert.deepEqual([added, s.getState().history.present], [3, before]);
});

test('the defaults are the vocabulary\'s jump (the corpus p10 gap that clears at 460 km/h off a level road)', () => {
  const W = require('../../src/doc/vocab.js').WORDS.jump;
  assert.deepEqual(I.JUMP_DEFAULTS, { gap: W.gap, drop: W.drop, landDeg: Math.round(W.land * DEG * 1e9) / 1e9 });
});
