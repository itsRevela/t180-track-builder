// THE TURN LIST (section edit, 2026-10-05). The user picks "a specific turn of the already created track" to tune: a turn is a run of
// heading rate of one sign, tighter than TURN_K_MIN, short easings inside it merged, turns under MIN_TURN_DEG left out. Checked here
// against the 3D path's own heading (src/core/adapter.js toPath), not against the channel the list is read from.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { toPath } = require('../../src/core/adapter.js');
const { findTurns, turnsFromRates, MIN_TURN_DEG } = require('../core/turns.js');

const straight = (d, length) => extend(d, { length, transition: 60, targets: { kh: 0 } });
const turn = (d, length, k) => extend(d, { length, transition: 60, targets: { kh: k } });
const headingAt = (samples, s) => { const m = samples.reduce((a, b) => (Math.abs(b.s - s) < Math.abs(a.s - s) ? b : a)); return Math.atan2(m.T[0], m.T[2]) * 180 / Math.PI; };

test('a straight has no turns', () => {
  assert.deepEqual(findTurns(straight(extend(D.createDoc('s'), { length: 200 }), 600)), []);
});

test('one left turn: its direction, and its angle as the path itself turns between its ends', () => {
  const d = straight(turn(extend(D.createDoc('l'), { length: 200 }), 500, 1 / 300), 200), [t] = findTurns(d), S = toPath(d).path.samples;
  const pathAngle = headingAt(S, t.to) - headingAt(S, t.from);
  assert.deepEqual([findTurns(d).length, t.dir, Math.abs(t.angleDeg - pathAngle) < 1.5, Math.abs(t.minRadiusM - 300) < 15], [1, 'left', true, true], JSON.stringify(t));
});

test('an S-bend is two turns, left then right, in track order', () => {
  const d = straight(turn(turn(extend(D.createDoc('s'), { length: 200 }), 400, 1 / 250), 400, -1 / 250), 200);
  assert.deepEqual(findTurns(d).map((t) => t.dir), ['left', 'right']);
});

test(`a kink under ${MIN_TURN_DEG}° is not listed as a turn`, () => {
  const d = straight(turn(extend(D.createDoc('k'), { length: 200 }), 60, 1 / 1500), 300);
  assert.deepEqual(findTurns(d), []);
});

test('on a closed lap the turns add up to one whole turn', () => {
  const lap = D.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'test', 'fixtures', 'F2-halfpipe-default-lap-closed.core2.json'), 'utf8'));
  const total = findTurns(lap).reduce((a, t) => a + (t.dir === 'left' ? 1 : -1) * t.angleDeg, 0);
  assert.ok(Math.abs(Math.abs(total) - 360) < 5, `total ${total}°`);
});

test('on a closed lap, a turn running through the start line is one turn, marked as crossing it', () => {
  // rates every 2 m over a 1000 m lap: turning left from 900 m round to 100 m, straight between
  const rates = Array.from({ length: 501 }, (_, i) => ({ s: 2 * i, k: 2 * i <= 100 || 2 * i >= 900 ? 1 / 200 : 0 }));
  const turns = turnsFromRates(rates, { closed: true, length: 1000 });
  assert.deepEqual(turns.map((t) => [t.dir, t.from, t.to, t.crossesStart]), [['left', 900, 100, true]]);
});

test('each turn is numbered in track order and named for the list', () => {
  const d = straight(turn(turn(extend(D.createDoc('s'), { length: 200 }), 400, 1 / 250), 400, -1 / 250), 200), turns = findTurns(d);
  assert.deepEqual([turns.map((t) => t.n), /^Turn 1 · left \d+° · R \d+ m · [\d.]+–[\d.]+ km$/.test(turns[0].label)], [[1, 2], true], turns[0].label);
});

test('an empty track has no turns (and no error)', () => {
  assert.deepEqual(findTurns(D.createDoc('empty')), []);
});
