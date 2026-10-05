// A BUSY VIEW'S LABELS (layout overhaul, phase 4, 2026-10-05). Seen from Overhead, a 105-piece, 29 km track drew about 25 readout labels,
// 16 px bold on opaque boxes, and they covered the track. Now the layer draws at most LABEL_CAP: the head's own label first (never
// culled, as before), then the piece under the pointer, then the nearest to the head. A view with LABEL_CAP or fewer is unchanged.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { layout, nearestPiece, LABEL_CAP } = require('../core/labels.js');

// twenty labels on a grid far enough apart that none overlaps another; item 0 is the head's
const spread = (n = 20) => Array.from({ length: n }, (_, i) => ({ piece: `p${i}`, text: 'x', x: 60 + (i % 5) * 150, y: 40 + Math.floor(i / 5) * 90, w: 60, h: 30, head: i === 0, priority: i === 0 ? -1 : i }));
const VIEW = { width: 900, height: 480, head: null };

test('with no cap every label that fits is drawn (the layout as before)', () => {
  assert.equal(layout(spread(), VIEW).drawn.length, 20);
});

test('with the cap, a busy view draws LABEL_CAP labels and says the rest were left out', () => {
  const r = layout(spread(), { ...VIEW, cap: LABEL_CAP });
  assert.deepEqual([r.drawn.length, r.culled.length], [LABEL_CAP, 20 - LABEL_CAP]);
});

test('the head\'s own label is drawn under the cap, and the hovered piece next, wherever it is', () => {
  const items = spread().map((it) => (it.piece === 'p19' ? { ...it, priority: -0.5 } : it));
  const drawn = layout(items, { ...VIEW, cap: 2 }).drawn.map((d) => d.piece);
  assert.deepEqual(drawn, ['p0', 'p19']);
});

test('the hovered piece is the one whose projected point is nearest the pointer, within the reach', () => {
  const points = [{ piece: 'a', x: 100, y: 100 }, { piece: 'b', x: 140, y: 100 }, { piece: 'a', x: 300, y: 300 }];
  assert.deepEqual([nearestPiece(points, { x: 132, y: 104 }, 48), nearestPiece(points, { x: 295, y: 290 }, 48), nearestPiece(points, { x: 600, y: 10 }, 48), nearestPiece(points, null, 48)],
    ['b', 'a', null, null]);
});
