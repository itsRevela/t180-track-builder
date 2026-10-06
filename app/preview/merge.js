// merge.js: DRAW BATCHES FOR A LONG TRACK (2026-10-05). The geometry hands the renderer one batch per mesh cell (app/preview/batches.js),
// so a sculpt re-uploads only the cells it moved; but each batch is a draw call, and its road lines more. The user found the editor "very
// laggy" on a 29 km track: 15,791 surface batches and 28,979 line sets a frame, 114 ms of draw calls before the GPU did any work (measured
// with a counting GL), where Assetto Corsa itself had needed the same merging (src/export/acready.js batchForAc).
//
// So a track of MERGE_FROM batches or more is drawn MERGED: the batches that draw alike (`keyOf`: the same colour in the word look, the
// same AC material), in track order, wherever they are (opaque surfaces under a depth test do not care about draw order, and the word look
// alternates a piece's body cells with its darker seam cells, which merged only two by two when only neighbours could), become batches of up to MERGE_MAX_VERTS vertices (a 16-bit index), baked into world space (each member's node
// matrix applied to its positions, normals and road lines; the model is the identity), its uvs kept. No vertex moves. A shorter track is
// drawn as it was, cell by cell. The merged batches are cached by their members: a frame where nothing changed does no work, and an edit
// rebuilds only the groups whose cells it replaced (a sculpt keeps the other cells' objects).
//
//   const merge = createMerger({ from, maxVerts })
//   merge(batches, keyOf) -> batches to draw: `batches` itself under `from`, else merged ones { key, model, positions, normals, uvs,
//                            indices, colour, materialIndex, segId, lines: { edges, ties }, members }
'use strict';
const { linesFor } = require('./look.js');

const MERGE_FROM = 256, MERGE_MAX_VERTS = 60000;
const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

/** Points (x, y, z triples) of `src` through the row-vector matrix M (world = local · M); `w` 1 for points, 0 for directions. */
function transformInto(dst, at, src, M, w) {
  for (let i = 0; i < src.length; i += 3) {
    const x = src[i], y = src[i + 1], z = src[i + 2];
    dst[at + i] = x * M[0] + y * M[4] + z * M[8] + w * M[12];
    dst[at + i + 1] = x * M[1] + y * M[5] + z * M[9] + w * M[13];
    dst[at + i + 2] = x * M[2] + y * M[6] + z * M[10] + w * M[14];
  }
}

/** One batch from consecutive members that draw alike: world-space vertices, their road lines, the first member's look. */
function mergeGroup(members) {
  const nv = members.reduce((a, b) => a + b.positions.length / 3, 0), ni = members.reduce((a, b) => a + b.indices.length, 0);
  const positions = new Float32Array(3 * nv), normals = new Float32Array(3 * nv), uvs = new Float32Array(2 * nv), indices = new Uint16Array(ni);
  const lines = members.map(linesFor), ne = lines.reduce((a, L) => a + (L ? L.edges.length : 0), 0), nt = lines.reduce((a, L) => a + (L ? L.ties.length : 0), 0);
  const edges = new Float32Array(ne), ties = new Float32Array(nt);
  let v = 0, i = 0, e = 0, t = 0;
  members.forEach((b, m) => {
    const M = b.model || IDENTITY, n = b.positions.length / 3;
    transformInto(positions, 3 * v, b.positions, M, 1); transformInto(normals, 3 * v, b.normals, M, 0);
    if (b.uvs) uvs.set(b.uvs, 2 * v);
    for (let k = 0; k < b.indices.length; k++) indices[i + k] = b.indices[k] + v;
    const L = lines[m];
    if (L) { transformInto(edges, e, L.edges, M, 1); transformInto(ties, t, L.ties, M, 1); e += L.edges.length; t += L.ties.length; }
    v += n; i += b.indices.length;
  });
  const f = members[0];
  return { key: `merged:${f.key}`, piece: f.piece, seam: false, model: IDENTITY, positions, normals, uvs, indices, colour: f.colour, materialIndex: f.materialIndex, segId: f.segId, lines: { edges, ties, centre: 0 }, members };
}

const sameMembers = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

function createMerger({ from = MERGE_FROM, maxVerts = MERGE_MAX_VERTS } = {}) {
  let lastIn = null, lastKey = null, lastOut = null;
  let cache = new WeakMap();   // first member -> merged batch (reused while its members are the same objects)
  return function merge(batches, keyOf) {
    if (!Array.isArray(batches) || batches.length < from) return batches;
    if (batches === lastIn && keyOf === lastKey) return lastOut;
    const out = [], next = new WeakMap(), open = new Map();   // look key -> { group, verts }
    const flush = (g) => {
      const hit = cache.get(g[0]), m = hit && sameMembers(hit.members, g) ? hit : mergeGroup(g);
      next.set(g[0], m); out.push(m);
    };
    for (const b of batches) {
      const k = keyOf(b), n = b.positions.length / 3;
      let o = open.get(k);
      if (o && o.verts + n > maxVerts) { flush(o.group); o = null; }
      if (!o) { o = { group: [], verts: 0 }; open.set(k, o); }
      o.group.push(b); o.verts += n;
    }
    for (const o of open.values()) flush(o.group);
    cache = next; lastIn = batches; lastKey = keyOf; lastOut = out;
    return out;
  };
}

module.exports = { createMerger, mergeGroup, MERGE_FROM, MERGE_MAX_VERTS };
