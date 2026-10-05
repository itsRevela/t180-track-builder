// THE STATUS STRIP (app/validate-ui/strip.js, 2026-10-05): the validation summary always in sight, over the 3D view. Before, it sat at
// the foot of a long left column, usually scrolled out of view. The strip MIRRORS the panel's summary; the panel stays where the
// layout puts it (app/test/shell-layout.test.js: "the side sections live in the left column under the controls").
// And THE LAP LIST IN RANGES: a failing lap was listed one line per 2 m station (333 lines for one 660 m crest).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { stripModel } = require('../validate-ui/strip.js');
const { lapRanges } = require('../validate-ui/labels.js');

const result = (o = {}) => ({ red: [], amber: [], jumps: [], lap: { ok: null, reason: 'open' }, pendingFrom: null, ...o });
const texts = (m) => m.map((c) => c.text);

test('a clean, closed track reads as clean at a glance: no reds, no ambers, the lap proved', () => {
  const m = stripModel({ result: result(), lap: { ok: true, speedFrom: 'lapsim' } });
  assert.deepEqual([texts(m), m.map((c) => c.level)], [['0 red', '0 amber', 'lap proved at full throttle', '0 jumps'], ['clear', 'clear', 'ok', 'clear']]);
});

test('reds and ambers are counted and coloured, and a failing lap says so', () => {
  const m = stripModel({ result: result({ red: [{}, {}], amber: [{}] }), lap: { ok: false, speedFrom: 'lapsim' } });
  assert.deepEqual(m.slice(0, 3).map((c) => [c.text, c.level]), [['2 red', 'red'], ['1 amber', 'amber'], ['lap FAILS at full throttle', 'red']]);
});

test('an open track says its lap waits for the loop to close, and a jump still waiting for its landing is counted', () => {
  const m = stripModel({ result: result({ jumps: [{ pending: true }] }), lap: { ok: null, reason: 'open' } });
  assert.deepEqual(texts(m).slice(2), ['lap: the loop is still open', '1 jump (1 waiting for its landing)']);
});

test('a track that could not be validated says why, in one red chip', () => {
  assert.deepEqual(stripModel({ result: null, error: 'the document does not resolve' }).map((c) => [c.text, c.level]), [['not validated: the document does not resolve', 'red']]);
});

test('nothing placed yet: the strip says so, quietly', () => {
  assert.deepEqual(texts(stripModel({ result: null, lap: null })), ['nothing to check yet']);
});

test('a failing lap is listed as ranges: 333 stations of one crest are ONE line, not 333', () => {
  const where = Array.from({ length: 333 }, (_, i) => ({ s: 1438 + 2 * i, reason: 'leaves-surface' }));
  assert.deepEqual(lapRanges(where), [{ reason: 'leaves-surface', s0: 1438, s1: 2102, n: 333 }]);
});

test('ranges split where the reason changes or the stations stop being next to each other', () => {
  const where = [{ s: 10, reason: 'leaves-surface' }, { s: 12, reason: 'leaves-surface' }, { s: 40, reason: 'leaves-surface' }, { s: 42, reason: 'stall' }, { s: 500, reason: 'jump-not-caught-6.3g' }];
  assert.deepEqual(lapRanges(where).map((r) => [r.reason, r.s0, r.s1]), [['leaves-surface', 10, 12], ['leaves-surface', 40, 40], ['stall', 42, 42], ['jump-not-caught-6.3g', 500, 500]]);
});

test('the strip sits over the 3D view without becoming a row of the stage (the stage stays preview + camera)', () => {
  const page = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
  const stage = page.match(/<main id="stage">([\s\S]*?)<\/main>/)[1];
  assert.match(stage, /<div id="status-strip"[^>]*>/);
  assert.match(page, /#status-strip\s*\{[^}]*position:\s*absolute/);
});
