// intents.js: EXTEND BY INTENT. The user says what a piece is FOR (a straight, a turn of so many degrees at a radius, a climb of
// so many metres, a bank), and this builds it from ORDINARY core pieces with src/core/extend.js. Nothing in the core changes: the
// result is the same kind of document, and validation, the export and undo treat it as pieces a user could have typed into Extend.
// The user's report that started it (2026-10-05): "it's impossible to extend straight out" after a curve, because a field left as
// shown keeps turning and a turn of 0 eases over the whole next piece.
//
//   applyIntent(doc, intent)   -> a new document (throws IntentError, by name, for anything it cannot build; `doc` is untouched)
//   intentReadout(doc, intent) -> what it would add, before it is added (pure arithmetic, no build: cheap enough for every keystroke)
//
//   { kind: 'straight', length, blend = 20 }
//       the turn and climb RATES go to 0 within `blend` metres (extend's short ramp), then stay exactly 0. On a straight head the
//       piece is straight from its first metre; after a curve, only the blend still turns.
//   { kind: 'turn', dir: 'left'|'right', angle (°), radius (m), bank (° into the turn, default 0), blend = 20, endStraight = true }
//       up to three pieces: the blend IN (the turn rate to 1/radius, and the bank, over `blend`), the ARC (the rate held) and, when
//       it ends straight, the blend OUT (rate and bank back to 0). The arc's length is solved so that the heading changes by exactly
//       `angle`, wherever the head started: a curving head's own turning inside the blend is counted.
//   { kind: 'climb', rise (m, − = down), length (m), back = false }
//       an S-shaped ramp of four quarter pieces on the climb rate (up, ease, down, ease) that starts where the head is and ends LEVEL,
//       `rise` higher. With `back`, a hill (or a dip) of that height that comes back down in the same total length.
//   { kind: 'bank', to (°, + = left side up), length }
//       the bank goes to `to` over the piece.
//
// SIGNS are the core's: a left turn is + (kh > 0); bank + is the left side up, so a LEFT turn banked into the curve has bank < 0.
'use strict';

const D = require('../../src/core/document.js');
const { extend } = require('../../src/core/extend.js');
const { MACH6 } = require('../../src/validate/limits.js');
const { ROLL_CHORD_M } = require('../../src/validate/index.js');

const RAD = Math.PI / 180, G = 9.81;
const BLEND_M = 20;              // the default blend: one knot span (src/core/document.js KNOT_M), as Extend's "at start" box
const ARC_MIN_M = 0.5;           // an arc shorter than this is left out (its turning is inside the solver's tolerance)
const STEP_M = 0.25;             // the integration step along a piece, for the heading and the height
const BANK_RATE_P90 = 0.849;     // °/m: how fast real T-180 tracks bank, the measured p90 (README §2, tools/bankrate.cjs)

class IntentError extends Error { constructor(message) { super(message); this.name = 'IntentError'; } }
const fail = (m) => { throw new IntentError(m); };
const positive = (x, what) => (Number.isFinite(x) && x > 0 ? x : fail(`${what} must be a positive number, got ${x}`));
const finite = (x, what) => (Number.isFinite(x) ? x : fail(`${what} must be a number, got ${x}`));
const roadsFrom = (doc, n0) => doc.pieces.slice(n0).filter((P) => P.type === 'road');
const bloss = (u) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));   // extend's blend shape (src/core/extend.js)

/**
 * How fast a bank change of dDeg over a ramp of R m turns the road, the way validation measures it: the roll over a ROLL_CHORD_M chord
 * (src/validate/index.js rollRates), at the ramp's steepest, its middle. A ramp no longer than the chord shows its whole change in one
 * chord. °/m.
 */
function peakBankRate(dDeg, R) {
  const c = ROLL_CHORD_M / 2;
  return (Math.abs(dDeg) * (R <= ROLL_CHORD_M ? 1 : bloss(0.5 + c / R) - bloss(0.5 - c / R))) / ROLL_CHORD_M;
}
/** The shortest ramp (m, up to the next half metre) over which a bank change of dDeg stays within real T-180 tracks' rate; 0: any will do. */
function bankRampM(dDeg) {
  if (peakBankRate(dDeg, ROLL_CHORD_M) <= BANK_RATE_P90) return 0;
  let lo = ROLL_CHORD_M, hi = 2 * ROLL_CHORD_M;
  while (peakBankRate(dDeg, hi) > BANK_RATE_P90) { lo = hi; hi *= 2; }
  for (let i = 0; i < 40; i++) { const m = (lo + hi) / 2; if (peakBankRate(dDeg, m) > BANK_RATE_P90) lo = m; else hi = m; }
  return Math.ceil(hi * 2) / 2;
}

/** ∫ channel `ch` over a road piece (Simpson's rule, steps of about STEP_M). */
function integral(P, ch) {
  const n = 2 * Math.max(2, Math.ceil(P.length / (2 * STEP_M))), h = P.length / n;
  let sum = 0;
  for (let i = 0; i <= n; i++) sum += (i === 0 || i === n ? 1 : i % 2 ? 4 : 2) * D.channelAt(P, ch, i * h).v;
  return (sum * h) / 3;
}
/** The heading the pieces from index n0 on turn through (rad, + = left). */
const turnedFrom = (doc, n0) => roadsFrom(doc, n0).reduce((a, P) => a + integral(P, 'kh'), 0);

/** The pitch at the open end (rad): the start's, plus every road piece's climb, a jump's landing pitch replacing it (src/core/adapter.js). */
function headPitch(doc) {
  let p = doc.start.pitch || 0;
  for (const P of doc.pieces) p = P.type === 'flight' ? P.land : p + integral(P, 'kv');
  return p;
}
/** Over the pieces from index n0, starting at pitch p0: the height they gain and the pitch they end at (dy/ds = sin pitch, dpitch/ds = kv). */
function riseFrom(doc, n0, p0) {
  let p = p0, y = 0;
  for (const P of roadsFrom(doc, n0)) {
    const n = Math.max(4, Math.ceil(P.length / STEP_M)), h = P.length / n;
    let kvA = D.channelAt(P, 'kv', 0).v;
    for (let i = 1; i <= n; i++) {
      const kvB = D.channelAt(P, 'kv', i * h).v, p2 = p + ((kvA + kvB) / 2) * h;
      y += ((Math.sin(p) + Math.sin(p2)) / 2) * h; p = p2; kvA = kvB;
    }
  }
  return { rise: y, pitch: p };
}

function straight(doc, { length, blend = BLEND_M }) {
  const L = positive(length, "a straight's length (m)"), B = Math.min(L, positive(blend, "a straight's blend (m)"));
  return extend(doc, { length: L, targets: { kh: 0, kv: 0 }, transition: { kh: B, kv: B } });
}

/**
 * A turn's numbers. The BLEND is at least what was asked, and longer where the bank needs it: the bank turns in (from the head's bank to
 * the turn's) and back out over the blend, and a 20° bank inside 20 m rolls the road at 1°/m, past what real T-180 tracks do (BANK_RATE_P90)
 * and past validation's amber (found in the window, 2026-10-05: 4 roll-rate ambers on an oval of two 20° turns). The curve tightens
 * over the same, longer blend: a gentler entry, never a faster roll.
 */
function turnParams(doc, { dir, angle, radius, bank = 0, blend = BLEND_M, endStraight = true }) {
  if (dir !== 'left' && dir !== 'right') fail(`a turn goes left or right, got ${JSON.stringify(dir)}`);
  const a = positive(angle, "a turn's angle (°)") * RAD, r = positive(radius, "a turn's radius (m)"), asked = positive(blend, "a turn's blend (m)");
  const sgn = dir === 'left' ? 1 : -1, phi = -sgn * finite(bank, "a turn's bank (°)") * RAD, out = endStraight !== false, e = D.endState(doc);
  const phi0 = e ? e.phi.v : 0, B = Math.max(asked, bankRampM((phi - phi0) / RAD), out ? bankRampM(phi / RAD) : 0);
  return { a, r, B, asked, sgn, k1: sgn / r, phi, out };
}
/** The arc's length for the heading still to turn after the blend in, less the blend out's half (a symmetric ease from k1 to 0). */
const arcFor = (t, turnedIn) => (t.sgn * t.a - turnedIn - (t.out ? (t.k1 * t.B) / 2 : 0)) / t.k1;
const tooSmall = (t, angle) => fail(`a ${angle}° turn at r ${t.r} m is smaller than its blends (${t.B} m in${t.out ? ` and ${t.B} m out` : ''}): use a shorter blend, a larger radius or a larger angle`);

function turn(doc, intent) {
  const t = turnParams(doc, intent), n0 = doc.pieces.length;
  const blendIn = extend(doc, { length: t.B, targets: { kh: t.k1, phi: t.phi } });
  const turnedIn = turnedFrom(blendIn, n0);
  const build = (arc) => {
    let d = arc >= ARC_MIN_M ? extend(blendIn, { length: arc }) : blendIn;
    if (t.out) d = extend(d, { length: t.B, targets: { kh: 0, phi: 0 } });
    return d;
  };
  let arc = arcFor(t, turnedIn);
  if (arc < -1e-6) tooSmall(t, intent.angle);
  let d = build(arc);
  // the control points are rounded (src/core/document.js DEC), so the heading is measured on the document itself and the residual
  // taken out of the arc once: a few thousandths of a degree become a few millionths
  const residual = t.sgn * t.a - turnedFrom(d, n0);
  if (arc >= ARC_MIN_M && Math.abs(residual) > 1e-7) { arc += residual / t.k1; if (arc < ARC_MIN_M) tooSmall(t, intent.angle); d = build(arc); }
  return d;
}

/** The four quarter pieces of a ramp: the climb rate to +a, back to 0, to −b, back to 0. */
function rampPieces(doc, Lq, a, b) {
  let d = extend(doc, { length: Lq, targets: { kv: a } });
  d = extend(d, { length: Lq, targets: { kv: 0 } });
  d = extend(d, { length: Lq, targets: { kv: -b } });
  return extend(d, { length: Lq, targets: { kv: 0 } });
}
/**
 * A ramp of length L from the head's pitch to LEVEL, gaining `rise`: the two peak rates (a up, b down) solved by Newton's method on the
 * document's own rise and end pitch (nearly linear: two or three steps). Small-angle start: Δpitch = (a − b)·L/4 = −p0, and a symmetric
 * ramp rises a·L²/8 (the four Bloss quarters integrate to 0.15 + 0.85 + 0.85 + 0.15 of a·(L/4)²).
 */
function ramp(doc, rise, L) {
  const Lq = L / 4, n0 = doc.pieces.length, p0 = headPitch(doc);
  const meas = (a, b) => { const d = rampPieces(doc, Lq, a, b); return { d, ...riseFrom(d, n0, p0) }; };
  let a = (8 * (rise - p0 * L / 2)) / (L * L), b = a + p0 / Lq, m = meas(a, b);
  for (let it = 0; it < 6 && (Math.abs(m.rise - rise) > 5e-4 || Math.abs(m.pitch) > 1e-7); it++) {
    const e = Math.max(1e-8, 1e-3 * Math.max(Math.abs(a), Math.abs(b))), fa = meas(a + e, b), fb = meas(a, b + e);
    const j11 = (fa.rise - m.rise) / e, j12 = (fb.rise - m.rise) / e, j21 = (fa.pitch - m.pitch) / e, j22 = (fb.pitch - m.pitch) / e, det = j11 * j22 - j12 * j21;
    if (!(Math.abs(det) > 0)) break;
    const r1 = rise - m.rise, r2 = -m.pitch;
    a += (r1 * j22 - j12 * r2) / det; b += (j11 * r2 - j21 * r1) / det;
    m = meas(a, b);
  }
  return m.d;
}
function climb(doc, { rise, length, back = false }) {
  const L = positive(length, "a climb's length (m)"), h = finite(rise, "a climb's rise (m)");
  if (h === 0) fail("a climb needs a rise in metres, up (+) or down (−), not 0");
  if (!back) return ramp(doc, h, L);
  return ramp(ramp(doc, h, L / 2), -h, L / 2);
}

function bank(doc, { to, length }) {
  const L = positive(length, "a bank's length (m)");
  return extend(doc, { length: L, targets: { phi: finite(to, 'the bank to reach (°)') * RAD } });
}

const BUILDERS = Object.freeze({ straight, turn, climb, bank });
function applyIntent(doc, intent) {
  const f = intent && BUILDERS[intent.kind];
  if (!f) fail(`no intent "${intent && intent.kind}" (known: ${Object.keys(BUILDERS).join(', ')})`);
  return f(doc, intent);
}

/**
 * What an intent would add, by arithmetic alone (the build solves exactly; these are the same numbers to a rounding):
 *   straight: { lengthM, headingDeg }  the heading the blend still turns out of a curve (0 on a straight head)
 *   turn:     { lengthM, headingDeg, loadG, blendM, blendAskedM }  loadG: the turning load at the design speed, v²/r in g (validation judges
 *             it once placed); blendM: the blend used, longer than blendAskedM where the bank needs it
 *   climb:    { lengthM, riseM, steepestDeg, crestLiftG, crestOk, minLengthM }  checked at FULL THROTTLE, the speed Export proves a
 *             lap at (src/export/fromwords.js): crestLiftG = v²·κ/g over the crest, and the car leaves the road where it passes 1 g
 *   bank:     { lengthM, bankDeg, rateDegPerM, rateOk, rateLimitDegPerM }  rateDegPerM: the steepest roll, as validation measures it;
 *             rateOk: no faster than real T-180 tracks bank (the measured p90)
 */
function intentReadout(doc, intent) {
  const e = D.endState(doc), k0 = e ? e.kh.v : 0, kind = intent && intent.kind;
  if (kind === 'straight') {
    const L = positive(intent.length, "a straight's length (m)"), B = Math.min(L, positive(intent.blend === undefined ? BLEND_M : intent.blend, "a straight's blend (m)"));
    return { lengthM: L, headingDeg: (k0 * B) / 2 / RAD };
  }
  if (kind === 'turn') {
    const t = turnParams(doc, intent), arc = arcFor(t, ((k0 + t.k1) * t.B) / 2);
    if (arc < -1e-6) tooSmall(t, intent.angle);
    const v = MACH6.designSpeedKmh / 3.6;
    return { lengthM: t.B + Math.max(0, arc) + (t.out ? t.B : 0), headingDeg: t.sgn * intent.angle, loadG: (v * v) / t.r / G, blendM: t.B, blendAskedM: t.asked };
  }
  if (kind === 'climb') {
    const L = positive(intent.length, "a climb's length (m)"), h = finite(intent.rise, "a climb's rise (m)");
    if (h === 0) fail("a climb needs a rise in metres, up (+) or down (−), not 0");
    const Lr = intent.back ? L / 2 : L, peak = (8 * Math.abs(h)) / (Lr * Lr), v = MACH6.vmaxKmh / 3.6, lift = (v * v * peak) / G;
    return { lengthM: L, riseM: h, steepestDeg: (2 * Math.abs(h)) / Lr / RAD, crestLiftG: lift, crestOk: lift < 1, minLengthM: lift < 1 ? L : L * Math.sqrt(lift) };
  }
  if (kind === 'bank') {
    const L = positive(intent.length, "a bank's length (m)"), to = finite(intent.to, 'the bank to reach (°)'), rate = peakBankRate(to - (e ? e.phi.v / RAD : 0), L);
    return { lengthM: L, bankDeg: to, rateDegPerM: rate, rateOk: rate <= BANK_RATE_P90, rateLimitDegPerM: BANK_RATE_P90 };
  }
  return fail(`no intent "${kind}" (known: ${Object.keys(BUILDERS).join(', ')})`);
}

module.exports = { applyIntent, intentReadout, headPitch, IntentError, BLEND_M, BANK_RATE_P90 };
