// section.js: THE SECTION EDIT (2026-10-05). Change one VALUE channel (bank phi, width w, height h, cup c) over a stretch [from, to]
// of the track: SET it to a value (the stretch is flat at it) or CHANGE it BY an amount (the stretch keeps its shape), with a ramp in
// over [from − rampIn, from] and a ramp out over [to, to + rampOut], each its own length, smooth (S-curve) or linear.
//
// It is the brush's method with a different weight (src/core/sculpt.js): each control point moves by a weight times the change, the
// weight read at the point's knot average (ref 10 §2: the curve then follows the weight, exactly where it is linear), and the brush's
// applyControls keeps every road joint C1 and leaves untouched pieces the same objects. The weight is 1 for every control point whose
// support meets [from, to], so the stretch holds the value exactly (the basis sums to 1, ref 03 §1b), and along each ramp it is the
// ramp's shape at the point's knot average: the brush's own falloff (smooth) or a straight line (linear), 0 past the ramp's end.
// Measured on 20 m knots, a 200 m ramp (the rule chosen over cutting the weight off at the ramp's end, which squeezed the ramp to about
// 150 m): a smooth ramp is within 0.01 of the S-curve everywhere; a linear one is straight through its middle and rounds its corner at
// the stretch over about 2 knot spans (a cubic spline has no corner). Past the ramp's end the change is under 0.5% of it (smooth) or
// 5% (linear: its far corner is rounded the same way), measured at most 0.21% and 2.9% for ramps of 6 to 20 knot spans, and it is
// zero beyond 2 knot spans: a control point there has its whole support outside the ramp.
// A ramp holding fewer than RAMP_SPANS knot spans would step rather than ramp, so its knots are refined first (document.js
// refineKnots, exact Boehm insertion), as the sharp brush does, and the result says so.
'use strict';
const D = require('./document.js');
const { smootherstep, knotAverage, pieceOffsets, spanUnder, guardChannel, applyControls } = require('./sculpt.js');
const AD = require('./adapter.js');
const Prof = require('../geom/profile.js');

const SECTION_CHANNELS = Object.freeze(['phi', 'w', 'h', 'c']);
const MIN_RAMP_M = 10, RAMP_SPANS = 6;
const SHAPES = Object.freeze({ smooth: (d) => 1 - smootherstep(d), linear: (d) => 1 - Math.min(Math.max(d, 0), 1) });
const bad = (msg) => new D.CoreError('BAD_SECTION', msg);

const hasRoad = (doc) => doc.pieces.some((P) => P.type === 'road');   // the adapter refuses a track with no road (EMPTY)

/** The track's length along the adapter's path (the s a user picks on the preview); 0 with no road yet. */
function trackLength(doc, off) {
  if (!hasRoad(doc)) return 0;
  off = off || pieceOffsets(doc);
  const last = doc.pieces.length - 1;
  return off[last] + (doc.pieces[last].type === 'road' ? doc.pieces[last].length : 0);
}

function check(doc, { channel, from, to, rampIn, rampOut, shape, op, value }, off) {
  if (!SECTION_CHANNELS.includes(channel)) throw new D.CoreError('BAD_CHANNEL', `section: channel "${channel}" is not one a section sets (${SECTION_CHANNELS.join(', ')}); a turn's or a climb's rate moves the rest of the track, use the rate brush`);
  if (!SHAPES[shape]) throw bad(`section: ramp shape "${shape}" (known: ${Object.keys(SHAPES).join(', ')})`);
  if (op !== 'set' && op !== 'add') throw bad(`section: op "${op}" (known: set, add)`);
  if (![from, to, rampIn, rampOut, value].every(Number.isFinite)) throw bad(`section: from, to, the ramps and the value must be numbers (got ${from}, ${to}, ${rampIn}, ${rampOut}, ${value})`);
  if (!(to > from)) throw bad(`section: the stretch must end after it starts (from ${from} m, to ${to} m)`);
  if (rampIn < MIN_RAMP_M || rampOut < MIN_RAMP_M) throw bad(`section: each ramp must be at least ${MIN_RAMP_M} m (in ${rampIn} m, out ${rampOut} m)`);
  const L = trackLength(doc, off), lo = from - rampIn, hi = to + rampOut;
  if (lo < 0 || hi > L) throw bad(`section: the stretch with its ramps (${+lo.toFixed(1)} to ${+hi.toFixed(1)} m) must lie inside the track (0 to ${+L.toFixed(1)} m)${doc.closed ? ': it may not cross the start/finish line' : ''}`);
  // the height offset must be back to 0 (value and slope) before every flight (document.js FLIGHT_OFFSET), so it cannot be set over a jump
  const jump = channel !== 'h' ? -1 : doc.pieces.findIndex((P, p) => P.type === 'flight' && hi > off[p] && lo < (off[p + 1] ?? L));
  if (jump >= 0) throw new D.CoreError('FLIGHT_OFFSET', `section: a height edit cannot reach a jump (${doc.pieces[jump].id}, from ${+off[jump].toFixed(1)} m): the road's height offset must be back to 0 before a flight. End the stretch and its ramps before the takeoff, or start them after the landing`);
}

/** Refine the knots under each ramp to at most ramp / RAMP_SPANS where they are coarser. Returns { doc, refined }. `off`: the pieces' offsets (knots move no piece). */
function refineRamps(doc, { from, to, rampIn, rampOut }, off) {
  let refined = false;
  for (const [a, b] of [[from - rampIn, from], [to, to + rampOut]]) {
    const h = (b - a) / RAMP_SPANS, lo = a - 4 * h, hi = b + 4 * h;
    if (spanUnder(doc, off, lo, hi) <= h + 1e-9) continue;
    doc.pieces.forEach((P, p) => {
      if (P.type !== 'road' || off[p] + P.length <= lo || off[p] >= hi) return;
      const r = D.refineKnots(doc, P.id, Math.max(0, lo - off[p]), Math.min(P.length, hi - off[p]), h);
      if (r.inserted.length) { doc = r.doc; refined = true; }
    });
  }
  return { doc, refined };
}

/** The weight of a control point with support [a, b] and knot average tau (lap distances). */
function weight({ from, to, rampIn, rampOut, shape }, a, b, tau) {
  if (b > from && a < to) return 1;                                     // meets the stretch: the stretch holds the value
  return tau <= from ? SHAPES[shape]((from - tau) / rampIn) : SHAPES[shape]((tau - to) / rampOut);
}

/**
 * THE SECTION EDIT. `channel` one of SECTION_CHANNELS, in the document's units (phi in radians, w and h in m, c in degrees);
 * `from` < `to` the stretch (lap distances, m); `rampIn`, `rampOut` ≥ MIN_RAMP_M; `shape` 'smooth' (default) or 'linear';
 * `op` 'set' (the stretch becomes `value`) or 'add' (the stretch changes by `value`). Returns { doc: a new, checked, frozen
 * document, changed: [{ piece, indices }], refined: whether knots were added under a ramp, note, window: [lo, hi], the stretch of
 * track that changed (the ramps plus their tails, at most 2 knot spans past each) }.
 */
function section(doc, { channel, from, to, rampIn, rampOut, shape = 'smooth', op = 'set', value } = {}) {
  const p0 = { channel, from, to, rampIn, rampOut, shape, op, value };
  // the pieces' offsets along the path, once: converting to cup and refining knots change no piece's length (pieceOffsets builds every segment)
  const off = pieceOffsets(doc);
  check(doc, p0, off);
  // a cup edit reaching legacy pieces turns them into cup pieces first, at the edge they render (toCup)
  let start = doc, conv = null;
  if (channel === 'c') { const reach0 = 2 * spanUnder(doc, off, from - rampIn, to + rampOut); conv = toCup(doc, from - rampIn - reach0, to + rampOut + reach0, off); start = conv.doc; }
  const r = refineRamps(start, p0, off), base = r.doc, lo = from - rampIn, hi = to + rampOut;
  const reach = 2 * spanUnder(base, off, lo, hi);                       // a control point past this has its support outside the ramp
  // a closed lap's seam is a joint the document does not re-derive: a ramp's tail never moves its value or slope (the first road
  // piece's first two control points and the last one's last two)
  const roads = base.pieces.map((P, p) => (P.type === 'road' ? p : -1)).filter((p) => p >= 0), first = roads[0], last = roads[roads.length - 1];
  const seam = (p, i, n) => base.closed && ((p === first && i < 2) || (p === last && i >= n - 2));
  const W = base.pieces.map((P, p) => {                                  // each road piece's control-point weights (null: untouched)
    if (P.type !== 'road' || off[p] + P.length <= lo - reach || off[p] >= hi + reach) return null;
    guardChannel(P, channel, 'section edit');
    const t = D.knotVector(P), n = P.channels[channel].length;
    return Array.from({ length: n }, (_, i) => (seam(p, i, n) ? 0 : weight(p0, off[p] + t[i], off[p] + t[i + 4], off[p] + knotAverage(t, i))));
  });
  // A JOINT'S FOUR CONTROL POINTS MOVE TOGETHER: applyControls rebuilds the next piece's first two from the previous piece's last two
  // (C1, as the document builds a joint), so they take the largest of the four weights. Without this, a stretch starting just after a
  // joint did not hold a SET value: its first points were rebuilt from the ramp's (the code review, 2026-10-05: up to 0.15 m on 40 m).
  let a = -1;
  for (let b = 0; b < base.pieces.length; b++) {
    if (base.pieces[b].type !== 'road') continue;
    if (a >= 0 && W[a] && W[b]) {
      const na = W[a].length, m = Math.max(W[a][na - 1], W[a][na - 2], W[b][0], W[b][1]);
      if (m > 0) { W[a][na - 1] = m; W[a][na - 2] = m; W[b][0] = m; W[b][1] = m; }
    }
    a = b;
  }
  const res = base.pieces.map((P, p) => {
    if (!W[p]) return null;
    const c = P.channels[channel], ctrl = c.slice(), changed = [];
    W[p].forEach((w, i) => { if (!(w > 0)) return; ctrl[i] = op === 'set' ? c[i] + w * (value - c[i]) : c[i] + w * value; changed.push(i); });
    if (channel === 'w' && changed.some((i) => !(ctrl[i] > 0))) throw bad(`section: the road's width must stay above 0 m (piece ${P.id} would reach ${+Math.min(...changed.map((i) => ctrl[i])).toFixed(2)} m)`);
    return { ctrl, changed };
  });
  let out;
  try { out = applyControls(base, channel, res); } catch (e) {
    // (check() refuses a height window that meets a flight, so this is a guard: the inner message without its own code prefix)
    if (e.code === 'FLIGHT_OFFSET') throw new D.CoreError('FLIGHT_OFFSET', `section: a height edit cannot reach a jump's takeoff: the road's height offset must be back to 0 before a flight (${String(e.message).replace(/^FLIGHT_OFFSET: /, '')})`);
    throw e;
  }
  const notes = [];
  if (conv && conv.converted.length) { const m = wallMoveM(doc, conv.doc, conv.converted); notes.push(`${conv.converted.length} legacy piece${conv.converted.length > 1 ? 's' : ''} under the stretch became cup pieces at the edge they render${m >= 0.001 ? `: their walls moved by up to ${Math.round(m * 1000)} mm, where the legacy wall cap no longer applies` : ', with the road unchanged'}`); }
  if (r.refined) notes.push(`finer knots were added under the ramps (at most ${+(Math.min(rampIn, rampOut) / RAMP_SPANS).toFixed(2)} m apart) so they ramp as asked; that can nudge the road just outside by a fraction of a millimetre`);
  if (!out.changed.length) notes.push('the stretch holds no whole control-point support: nothing changed');
  // the window that really changed: the supports of the control points that moved (a ramp's tail reaches up to 2 knot spans past it)
  let wLo = Infinity, wHi = -Infinity;
  for (const { piece, indices } of out.changed) { const t = D.knotVector(base.pieces[piece]); for (const i of indices) { wLo = Math.min(wLo, off[piece] + t[i]); wHi = Math.max(wHi, off[piece] + t[i + 4]); } }
  return { doc: out.doc, changed: out.changed, refined: r.refined, note: notes.length ? notes.join('; ') : null, window: out.changed.length ? [wLo, wHi] : [lo, hi] };
}

/** The edge a legacy piece renders at s (document.js legacyEdgeDeg on its own w and r; degrees). */
const edgeAt = (P, s) => D.legacyEdgeDeg(P.family, D.channelAt(P, 'w', s).v, D.channelAt(P, 'r', s).v);

/**
 * CUP ON A LEGACY STRETCH. A legacy road piece has no cup channel: its cross-section is its family's measured floor with each quarter's
 * rise capped by r (src/core/README.md "cross-section"). So before a cup edit, every legacy road piece meeting [lo, hi] becomes a CUP
 * piece whose cup is the edge it renders: c(s) = legacyEdgeDeg(family, w(s), r(s)), exact at both ends (so the rendered edge is
 * continuous to every legacy neighbour, the document's 0.05° joint rule) with the ends' slopes, and at the knot averages between
 * (ref 10 §2); two converted neighbours are joined C1 as the document builds a joint (sculpt.js applyControls). Where the r cap does
 * not bind, a cup piece at its legacy edge has the same floor (both are the family's floor, the cup's scaled to that edge); where it
 * binds, the walls between centre and edge move a little (src/core/README.md: 36 mm on a 12 m bowl, 148 mm on a 24 m half-pipe).
 * Tube pieces are not converted (a piece is a cup or a tube). Returns { doc, converted: [piece indices] }.
 */
function toCup(doc, lo, hi, off = pieceOffsets(doc)) {
  const converted = [];
  const pieces = doc.pieces.map((P, p) => {
    if (P.type !== 'road' || P.cup || P.tube || off[p] + P.length < lo || off[p] > hi) return P;
    converted.push(p);
    const t = D.knotVector(P), n = P.channels.w.length, L = P.length, d = 0.01;
    const slope = (s) => { const a = Math.max(0, s - d), b = Math.min(L, s + d); return (edgeAt(P, b) - edgeAt(P, a)) / (b - a); };
    const h0 = P.knots.length ? P.knots[0] : L, hL = L - (P.knots.length ? P.knots[P.knots.length - 1] : 0);
    const c = Array.from({ length: n }, (_, i) => edgeAt(P, knotAverage(t, i)));
    c[0] = edgeAt(P, 0); c[n - 1] = edgeAt(P, L);
    if (n > 3) { c[1] = c[0] + (slope(0) * h0) / 3; c[n - 2] = c[n - 1] - (slope(L) * hL) / 3; }
    const qc = c.map((v) => { const x = Number(Math.min(D.CUP_MAX, Math.max(0, v)).toFixed(D.DEC.c)); return Object.is(x, -0) ? 0 : x; });
    return { ...P, cup: true, channels: { ...P.channels, c: qc } };
  });
  if (!converted.length) return { doc, converted };
  const res = pieces.map((P, p) => (converted.includes(p) ? { ctrl: P.channels.c.slice(), changed: P.channels.c.map((_, i) => i) } : null));
  return { doc: applyControls({ ...doc, pieces }, 'c', res).doc, converted };
}

/**
 * How far converting pieces to cup moved their walls (m): each converted piece's legacy cross-section (adapter.js profileAt, its w and r)
 * against its cup cross-section (cupProfile, its new c), at 17 points across, every 5 m. The joints' 10 m morph is not counted.
 */
function wallMoveM(before, after, converted) {
  let worst = 0;
  for (const p of converted) {
    const A = before.pieces[p], B = after.pieces[p], n = Math.max(1, Math.ceil(A.length / 5));
    for (let j = 0; j <= n; j++) {
      const s = (A.length * j) / n, w = D.channelAt(A, 'w', s).v;
      const L = Prof.normalize(AD.profileAt(A.family, w, D.channelAt(A, 'r', s).v)), C = Prof.normalize(AD.cupProfile(B.family, w, D.channelAt(B, 'c', s).v));
      const u0 = L.u[0], u1 = L.u[L.u.length - 1];
      for (let k = 0; k <= 16; k++) { const u = u0 + ((u1 - u0) * k) / 16, a = Prof.offsetAt(L, u), b = Prof.offsetAt(C, u); worst = Math.max(worst, Math.hypot(a[0] - b[0], a[1] - b[1])); }
    }
  }
  return worst;
}

/**
 * What a channel is over [from, to] now, for the panel's readout: { min, max } in the document's units, read every 2 m on the road
 * (a flight has no channels). A legacy piece has no cup channel; its cup is the edge it renders (document.js legacyEdgeDeg), as Extend
 * shows it. null when no road lies in [from, to].
 */
function rangeOf(doc, channel, from, to) {
  if (!hasRoad(doc)) return null;
  const off = pieceOffsets(doc); let min = Infinity, max = -Infinity;
  doc.pieces.forEach((P, p) => {
    if (P.type !== 'road' || off[p] + P.length < from || off[p] > to) return;
    const a = Math.max(from, off[p]) - off[p], b = Math.min(to, off[p] + P.length) - off[p], n = Math.max(1, Math.ceil((b - a) / 2));
    for (let j = 0; j <= n; j++) {
      const u = a + ((b - a) * j) / n;
      const v = channel === 'c' && !P.cup ? D.legacyEdgeDeg(P.family, D.channelAt(P, 'w', u).v, D.channelAt(P, 'r', u).v) : D.channelAt(P, channel, u).v;
      if (v < min) min = v; if (v > max) max = v;
    }
  });
  return min <= max ? { min, max } : null;
}

module.exports = { section, toCup, rangeOf, trackLength, SECTION_CHANNELS, MIN_RAMP_M, RAMP_SPANS, SHAPES };
