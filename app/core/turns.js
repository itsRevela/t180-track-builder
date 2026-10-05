// turns.js: THE TURN LIST for the section edit (2026-10-05). The user wants to pick "a specific turn of the already created track" and
// tune it, but a track's pieces need not line up with its turns (an imported track is cut where its straights' middles fall), so the
// turns are read from the heading rate kh itself (src/core/document.js; kh > 0 turns left).
//
//   findTurns(doc)                          -> [{ n, from, to, dir, angleDeg, minRadiusM, crossesStart, label }], in track order
//   turnsFromRates(rates, { closed, length }) -> the same from [{ s, k }] (heading rate k every few metres)
//
// A turn is a run of samples of one sign at least TURN_K_MIN (a radius of 2 km or tighter); a run of the same sign that starts within
// MERGE_GAP_M of the last one's end continues it (a turn that eases for a moment is still one turn); an opposite sign starts a new turn
// (an S-bend is two). [from, to] is where the turning is at least TURN_K_MIN, so a section edit's ramps fall on the easing in and out.
// The angle is the heading rate integrated over [from, to]; a turn under MIN_TURN_DEG is left out. On a closed lap, a turn running
// through the start line is one turn with from > to, marked crossesStart (the section edit cannot cross the start line).
'use strict';
const D = require('../../src/core/document.js');
const { pieceOffsets } = require('../../src/core/sculpt.js');
const { trackLength } = require('../../src/core/section.js');

const TURN_K_MIN = 1 / 2000, MERGE_GAP_M = 40, MIN_TURN_DEG = 10, STEP_M = 2;
const RAD = 180 / Math.PI;

/** The heading rate every STEP_M along the road: [{ s, k }] (a flight does not turn, so it has no samples). */
function ratesOf(doc, off = pieceOffsets(doc)) {
  const out = [];
  doc.pieces.forEach((P, p) => {
    if (P.type !== 'road') return;
    const n = Math.max(1, Math.ceil(P.length / STEP_M));
    for (let j = 0; j <= n; j++) { const u = (P.length * j) / n; out.push({ s: off[p] + u, k: D.channelAt(P, 'kh', u).v }); }
  });
  return out;
}

/** ∫k ds over rates[i0..i1] by the trapezoid rule (rad). */
function integral(rates, i0, i1) {
  let a = 0;
  for (let i = i0 + 1; i <= i1; i++) a += 0.5 * (rates[i].k + rates[i - 1].k) * (rates[i].s - rates[i - 1].s);
  return a;
}

const km = (s) => (s / 1000).toFixed(2);
const label = (t) => `Turn ${t.n} · ${t.dir} ${Math.round(t.angleDeg)}° · R ${Math.round(t.minRadiusM)} m · ${km(t.from)}–${km(t.to)} km${t.crossesStart ? ' · crosses the start line' : ''}`;

function turnsFromRates(rates, { closed = false, length = rates.length ? rates[rates.length - 1].s : 0 } = {}) {
  const runs = [];
  let cur = null;
  rates.forEach((r, i) => {
    const sign = Math.abs(r.k) >= TURN_K_MIN ? Math.sign(r.k) : 0;
    if (!sign) return;
    if (cur && cur.sign === sign && r.s - rates[cur.i1].s <= MERGE_GAP_M) { cur.i1 = i; cur.kMax = Math.max(cur.kMax, Math.abs(r.k)); return; }
    cur = { sign, i0: i, i1: i, kMax: Math.abs(r.k) };
    runs.push(cur);
  });
  let turns = runs.map((u) => ({ sign: u.sign, from: rates[u.i0].s, to: rates[u.i1].s, angle: integral(rates, u.i0, u.i1), kMax: u.kMax, crossesStart: false }));
  // a closed lap's turn through the start line: its last run and its first, one sign, each reaching the line
  if (closed && turns.length >= 2) {
    const a = turns[0], b = turns[turns.length - 1];
    if (a.sign === b.sign && a.from - rates[0].s <= MERGE_GAP_M && length - b.to <= MERGE_GAP_M) {
      turns = [...turns.slice(1, -1), { sign: a.sign, from: b.from, to: a.to, angle: a.angle + b.angle, kMax: Math.max(a.kMax, b.kMax), crossesStart: true }];
    }
  }
  return turns
    .filter((t) => Math.abs(t.angle) * RAD >= MIN_TURN_DEG)
    .map((t, k) => { const out = { n: k + 1, from: t.from, to: t.to, dir: t.sign > 0 ? 'left' : 'right', angleDeg: Math.abs(t.angle) * RAD, minRadiusM: 1 / t.kMax, crossesStart: t.crossesStart }; return { ...out, label: label(out) }; });
}

function findTurns(doc) {
  if (!doc.pieces.some((P) => P.type === 'road')) return [];   // nothing built yet: the adapter has no path for it
  const off = pieceOffsets(doc);
  return turnsFromRates(ratesOf(doc, off), { closed: !!doc.closed, length: trackLength(doc, off) });
}

module.exports = { findTurns, turnsFromRates, TURN_K_MIN, MERGE_GAP_M, MIN_TURN_DEG };
