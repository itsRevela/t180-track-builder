// core_section.test.js: node --test test/core_section.test.js
// src/core/section.js, THE SECTION EDIT (2026-10-05). The user's ask: "edit a specific turn of the already created track by tuning the
// bank of the turn", "edit the width of a specific section (and have the width adjust gradually and be able to define how gradual it
// is)". One value channel (bank phi, width w, height h, cup c) over a stretch [from, to] of the track, SET to a value (the stretch is
// flat at it) or CHANGED BY an amount (the stretch keeps its shape), with a ramp in before `from` and a ramp out after `to`, each its
// own length, smooth (S-curve) or linear. Outside [from − rampIn, to + rampOut] nothing changes.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const H = require('./core_helpers.js');
const D = require('../src/core/document.js');
const { extend } = require('../src/core/extend.js');
const { pieceOffsets } = require('../src/core/sculpt.js');
const { section, rangeOf, SECTION_CHANNELS, MIN_RAMP_M } = require('../src/core/section.js');

const DEG = Math.PI / 180;
const OPEN = H.docFrom(H.gen()[0]);   // open, 4.1 km, 11 pieces, 20 m knot spans
const fixture = (name) => D.parse(fs.readFileSync(path.join(__dirname, 'fixtures', `${name}.core2.json`), 'utf8'));
const quantum = (ch) => 10 ** -D.DEC[ch];

/** A channel's value at track distance s (the road piece holding s; at a joint, the later piece). */
const offsets = new WeakMap();
function at(doc, ch, s) {
  if (!offsets.has(doc)) offsets.set(doc, pieceOffsets(doc));
  const off = offsets.get(doc); let p = -1;
  doc.pieces.forEach((P, i) => { if (P.type === 'road' && s >= off[i] - 1e-9 && s <= off[i] + P.length + 1e-9) p = i; });
  return D.channelAt(doc.pieces[p], ch, Math.min(Math.max(s - off[p], 0), doc.pieces[p].length)).v;
}
const range = (a, b, step = 1) => { const out = []; for (let s = a; s <= b + 1e-9; s += step) out.push(s); return out; };
const refused = (fn, code) => assert.throws(fn, (e) => e.code === code, `expected ${code}`);

test('the section edit offers the value channels: bank, width, height and cup', () => {
  assert.deepEqual([...SECTION_CHANNELS].sort(), ['c', 'h', 'phi', 'w']);
});

test('SET: the whole stretch holds the value exactly (to the document\'s stored step)', () => {
  const { doc } = section(OPEN, { channel: 'phi', from: 1200, to: 1500, rampIn: 120, rampOut: 120, op: 'set', value: 25 * DEG });
  const off = range(1200, 1500).map((s) => Math.abs(at(doc, 'phi', s) - 25 * DEG));
  assert.ok(Math.max(...off) <= quantum('phi'), `worst ${Math.max(...off)} rad`);
});

test('CHANGE BY: the stretch moves by exactly the amount and keeps its shape', () => {
  const { doc } = section(OPEN, { channel: 'w', from: 2200, to: 2600, rampIn: 120, rampOut: 120, op: 'add', value: 3 });
  const off = range(2200, 2600).map((s) => Math.abs(at(doc, 'w', s) - at(OPEN, 'w', s) - 3));
  assert.ok(Math.max(...off) <= quantum('w'), `worst ${Math.max(...off)} m`);
});

test('nothing beyond 2 knot spans past either ramp changes: every control point there is the same double, in every channel', () => {
  const from = 1200, to = 1500, lo = from - 120 - 40, hi = to + 160 + 40, { doc, refined } = section(OPEN, { channel: 'phi', from, to, rampIn: 120, rampOut: 160, op: 'set', value: 25 * DEG });
  assert.equal(refined, false);
  const off = pieceOffsets(OPEN), moved = [];
  OPEN.pieces.forEach((P, p) => {
    const t = D.knotVector(P);
    for (const ch of D.CHANNELS) P.channels[ch].forEach((v, i) => { if ((off[p] + t[i + 4] <= lo || off[p] + t[i] >= hi) && !Object.is(v, doc.pieces[p].channels[ch][i])) moved.push(`${P.id} ${ch}[${i}]`); });
  });
  assert.deepEqual(moved, []);
});

test('each ramp is gradual: the change grows steadily from nothing at the ramp\'s far end to all of it at the stretch', () => {
  const from = 1200, to = 1500, { doc } = section(OPEN, { channel: 'w', from, to, rampIn: 160, rampOut: 240, op: 'add', value: 4 });
  const change = (s) => at(doc, 'w', s) - at(OPEN, 'w', s), tol = quantum('w');
  const rampIn = range(from - 160, from, 2).map(change), rampOut = range(to, to + 240, 2).map(change).reverse();
  const steady = (xs) => xs.every((x, i) => !i || x >= xs[i - 1] - tol);
  assert.deepEqual([steady(rampIn), steady(rampOut), Math.abs(rampIn[0]) <= 0.005 * 4, Math.abs(rampOut[0]) <= 0.005 * 4], [true, true, true, true], `far ends ${rampIn[0]}, ${rampOut[0]}`);
});

test('a linear ramp falls at a steady rate (a quarter left three-quarters of the way out); a smooth one eases off (an S-curve, a tenth left)', () => {
  const run = (shape) => { const { doc } = section(OPEN, { channel: 'w', from: 1200, to: 1500, rampIn: 200, rampOut: 200, op: 'add', value: 4, shape }); return [1100, 1050].map((s) => (at(doc, 'w', s) - at(OPEN, 'w', s)) / 4); };
  const [linMid, lin] = run('linear'), [smoothMid, smooth] = run('smooth');
  assert.ok(Math.abs(linMid - 0.5) < 0.03 && Math.abs(smoothMid - 0.5) < 0.03 && Math.abs(lin - 0.25) < 0.03 && Math.abs(smooth - 0.104) < 0.03, `halfway ${linMid.toFixed(3)} / ${smoothMid.toFixed(3)}, three-quarters ${lin.toFixed(3)} / ${smooth.toFixed(3)}`);
});

test('a ramp shorter than the knots allow is honoured by adding finer knots first, and the result says so', () => {
  const from = 1200, to = 1500, res = section(OPEN, { channel: 'w', from, to, rampIn: 20, rampOut: 20, op: 'add', value: 4 }), doc = res.doc;
  const change = (s) => at(doc, 'w', s) - at(OPEN, 'w', s);
  assert.deepEqual([res.refined, /finer knots/.test(res.note || ''), Math.abs(change(from) - 4) <= 1e-3, Math.abs(change(from - 10) - 2) < 0.6, Math.abs(change(from - 35)) < 1e-3],
    [true, true, true, true, true], `at from ${change(from)}, mid-ramp ${change(from - 10)}, past it ${change(from - 35)}`);
});

test('a stretch across a piece joint keeps the joint smooth (C1, as the document requires) and level', () => {
  const { doc } = section(OPEN, { channel: 'phi', from: 700, to: 900, rampIn: 100, rampOut: 100, op: 'set', value: -15 * DEG });
  const off = pieceOffsets(doc), j = off[2], a = D.channelAt(doc.pieces[1], 'phi', doc.pieces[1].length), b = D.channelAt(doc.pieces[2], 'phi', 0);
  assert.deepEqual([j > 700 && j < 900, Math.abs(a.v - b.v) <= quantum('phi'), Math.abs(a.v + 15 * DEG) <= quantum('phi')], [true, true, true]);
});

test('a closed lap stays closed and checked, and its start and finish are untouched', () => {
  const lap = fixture('F2-halfpipe-default-lap-closed'), { doc } = section(lap, { channel: 'phi', from: 500, to: 800, rampIn: 100, rampOut: 100, op: 'set', value: 30 * DEG });
  assert.deepEqual([doc.closed, Object.is(doc.pieces[0], lap.pieces[0]), Object.is(doc.pieces[doc.pieces.length - 1], lap.pieces[lap.pieces.length - 1]), Math.abs(at(doc, 'phi', 650) - 30 * DEG) <= quantum('phi')], [true, true, true, true]);
});

test('on a closed lap, a ramp starting on the start line leaves the value and slope at the seam alone (its four control points)', () => {
  const lap = fixture('F2-halfpipe-default-lap-closed'), { doc } = section(lap, { channel: 'w', from: 100, to: 200, rampIn: 100, rampOut: 100, op: 'add', value: 4 });
  const a = lap.pieces[0].channels.w, b = doc.pieces[0].channels.w, n = lap.pieces.length - 1, c = lap.pieces[n].channels.w, e = doc.pieces[n].channels.w;
  assert.deepEqual([b[0], b[1], e[e.length - 2], e[e.length - 1]], [a[0], a[1], c[c.length - 2], c[c.length - 1]]);
});

test('height: a stretch is raised by the amount, and the road before and after is where it was', () => {
  const { doc } = section(OPEN, { channel: 'h', from: 2200, to: 2400, rampIn: 150, rampOut: 150, op: 'add', value: 6 });
  assert.deepEqual([Math.abs(at(doc, 'h', 2300) - at(OPEN, 'h', 2300) - 6) <= quantum('h'), at(doc, 'h', 2000) === at(OPEN, 'h', 2000), at(doc, 'h', 2600) === at(OPEN, 'h', 2600)], [true, true, true]);
});

test('cup: a cup piece\'s stretch is set to the asked edge angle', () => {
  let d = extend(D.createDoc('cup'), { length: 60 }); d = extend(d, { length: 600, transition: 40, targets: { c: 60 } });
  const { doc } = section(d, { channel: 'c', from: 300, to: 450, rampIn: 60, rampOut: 60, op: 'set', value: 90 });
  assert.ok(Math.abs(at(doc, 'c', 375) - 90) <= quantum('c'));
});

test('refused by name: a backwards stretch, a ramp under MIN_RAMP_M, a stretch past the track\'s ends, a rate channel, an unknown op', () => {
  const base = { channel: 'w', from: 1200, to: 1500, rampIn: 100, rampOut: 100, op: 'add', value: 1 };
  refused(() => section(OPEN, { ...base, from: 1500, to: 1200 }), 'BAD_SECTION');
  refused(() => section(OPEN, { ...base, rampIn: MIN_RAMP_M - 1 }), 'BAD_SECTION');
  refused(() => section(OPEN, { ...base, from: 50, rampIn: 100 }), 'BAD_SECTION');
  refused(() => section(OPEN, { ...base, channel: 'kh' }), 'BAD_CHANNEL');
  refused(() => section(OPEN, { ...base, op: 'scale' }), 'BAD_SECTION');
  refused(() => section(OPEN, { ...base, value: NaN }), 'BAD_SECTION');
});

test('refused by name: a width at or below zero, a height edit reaching a jump\'s takeoff', () => {
  refused(() => section(OPEN, { channel: 'w', from: 1200, to: 1500, rampIn: 100, rampOut: 100, op: 'set', value: 0 }), 'BAD_SECTION');
  refused(() => section(fixture('F7-hill-then-jump'), { channel: 'h', from: 150, to: 230, rampIn: 20, rampOut: 20, op: 'add', value: 2 }), 'FLIGHT_OFFSET');
});

// CUP ON LEGACY PIECES: a legacy piece renders its family's floor capped by r and has no cup channel, so a cup edit first turns the
// pieces under it into cup pieces at the edge they render (toCup). Where the cap does not bind (the fixtures), the road is unchanged.
const Prof = require('../src/geom/profile.js');
const { toSegments } = require('../src/core/adapter.js');
function crossSectionMove(a, b) {   // the largest move of any of 17 points across the road, at the middle of every road segment
  const A = toSegments(a), B = toSegments(b); let worst = 0;
  A.forEach((g, i) => {
    if (g.kind !== 'road') return;
    const P = Prof.readAt(g, g.length / 2), Q = Prof.readAt(B[i], g.length / 2), u0 = P.u[0], u1 = P.u[P.u.length - 1];
    for (let k = 0; k <= 16; k++) { const u = u0 + ((u1 - u0) * k) / 16, x = Prof.offsetAt(P, u), y = Prof.offsetAt(Q, u); worst = Math.max(worst, Math.hypot(x[0] - y[0], x[1] - y[1])); }
  });
  return worst;
}

test('a cup edit on legacy pieces turns them into cup pieces at the edge they render: by itself that leaves the road as it was', () => {
  const lap = fixture('F2-halfpipe-default-lap-closed'), res = section(lap, { channel: 'c', from: 500, to: 800, rampIn: 100, rampOut: 100, op: 'add', value: 0 });
  assert.deepEqual([res.doc.pieces.some((P) => P.cup), crossSectionMove(lap, res.doc) < 1e-6, /became cup pieces/.test(res.note || '')], [true, true, true], res.note);
});

test('then the cup takes the asked value over the stretch, and the pieces away from it stay legacy (the same objects)', () => {
  const lap = fixture('F2-halfpipe-default-lap-closed'), { doc } = section(lap, { channel: 'c', from: 500, to: 800, rampIn: 100, rampOut: 100, op: 'set', value: 70 });
  assert.deepEqual([Math.abs(at(doc, 'c', 650) - 70) <= quantum('c'), Object.is(doc.pieces[0], lap.pieces[0]), Object.is(doc.pieces[5], lap.pieces[5]), !!doc.pieces[0].cup], [true, true, true, false]);
});

test('the readout: a channel\'s lowest and highest value over a stretch, and a legacy piece\'s cup as the edge it renders', () => {
  const { doc } = section(OPEN, { channel: 'w', from: 1200, to: 1500, rampIn: 120, rampOut: 120, op: 'set', value: 17 });
  const w = rangeOf(doc, 'w', 1250, 1450), c = rangeOf(OPEN, 'c', 1250, 1450), P = OPEN.pieces[4];
  const edge = D.legacyEdgeDeg(P.family, at(OPEN, 'w', 1300), at(OPEN, 'r', 1300));
  assert.deepEqual([Math.abs(w.min - 17) <= quantum('w') && Math.abs(w.max - 17) <= quantum('w'), c.min <= edge + 1e-9 && c.max >= edge - 1e-9, c.max > 0], [true, true, true], JSON.stringify({ w, c, edge }));
});

test('an empty track reads as no length and no values, not an error', () => {
  const empty = D.createDoc('empty');
  assert.deepEqual([require('../src/core/section.js').trackLength(empty), rangeOf(empty, 'w', 0, 100)], [0, null]);
});

// THE CODE REVIEW (2026-10-05): a stretch starting just after a piece joint did not hold a SET value (up to 0.18 m off on a 40 m width,
// linear), because the joint rebuilds the next piece's first two control points from the previous piece's last two, which were on the ramp
for (const shape of ['smooth', 'linear']) {
  test(`SET holds exactly over a stretch that starts just after a piece joint (${shape} ramps)`, () => {
    const j = pieceOffsets(OPEN)[2], from = j + 10, { doc } = section(OPEN, { channel: 'w', from, to: from + 200, rampIn: 120, rampOut: 120, op: 'set', value: 40, shape });
    const off = range(from, from + 200).map((s) => Math.abs(at(doc, 'w', s) - 40));
    assert.ok(Math.max(...off) <= quantum('w'), `worst ${Math.max(...off)} m`);
  });
}
