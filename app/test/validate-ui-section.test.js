// A SECTION EDIT'S PREVIEW IS CHECKED IN FULL (2026-10-05). The section edit previews through the brush's drag (one undo step), and
// validation defers the lap and the stations past a drag's window until the drag ends: right for a brush, which moves under the
// mouse every frame, wrong for a section edit, which the user is deciding whether to Apply. So a section preview gets the whole
// check, the lap proof included, as the track would be if applied; a brush drag still defers as before.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const { createValidationController, summary } = require('../validate-ui/panel.js');
const { makeExporter } = require('../export/export.js');

const REPO = path.resolve(__dirname, '..', '..');
const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
// validate-ui-exportlap.test.js's banked oval with its back straight flat: nothing on it lifts the car, even at 970 km/h
const FLAT_OVAL = Object.freeze([
  { length: 400 }, { length: 200, turn: 30, bank: -20 }, { length: 400 }, { length: 200, turn: 0, bank: 0 }, { length: 1140 },
  { length: 200, turn: 30, bank: -20, cup: 31 }, { length: 400 }, { length: 200, turn: 0, bank: 0, cup: 15.5 }, { length: 740 },
]);
async function flatOval() {
  const s = await createCoreShell({ exporter: await makeExporter(fromDisk) });
  const ctl = createValidationController(s);
  for (const p of FLAT_OVAL) s.extend(extendOptions({ ...p, empty: s.getState().history.present.pieces.length === 0 }));
  s.close();
  assert.ok(s.getState().history.present.closed, s.getState().message);
  return { s, ctl };
}

test('a section preview on a closed lap is proved in full before Apply: the lap has a verdict, not "deferred"', async () => {
  const { s, ctl } = await flatOval();
  s.previewSection({ channel: 'w', from: 1500, to: 1900, rampIn: 100, rampOut: 100, op: 'add', value: -2 });
  const lap = summary(ctl.state).lap; ctl.dispose();
  assert.deepEqual([s.getState().section !== null, lap.reason === 'deferred', typeof lap.ok], [true, false, 'boolean'], JSON.stringify(lap));
});

test('a brush drag still waits for its end to prove the lap (the deferral is unchanged for the brush)', async () => {
  const { s, ctl } = await flatOval();
  s.beginBrush({ mode: 'rate', channel: 'w', s0: 1700, r: 150 }); s.brushTo(-1);
  const lap = summary(ctl.state).lap; s.endBrush(); ctl.dispose();
  assert.equal(lap.reason, 'deferred');
});
