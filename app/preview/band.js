// band.js: THE STRETCH ON THE ROAD for the section edit (2026-10-05). The stretch being edited and its two ramps, tinted on the road
// itself, so the user sees what "From", "To" and the ramps cover before anything changes (app/core/sectionpanel.js sends them as
// 't180-section'). Pure: built from the preview's own path and segments. Each row is the road's cross-section at a path station, laid
// as the export lays it (src/export/fromwords.js: the segment's profile, src/geom/profile.js readAt / offsetAt / normalAt, in the
// station's L and U), so the band hugs a half-pipe's walls as it does a flat road. The renderer draws it see-through with a polygon
// offset, so it never fights the road it lies on for depth. A jump's flight has no road and no band.
//
//   bandBatches(path, segments, { from, to, rampIn, rampOut } | null, { maxVerts }) ->
//     [{ kind: 'ramp' | 'stretch', s0, s1, positions, normals, indices (Uint16), model, colour }]
'use strict';
const Prof = require('../../src/geom/profile.js');

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
const BAND_COLOURS = Object.freeze({ stretch: Object.freeze([1.0, 0.62, 0.15]), ramp: Object.freeze([1.0, 0.88, 0.45]) });
const ACROSS = 8;               // points across each half of the road: a row is 2·ACROSS + 1 points, right edge to left
const MAX_VERTS = 60000;        // a 16-bit index draws up to 65,535 vertices

/** One row: the cross-section at path station m on segment g (d m into it): its points and normals, right edge to left. */
function rowAt(m, g, d) {
  const P = Prof.readAt(g, d), r = P.u[0], l = P.u[P.u.length - 1], pts = [], nrm = [];
  for (let j = 0; j <= 2 * ACROSS; j++) {
    const u = j < ACROSS ? r * (1 - j / ACROSS) : j === ACROSS ? 0 : l * ((j - ACROSS) / ACROSS);
    const [X, Y] = Prof.offsetAt(P, u), [nl, nu] = Prof.normalAt(P, u);
    pts.push(m.pos[0] + m.L[0] * X + m.U[0] * Y, m.pos[1] + m.L[1] * X + m.U[1] * Y, m.pos[2] + m.L[2] * X + m.U[2] * Y);
    nrm.push(m.L[0] * nl + m.U[0] * nu, m.L[1] * nl + m.U[1] * nu, m.L[2] * nl + m.U[2] * nu);
  }
  return { s: m.s, pts, nrm };
}

/** Rows into batches of at most maxVerts vertices; consecutive batches share their boundary row, so the band has no gap. */
function batchesOf(rows, kind, maxVerts) {
  const row = 2 * ACROSS + 1, per = Math.max(2, Math.floor(maxVerts / row)), out = [];
  for (let a = 0; a + 1 < rows.length; a += per - 1) {
    const part = rows.slice(a, a + per), n = part.length, positions = new Float32Array(n * row * 3), normals = new Float32Array(n * row * 3), idx = [];
    part.forEach((r, i) => { positions.set(r.pts, i * row * 3); normals.set(r.nrm, i * row * 3); });
    for (let i = 0; i + 1 < n; i++) for (let j = 0; j < row - 1; j++) { const v = i * row + j; idx.push(v, v + row, v + 1, v + 1, v + row, v + row + 1); }
    out.push({ kind, s0: part[0].s, s1: part[n - 1].s, positions, normals, indices: Uint16Array.from(idx), model: IDENTITY, colour: BAND_COLOURS[kind] });
  }
  return out;
}

function bandBatches(path, segments, sec, { maxVerts = MAX_VERTS } = {}) {
  if (!sec || !path || !path.samples || !path.samples.length || !Array.isArray(segments)) return [];
  const segS0 = []; { let a = path.samples[0].s; for (const g of segments) { segS0.push(a); a += g.length; } }   // where each segment starts
  const zones = [['ramp', sec.from - sec.rampIn, sec.from], ['stretch', sec.from, sec.to], ['ramp', sec.to, sec.to + sec.rampOut]];
  const out = [];
  for (const [kind, a, b] of zones) {
    if (!(b > a)) continue;
    let rows = [];
    const flush = () => { if (rows.length >= 2) out.push(...batchesOf(rows, kind, maxVerts)); rows = []; };
    for (const m of path.samples) {
      if (m.s < a - 1e-9) continue;
      if (m.s > b + 1e-9) break;
      const g = segments[m.seg];
      if (!g || g.kind !== 'road' || !g.profile) { flush(); continue; }   // a jump's flight: no road, so no band
      rows.push(rowAt(m, g, m.s - segS0[m.seg]));
    }
    flush();
  }
  return out;
}

module.exports = { bandBatches, BAND_COLOURS, ACROSS, MAX_VERTS };
