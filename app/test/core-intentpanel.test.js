// The INTENT tabs in the equation core's panel (app/core/intentpanel.js, mounted by app/core/panel.js): what a user sees and does.
// The panel is mounted for real on a small fake DOM (the one app/test/core-readout-display.test.js uses), against the real shell.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');

// ── a small fake DOM: enough for the panel (app/test/core-readout-display.test.js has the same) ──
class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c.textContent !== undefined ? c.textContent : '')).join(''); }
  addEventListener(e, f) { (this.listeners[e] = this.listeners[e] || []).push(f); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 0, height: 0 }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc), sent: [] };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { doc.sent.push(ev.type); for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  doc.defaultView = win;
  return { doc, win };
}
async function mountPanel() {
  const { doc } = fakeWindow();
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  require('../core/panel.js').mount(root, shell);
  const all = () => root.all();
  const button = (text) => all().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  const tab = (k) => all().find((e) => e.attrs['data-intent-tab'] === k);
  const group = (k) => all().find((e) => e.attrs['data-intent'] === k);
  const fieldIn = (k, label) => group(k).children.find((l) => l.children[0] && l.children[0].textContent === label).children[1];
  const type = (k, label, v) => { const f = fieldIn(k, label); if (typeof v === 'boolean') f.checked = v; else f.value = String(v); f.oninput(); };
  const readout = () => all().find((e) => e.attrs['data-intent-readout'] !== undefined).textContent;
  return { doc, root, shell, button, tab, group, type, readout };
}

test('the panel offers four intents, Turn first, and shows only the chosen one\'s fields', async () => {
  const P = await mountPanel();
  const shown = () => ['straight', 'turn', 'climb', 'bank'].filter((k) => P.group(k).style.display !== 'none');
  const before = shown();
  P.tab('climb').onclick();
  assert.deepEqual([before, shown(), P.tab('climb').attrs['aria-pressed'], P.tab('turn').attrs['aria-pressed'], !!P.button('Add climb')], [['turn'], ['climb'], 'true', 'false', true]);
});

test('the readout follows the fields as they are typed, before anything is added', async () => {
  const P = await mountPanel();
  P.type('turn', 'Angle (°)', 45);
  const a = P.readout();
  P.type('turn', 'Angle (°)', 120);
  assert.deepEqual([/\+45° heading/.test(a), /\+120° heading/.test(P.readout())], [true, true]);
});

test('Add places the intent as one undo step, and the readout says when a climb is too sharp for full throttle', async () => {
  const P = await mountPanel();
  P.tab('straight').onclick(); P.button('Add straight').onclick();
  P.tab('turn').onclick(); P.type('turn', 'Angle (°)', 90); P.type('turn', 'Radius (m)', 200);
  const one = P.shell.getState().history.present.pieces.length;
  P.button('Add turn').onclick();
  const three = P.shell.getState().history.present.pieces.length;
  P.shell.undo();
  P.tab('climb').onclick(); P.type('climb', 'Rise (m, − = down)', 10); P.type('climb', 'Over (m)', 400);
  assert.deepEqual([one, three - one, P.shell.getState().history.present.pieces.length, /leaves the road over the crest/.test(P.readout())], [1, 3, 1, true]);
});

test('an intent that cannot be built says why in the readout, and Add then leaves the track as it was', async () => {
  const P = await mountPanel();
  P.tab('straight').onclick(); P.button('Add straight').onclick();
  P.tab('turn').onclick(); P.type('turn', 'Angle (°)', 5); P.type('turn', 'Radius (m)', 100); P.type('turn', 'Blend (m)', 40);
  const before = P.shell.getState().history.present;
  P.button('Add turn').onclick();
  assert.deepEqual([/smaller than its blends/.test(P.readout()), P.shell.getState().history.present === before, /smaller than its blends/.test(P.shell.getState().message || '')], [true, true, true]);
});

test('the Jump tab: its readout says whether 460 km/h clears it, Add places the flight, and a jump straight after a jump is refused with the reason', async () => {
  const P = await mountPanel();
  P.tab('straight').onclick(); P.button('Add straight').onclick();
  P.tab('jump').onclick();
  const clears = P.readout();
  P.button('Add jump').onclick();
  const last = P.shell.getState().history.present.pieces.slice(-1)[0];
  P.type('jump', 'Gap (m)', 82);   // any change re-reads: now the open end is the jump itself
  assert.deepEqual([clears.includes('clears at 460 km/h'), last.type, /road to take off/.test(P.readout())], [true, 'flight', true]);
});

test('on a closed loop Add is off and the readout says why; the channel Extend under Custom is still there', async () => {
  const P = await mountPanel();
  assert.ok(P.button('Extend'), 'the channel Extend is still in the panel (under Custom)');
  P.shell.extendIntent({ kind: 'straight', length: 400, blend: 20 });
  for (let i = 0; i < 2; i++) { P.shell.extendIntent({ kind: 'turn', dir: 'left', angle: 180, radius: 150, bank: 0, blend: 20, endStraight: true }); P.shell.extendIntent({ kind: 'straight', length: 400, blend: 20 }); }
  P.shell.close();
  assert.ok(P.shell.getState().history.present.closed, P.shell.getState().message);
  assert.deepEqual([P.button('Add turn').disabled, /loop is closed/.test(P.readout())], [true, true]);
});
