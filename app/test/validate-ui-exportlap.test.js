// The lap the validation panel SHOWS is the lap Export proves (2026-10-05).
// The panel validates at the design-speed slider (460 km/h by default), but Export (src/export/fromwords.js) proves the lap
// with no design speed: a word with its own speed keeps it, and a track where any road word has none is proved by the
// full-thrust lap sim, up to the Mach 6's 970 km/h. An equation track's segments carry no speed, so a crest that holds the
// car at 460 km/h and throws it off at 970 read "0 red · 0 amber · lap proved" in the panel, and Export then refused it
// with "lap-proof [leaves-surface …]" (found exporting a track built in the window). The panel's RESULT keeps the slider's
// speed (its loads and colours, and the contract that it equals a full validate); the lap it shows is Export's.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { createCoreShell } = require('../core/coreshell.js');
const { extendOptions } = require('../core/panel.js');
const { createShell } = require('../shell.js');
const { createValidationController, summary } = require('../validate-ui/panel.js');
const { createTrackModel } = require('../preview/trackmodel.js');
const { lapText } = require('../validate-ui/labels.js');
const { makeExporter } = require('../export/export.js');
const { validate } = require('../../src/validate/index.js');
const REPO = path.resolve(__dirname, '..', '..');
const fromDisk = async (p) => fs.readFileSync(path.join(REPO, p), 'utf8');
const kmh = (v) => v / 3.6;   // a document's speed is m/s
const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });

const coreStorage = () => ({
  saveDoc: async () => {}, openDoc: async () => null, listDocs: async () => [],
  folderIsEmpty: async (d) => fs.existsSync(d) && fs.readdirSync(d).length === 0, removeEmptyFolder: async (d) => fs.rmdirSync(d),
  writeExport: async (dir, folder, files) => { for (const f of files) { const p = path.join(dir, folder, ...f.path.split('/')); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, f.bytes); } },
});
const mem = () => { const docs = new Map(); let lib = null; return { saveDoc: async (n, t) => docs.set(n, t), openDoc: async (n) => docs.get(n), listDocs: async () => [...docs.keys()], saveLibrary: async (t) => { lib = t; }, openLibrary: async () => lib }; };
// the parts of a lap that tell two proofs apart: the verdict, the time (it differs with the speed model) and where it fails
const proof = (lap) => ({ ok: lap.ok, timeS: lap.timeS, where: lap.where });

// a banked oval with a hill on the back straight: sags at 8°/100 m, one crest at −2.5°/100 m (holds the car to about 540 km/h)
const HILL_OVAL = Object.freeze([
  { length: 400 }, { length: 200, turn: 30, bank: -20 }, { length: 400 }, { length: 200, turn: 0, bank: 0 },
  { length: 100, climb: 8 }, { length: 100, climb: 0 }, { length: 100, climb: -2.5 }, { length: 540 }, { length: 100, climb: 0 },
  { length: 100, climb: 8 }, { length: 100, climb: 0 },
  { length: 200, turn: 30, bank: -20, cup: 31 }, { length: 400 }, { length: 200, turn: 0, bank: 0, cup: 15.5 }, { length: 740 },
]);
// the same oval with the hill flattened into one straight: nothing on it lifts the car, even at 970 km/h
const FLAT_OVAL = Object.freeze([...HILL_OVAL.slice(0, 4), { length: 1140 }, ...HILL_OVAL.slice(11)]);
async function hillOval(plan = HILL_OVAL) {
  const s = await createCoreShell({ storage: coreStorage(), exporter: await makeExporter(fromDisk) });
  const ctl = createValidationController(s);   // the panel's own defaults: the slider at 460 km/h
  for (const p of plan) s.extend(extendOptions({ ...p, empty: s.getState().history.present.pieces.length === 0 }));
  s.close();
  assert.ok(s.getState().history.present.closed, s.getState().message);
  return { s, ctl };
}
// A HILL MADE BY THE HEIGHT BRUSH is an offset the segments do not carry: Export lifts its path by it (meta.liftPath), and so
// does the preview (resolved.lift). The controller validates the preview's path when it can share it (the app's setup), else
// a path of its own, which must be lifted, and start where the track starts, as Export's is (the code review of 2026-10-05).
async function brushedFlatOval({ share }) {
  const s = await createCoreShell({ storage: coreStorage(), exporter: await makeExporter(fromDisk) });
  let last = null;
  if (share) { const model = createTrackModel(); s.subscribe((st) => { try { last = model.update(st.resolved); } catch (e) { last = null; } }); }
  const ctl = createValidationController(s, share ? { sharedPath: () => last } : {});
  for (const p of FLAT_OVAL) s.extend(extendOptions({ ...p, empty: s.getState().history.present.pieces.length === 0 }));
  s.close();
  s.beginBrush({ mode: 'local', channel: 'height', s0: 1770, r: 150 }); s.brushTo(10); s.endBrush();   // a 10 m hill on the back straight
  assert.ok(s.getState().history.present.closed, s.getState().message);
  return { s, ctl };
}
// the piece builder's closed loop of the incremental-validation tests (validate-ui-incval.test.js)
async function pieceLoop() {
  const shell = await createShell({ storage: mem(), autosaveMs: 0 });
  const ctl = createValidationController(shell);
  for (const w of ['straight', 'straight', 'turn', 'straight', 'turn']) shell.place(w);
  shell.beginDrag(); shell.dragTo('w1', { handles: { length: 120 } }); shell.endDrag(); shell.closeLoop();
  assert.equal(shell.getState().history.present.closed, true, shell.getState().message);
  return { shell, ctl };
}

test('on an equation track, the lap the panel shows is the lap Export proves: both refuse a crest the car leaves at full throttle', async () => {
  const { s, ctl } = await hillOval();
  const shown = summary(ctl.state).lap;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-lap-')); made.push(dir);
  await s.exportTo(dir);
  const exportLapOk = !(s.getState().exportReds || []).some((r) => r.reason === 'lap-proof');
  ctl.dispose();
  assert.equal(shown.ok, exportLapOk, `the panel shows the lap ${shown.ok ? 'proved' : 'not proved'}, Export says ${exportLapOk ? 'proved' : 'not proved'}: ${(s.getState().message || '').slice(0, 160)}…`);
});

test('on an equation track Export accepts, the panel shows the lap proved too, and Export writes the track', async () => {
  const { s, ctl } = await hillOval(FLAT_OVAL);
  const shown = summary(ctl.state).lap;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-lap-')); made.push(dir);
  await s.exportTo(dir);
  ctl.dispose();
  assert.deepEqual([shown.ok, s.getState().exportReds, (s.getState().lastExport || {}).folders], [true, null, fs.readdirSync(dir)], s.getState().message);
});

for (const share of [false, true]) {
  test(`a hill raised by the height brush (${share ? 'the preview\'s path shared, as in the app' : 'no preview path to share'}): the lap shown is the lap Export proves`, async () => {
    const { s, ctl } = await brushedFlatOval({ share });
    const shown = summary(ctl.state).lap;
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-core-lap-')); made.push(dir);
    await s.exportTo(dir);
    const exportLapOk = !(s.getState().exportReds || []).some((r) => r.reason === 'lap-proof');
    ctl.dispose();
    assert.equal(shown.ok, exportLapOk, `the panel shows the lap ${shown.ok ? 'proved' : 'not proved'}, Export says ${exportLapOk ? 'proved' : 'not proved'}: ${(s.getState().message || '').slice(0, 160)}…`);
  });
}

test('the panel says how the lap it shows was proved: at full throttle, as Export proves an equation track', async () => {
  const { ctl } = await hillOval();
  const text = lapText(summary(ctl.state).lap);
  ctl.dispose();
  assert.match(text, /full throttle/);
});

test('when every road word carries its own speed, the lap shown is the one proved at those speeds, as before (Export uses them too)', async () => {
  const { shell, ctl } = await pieceLoop();
  for (const w of shell.getState().history.present.words) shell.sculpt(w.id, { speed: kmh(200) });
  const st = shell.getState(), exportLap = validate(ctl.state.path, st.resolved.segments, { csp: true }).lap;
  const shown = summary(ctl.state).lap, result = ctl.state.result.lap;
  ctl.dispose();
  assert.deepEqual([proof(shown), proof(shown)], [proof(result), proof(exportLap)]);
});

test('a speed drag on a closed loop: the shown lap waits for the drag\'s end, then is the lap Export proves', async () => {
  const { shell, ctl } = await pieceLoop();
  const first = shell.getState().history.present.words[1];
  shell.beginDrag(); shell.dragTo(first.id, { speed: 90 });   // one word with a speed: the rest are proved at full throttle
  const during = summary(ctl.state).lap;
  shell.endDrag();
  const st = shell.getState(), exportLap = validate(ctl.state.path, st.resolved.segments, { csp: true }).lap;
  const after = summary(ctl.state).lap;
  ctl.dispose();
  assert.deepEqual([during.reason, proof(after)], ['deferred', proof(exportLap)]);
});

test('the lap\'s words say how it was proved only when they know: full throttle for the lap sim, nothing added otherwise', () => {
  assert.deepEqual(
    [lapText({ ok: true, speedFrom: 'lapsim' }), lapText({ ok: false, speedFrom: 'lapsim' }), lapText({ ok: true, speedFrom: 'design' }), lapText({ ok: false }), lapText({ ok: null, reason: 'open', speedFrom: 'lapsim' })],
    ['lap proved at full throttle', 'lap FAILS at full throttle', 'lap proved', 'lap FAILS', 'lap: the loop is still open'],
  );
});
