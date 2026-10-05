// THE SECTION EDIT IN THE SHELL (2026-10-05): app/core/coreshell.js previewSection / applySection / cancelSection. The user edits the
// fields and sees the track change; Apply is ONE undo step, Cancel puts the track back with nothing to undo. While a preview is open,
// every other edit is refused by name, so nothing is built on a track the user has not accepted.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');
const { section } = require('../../src/core/section.js');

const text = (s) => D.serialize(s.getState().history.present);
const DEG = Math.PI / 180;
const WIDEN = { channel: 'w', from: 400, to: 700, rampIn: 100, rampOut: 100, op: 'add', value: 3 };
async function shellWithRoad() {
  const s = await createCoreShell({ brushFn: null });
  s.extend({ length: 600 }); s.extend({ length: 600, targets: { kh: 1 / 500 } });
  return s;
}

test('preview, then Apply: the track is the section edit of the track before it, as ONE undo step that undo takes back exactly', async () => {
  const s = await shellWithRoad(), before = text(s), base = s.getState().history.present;
  s.previewSection(WIDEN); s.applySection();
  const applied = text(s); s.undo();
  assert.deepEqual([applied === D.serialize(section(base, WIDEN).doc), text(s) === before, s.getState().section], [true, true, null]);
});

test('every preview applies its fields to the track as it was when the edit opened: changing the value replaces, never adds up', async () => {
  const s = await shellWithRoad(), base = s.getState().history.present;
  s.previewSection({ ...WIDEN, value: 2 }); s.previewSection({ ...WIDEN, value: 5 });
  assert.equal(text(s), D.serialize(section(base, { ...WIDEN, value: 5 }).doc));
});

test('Cancel puts the track back exactly and leaves nothing to undo for it', async () => {
  const s = await shellWithRoad(), before = text(s), past = s.getState().history.past.length;
  s.previewSection(WIDEN); s.cancelSection();
  assert.deepEqual([text(s) === before, s.getState().history.past.length, s.getState().history.dragBase || null, s.getState().section], [true, past, null, null]);
});

test('while a preview is open, the other edits, undo, save and export are refused by name and the preview stays', async () => {
  const s = await shellWithRoad(); s.previewSection(WIDEN); const preview = text(s), refusals = [];
  for (const act of [() => s.extend({ length: 100 }), () => s.close(), () => s.undo(), () => s.redo(), () => s.beginBrush({ mode: 'rate', channel: 'phi', s0: 300, r: 60 }), () => s.sculptOnce({ channel: 'phi', s0: 300, r: 60, delta: 0.1 })]) { act(); refusals.push(/apply or cancel the stretch edit/.test(s.getState().message || '')); }
  await s.save('x'); refusals.push(/apply or cancel the stretch edit/.test(s.getState().message || ''));
  await s.exportTo('somewhere'); refusals.push(/apply or cancel the stretch edit/.test(s.getState().message || ''));
  assert.deepEqual([refusals.every(Boolean), text(s) === preview], [true, true], JSON.stringify(refusals));
});

test('a refused first preview says why and opens nothing; a refused later one keeps the last good preview', async () => {
  const s = await shellWithRoad(), before = text(s);
  s.previewSection({ ...WIDEN, rampIn: 2 });
  const first = [/ramp/.test(s.getState().message || ''), text(s) === before, s.getState().section, s.getState().history.dragBase || null];
  s.previewSection(WIDEN); const good = text(s); s.previewSection({ ...WIDEN, from: 800, to: 500 });
  assert.deepEqual([...first, /end after it starts/.test(s.getState().message || ''), text(s) === good], [true, true, null, null, true, true]);
});

test('Apply marks the pieces under the edit as edited last, so Close leaves them alone', async () => {
  const s = await shellWithRoad(); s.previewSection(WIDEN); s.applySection();
  assert.deepEqual(s.getState().lastEdited, [0, 1]);
});

test('opening another track or starting a new one drops an open preview', async () => {
  const s = await shellWithRoad(); s.previewSection(WIDEN); s.newDoc('fresh');
  assert.deepEqual([s.getState().section, s.getState().history.dragBase || null, s.getState().history.present.pieces.length], [null, null, 0]);
});

test('the turn list and the stretch readout come from the track as it was when the edit opened', async () => {
  const s = await shellWithRoad(), turns = s.turns(); s.previewSection({ ...WIDEN, channel: 'phi', op: 'set', value: 20 * DEG });
  const r = s.sectionRange('phi', 400, 700);
  assert.deepEqual([turns.length, turns[0].dir, s.turns() === turns, Math.abs(r.min) < 1e-9 && Math.abs(r.max) < 1e-9], [1, 'left', true, true], JSON.stringify(r));
});

test('Cancel hands back the very track model the preview replaced (no rebuild of the segments)', async () => {
  const s = await shellWithRoad(), resolved = s.getState().resolved;
  s.previewSection(WIDEN); s.cancelSection();
  assert.equal(s.getState().resolved, resolved);
});
