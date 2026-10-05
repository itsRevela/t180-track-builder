// EXTEND BY INTENT (app/core/intents.js): Straight, Turn, Climb / Dip and Bank, each built from ordinary core pieces by
// src/core/extend.js, so nothing in the core changes. Every check here is made on the REAL path the adapter builds
// (src/core/adapter.js toPath: heading, height and pitch from its samples), never on the intent's own arithmetic.
// The user's report that started it (2026-10-05): "it's impossible to extend straight out" after a curve. Measured on the
// unchanged panel: fields left as shown keep turning, turn 0 eases over the WHOLE next piece (+22.5° after 45°/100 m),
// and only turn 0 with the small "at start" box gets close.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../../src/core/document.js');
const { toPath } = require('../../src/core/adapter.js');
const { extend } = require('../../src/core/extend.js');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const I = require('../core/intents.js');

const DEG = 180 / Math.PI;
const near = (got, want, tol, what) => assert.ok(Math.abs(got - want) <= tol, `${what}: got ${got}, want ${want} (±${tol})`);

/** The real path's samples, with each one's unwrapped heading (degrees, + = left), height and pitch. */
function profile(doc) {
  const S = toPath(doc, { step: 0.5 }).path.samples;
  let h = 0, prev = null;
  return S.map((p) => {
    const a = Math.atan2(p.T[0], p.T[2]) * DEG;
    if (prev !== null) { let d = a - prev; d -= 360 * Math.round(d / 360); h += d; } else h = a;
    prev = a;
    return { s: p.s, heading: h, y: p.pos[1], pitch: Math.asin(Math.max(-1, Math.min(1, p.T[1]))) * DEG };
  });
}
const at = (P, s) => P.reduce((best, p) => (Math.abs(p.s - s) < Math.abs(best.s - s) ? p : best));
const lengthOf = (doc) => doc.pieces.reduce((a, P) => a + (P.type === 'road' ? P.length : 0), 0);
/** A straight then a left turn whose turn rate is still 45°/100 m at the open end: the head is CURVING. */
function curvingHead() {
  let d = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  d = extend(d, extendOptions({ length: 100, turn: 45 }));
  return d;
}

test('Straight after a curve: straight once the blend is done, exactly (the report: "impossible to extend straight out")', () => {
  const d0 = curvingHead(), L0 = lengthOf(d0);
  const d = I.applyIntent(d0, { kind: 'straight', length: 400, blend: 20 });
  const P = profile(d), afterBlend = at(P, L0 + 20), end = P[P.length - 1];
  near(end.heading - afterBlend.heading, 0, 0.01, 'heading change over the 380 m after the blend (°)');
});

test('Straight on a straight head adds no turn at all, from its first metre', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true })), L0 = lengthOf(d0);
  const P = profile(I.applyIntent(d0, { kind: 'straight', length: 300, blend: 20 }));
  near(P[P.length - 1].heading - at(P, L0).heading, 0, 1e-6, 'heading change over the whole straight (°)');
});

test('Turn left 90° at r 200: the heading changes by exactly 90°, the tightest curve is r 200, and what follows it is straight', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true })), L0 = lengthOf(d0);
  const d = I.applyIntent(d0, { kind: 'turn', dir: 'left', angle: 90, radius: 200, bank: 0, blend: 20, endStraight: true }), L1 = lengthOf(d);
  // "ends straight" is about what comes next: 100 m extended with the fields left as shown (Extend's continuation) must not turn
  const P = profile(extend(d, extendOptions({ length: 100 }))), start = at(P, L0), end = at(P, L1);
  let kMax = 0; for (let i = P.findIndex((p) => p.s >= L0) + 1; P[i] && P[i].s <= L1; i++) kMax = Math.max(kMax, Math.abs(P[i].heading - P[i - 1].heading) / DEG / (P[i].s - P[i - 1].s));
  assert.deepEqual(
    [Math.round((end.heading - start.heading) * 100) / 100, Math.round(1 / kMax), Math.round((P[P.length - 1].heading - end.heading) * 1e4) / 1e4 + 0],
    [90, 200, 0],
  );
});

test('a turn banks into the curve while it turns and comes back level when it ends straight', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  const d = I.applyIntent(d0, { kind: 'turn', dir: 'left', angle: 120, radius: 250, bank: 20, blend: 20, endStraight: true });
  const roads = d.pieces.filter((P) => P.type === 'road'), arc = roads[roads.length - 2];
  near(D.channelAt(arc, 'phi', arc.length / 2).v * DEG, -20, 0.05, 'bank in the middle of the arc (°; a left turn banks right side up, phi < 0)');
  near(D.endState(d).phi.v * DEG, 0, 0.05, 'bank at the end (°)');
});

test('a banked turn never banks faster than real T-180 tracks: validation finds no roll-rate warning (found in the window: 4 amber)', () => {
  const { validate } = require('../../src/validate/index.js');
  let d = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  d = I.applyIntent(d, { kind: 'turn', dir: 'left', angle: 180, radius: 190, bank: 20, blend: 20, endStraight: true });
  d = I.applyIntent(d, { kind: 'straight', length: 200, blend: 20 });
  const { path, segments } = toPath(d, { step: 2 });
  const roll = [...validate(path, segments, { csp: true, designSpeed: 460 / 3.6 }).amber, ...validate(path, segments, { csp: true, designSpeed: 460 / 3.6 }).red].filter((x) => x.reason === 'roll-rate');
  assert.deepEqual(roll, []);
});

test('the readout says when a turn\'s blend is lengthened so its bank fits, and by how much', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  const flat = I.intentReadout(d0, { kind: 'turn', dir: 'left', angle: 90, radius: 200, bank: 0, blend: 20, endStraight: true });
  const banked = I.intentReadout(d0, { kind: 'turn', dir: 'left', angle: 90, radius: 200, bank: 20, blend: 20, endStraight: true });
  assert.deepEqual([flat.blendM, banked.blendM > 20, banked.blendM < 40], [20, true, true]);
});

test('Turn right 180° without ending straight keeps curving at the radius into the next piece', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true })), L0 = lengthOf(d0);
  const d = I.applyIntent(d0, { kind: 'turn', dir: 'right', angle: 180, radius: 150, bank: 0, blend: 20, endStraight: false });
  const P = profile(d);
  near(P[P.length - 1].heading - at(P, L0).heading, -180, 0.02, 'heading change (°)');
  near(D.endState(d).kh.v, -1 / 150, 1e-5, 'turn rate at the open end (1/m)');
});

test('a turn started on a CURVING head still turns by exactly the angle asked', () => {
  const d0 = curvingHead(), L0 = lengthOf(d0);
  const P = profile(I.applyIntent(d0, { kind: 'turn', dir: 'right', angle: 60, radius: 150, bank: 0, blend: 20, endStraight: true }));
  near(P[P.length - 1].heading - at(P, L0).heading, -60, 0.02, 'heading change (°)');
});

test('a turn too small for its blends is refused by name, and the track is left as it was', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  assert.throws(() => I.applyIntent(d0, { kind: 'turn', dir: 'left', angle: 5, radius: 100, bank: 0, blend: 40, endStraight: true }), (e) => e.name === 'IntentError' && /blend/.test(e.message));
  assert.equal(d0.pieces.length, 1);
});

test('Climb 12 m over 600 m: rises by 12 m, starting and ending level, and the piece is 600 m long', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true })), L0 = lengthOf(d0);
  const d = I.applyIntent(d0, { kind: 'climb', rise: 12, length: 600, back: false });
  const P = profile(d), end = P[P.length - 1];
  assert.deepEqual([Math.round((end.y - at(P, L0).y) * 100) / 100, Math.round(Math.abs(end.pitch) * 100) / 100, lengthOf(d) - L0], [12, 0, 600]);
});

test('a hill (climb and back) ends at the height it started, level, with its top at the rise asked', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true })), L0 = lengthOf(d0);
  const P = profile(I.applyIntent(d0, { kind: 'climb', rise: 15, length: 800, back: true })), y0 = at(P, L0).y, end = P[P.length - 1];
  const top = Math.max(...P.filter((p) => p.s >= L0).map((p) => p.y)) - y0;
  assert.deepEqual([Math.round((end.y - y0) * 100) / 100 + 0, Math.round(Math.abs(end.pitch) * 100) / 100, Math.round(top * 10) / 10], [0, 0, 15]);   // + 0: -0 reads as 0
});

test('Bank to 15° over 200 m reaches 15° at the end', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  near(D.endState(I.applyIntent(d0, { kind: 'bank', to: 15, length: 200 })).phi.v * DEG, 15, 0.01, 'bank at the end (°)');
});

test('impossible intents are refused by name, never built: a zero angle, a negative radius, a zero length', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  for (const bad of [{ kind: 'turn', dir: 'left', angle: 0, radius: 100, blend: 20 }, { kind: 'turn', dir: 'left', angle: 45, radius: -5, blend: 20 }, { kind: 'straight', length: 0 }, { kind: 'climb', rise: 5, length: 0 }, { kind: 'nonsense' }]) {
    assert.throws(() => I.applyIntent(d0, bad), (e) => e.name === 'IntentError', JSON.stringify(bad));
  }
});

test('an intent placed through the shell is ONE undo step, however many pieces it adds', async () => {
  const s = await createCoreShell({});
  s.extend(extendOptions({ length: 200, empty: true }));
  const before = s.getState().history.present;
  s.extendIntent({ kind: 'turn', dir: 'left', angle: 90, radius: 200, bank: 10, blend: 20, endStraight: true });
  const added = s.getState().history.present.pieces.length - before.pieces.length;
  s.undo();
  assert.deepEqual([added > 1, s.getState().history.present], [true, before]);
});

test('the readout says what a turn adds: its length, the heading change, and the turning load at the design speed', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  const r = I.intentReadout(d0, { kind: 'turn', dir: 'left', angle: 90, radius: 200, bank: 0, blend: 20, endStraight: true });
  const built = lengthOf(I.applyIntent(d0, { kind: 'turn', dir: 'left', angle: 90, radius: 200, bank: 0, blend: 20, endStraight: true })) - 200;
  assert.deepEqual([Math.round(r.lengthM), r.headingDeg, Math.round(r.loadG * 10) / 10], [Math.round(built), 90, Math.round((460 / 3.6) ** 2 / 200 / 9.81 * 10) / 10]);
});

test('a climb\'s crest is checked at full throttle, as Export checks it: too sharp says so and how long it must be', () => {
  const d0 = extend(D.createDoc('t'), extendOptions({ length: 200, empty: true }));
  const sharp = I.intentReadout(d0, { kind: 'climb', rise: 10, length: 400, back: false }), gentle = I.intentReadout(d0, { kind: 'climb', rise: 2, length: 1600, back: false });
  assert.deepEqual([sharp.crestOk, sharp.minLengthM > 400, gentle.crestOk], [false, true, true]);
});
