// EDIT A STRETCH in the equation core's panel (app/core/sectionpanel.js, mounted by app/core/panel.js, 2026-10-05): what a user sees
// and does. The panel is mounted for real on the small fake DOM of app/test/core-intentpanel.test.js, against the real shell; its
// setTimeout runs at once, so a preview the panel schedules has run when the test reads the state.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');
const D = require('../../src/core/document.js');

class El {
  constructor(tag, doc) { this.tagName = tag.toUpperCase(); this.ownerDocument = doc; this.children = []; this.attrs = {}; this.style = {}; this._text = ''; this.listeners = {}; this.value = ''; this.checked = false; this.parent = null; }
  append(...k) { for (const c of k) { if (c == null) continue; const n = typeof c === 'string' ? Object.assign(new El('#text', this.ownerDocument), { _text: c }) : c; n.parent = this; this.children.push(n); } }
  replaceChildren(...k) { for (const c of this.children) c.parent = null; this.children = []; this.append(...k); }
  remove() { if (this.parent) { this.parent.children = this.parent.children.filter((c) => c !== this); this.parent = null; } }
  setAttribute(k, v) { this.attrs[k] = String(v); if (k === 'id') this.ownerDocument.ids[v] = this; }
  getAttribute(k) { return this.attrs[k]; }
  set textContent(t) { this._text = String(t); this.children = []; }
  get textContent() { return this._text + this.children.map((c) => (c.textContent !== undefined ? c.textContent : '')).join(''); }
  addEventListener(e, f, capture) { (this.listeners[e] = this.listeners[e] || []).push({ f, capture: !!capture }); }
  removeEventListener(e, f) { this.listeners[e] = (this.listeners[e] || []).filter((x) => x.f !== f); }
  getBoundingClientRect() { return { left: 0, top: 0, width: 800, height: 600 }; }
  get isConnected() { let e = this; while (e.parent) e = e.parent; return !!e.isRoot; }
  get offsetWidth() { return 0; }
  get offsetHeight() { return 0; }
  all() { return [this, ...this.children.flatMap((c) => (c.all ? c.all() : []))]; }
  /** a pointer event on this element: capture listeners first (as at the target since Chrome 89), and stopImmediatePropagation honoured */
  fire(type, props = {}) {
    let stopped = false; const ev = { type, button: 0, clientX: 10, clientY: 10, pointerId: 1, preventDefault() {}, stopPropagation() { stopped = true; }, stopImmediatePropagation() { stopped = true; }, ...props };
    const ls = (this.listeners[type] || []).slice().sort((a, b) => b.capture - a.capture);
    for (const l of ls) { if (stopped) break; l.f(ev); }
  }
}
function fakeWindow() {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc), sent: [] };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = (e, f) => { doc.listeners[e] = (doc.listeners[e] || []).filter((x) => x !== f); };
  doc.dispatchEvent = (ev) => { doc.sent.push({ type: ev.type, detail: ev.detail }); for (const f of (doc.listeners[ev.type] || []).slice()) f(ev); return true; };
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; this.disabled = false; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: (f) => { f(); return 0; }, clearTimeout: () => {} };
  doc.defaultView = win;
  return { doc, win };
}
const DEG = Math.PI / 180;
async function mountPanel() {
  const { doc } = fakeWindow();
  const stage = doc.createElement('div'); stage.setAttribute('id', 'preview');
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  shell.extend({ length: 600 }); shell.extend({ length: 600, targets: { kh: 1 / 500 } }); shell.extend({ length: 600, targets: { kh: 0 } });
  require('../core/panel.js').mount(root, shell);
  const all = () => root.all();
  const box = () => all().find((e) => e.attrs['data-section'] === 'stretch');
  const inBox = () => box().all();
  const button = (text) => inBox().find((e) => e.tagName === 'BUTTON' && e.textContent === text);
  // a field by its label (the value's label carries its unit: "Value (°)", matched as "Value")
  const fieldOf = (label) => inBox().find((l) => l.tagName === 'LABEL' && l.children[0] && (l.children[0].textContent === label || l.children[0].textContent.startsWith(label + ' ('))).children[1];
  const set = (label, v) => { const f = fieldOf(label); f.value = String(v); f.onchange(); };
  const text = (attr) => inBox().find((e) => e.attrs[attr] !== undefined).textContent;
  const bands = () => doc.sent.filter((e) => e.type === 't180-section').map((e) => e.detail);
  return { doc, stage, root, shell, box, button, fieldOf, set, text, bands };
}

test('the panel has an "Edit a stretch" section whose turn list is the track\'s turns', async () => {
  const P = await mountPanel(), opts = P.fieldOf('Turn').children.map((o) => o.textContent);
  assert.deepEqual([!!P.box(), opts.length, /^Turn 1 · left/.test(opts[1])], [true, 2, true], JSON.stringify(opts));
});

test('picking a turn fills the stretch\'s ends and shows the stretch and its ramps on the track', async () => {
  const P = await mountPanel(), t = P.shell.turns()[0];
  P.set('Turn', '1');
  const band = P.bands().pop();
  assert.deepEqual([Number(P.fieldOf('From (m)').value), Number(P.fieldOf('To (m)').value), band.from, band.to, band.rampIn > 0, band.rampOut > 0], [Math.round(t.from), Math.round(t.to), Math.round(t.from), Math.round(t.to), true, true]);
});

test('a bank typed in degrees previews the turn banked at that angle; Apply keeps it as one undo step', async () => {
  const P = await mountPanel(), before = D.serialize(P.shell.getState().history.present);
  P.set('Turn', '1'); P.set('Change', 'phi'); P.set('How', 'set'); P.set('Value', 20);
  const previewing = P.shell.getState().section, mid = (previewing.params.from + previewing.params.to) / 2;
  const bank = P.shell.getState().history.present.pieces[1] && D.channelAt(P.shell.getState().history.present.pieces[1], 'phi', mid - 600).v;
  P.button('Apply').onclick();
  const applied = P.shell.getState(); P.shell.undo();
  assert.deepEqual([previewing.params.channel, Math.abs(previewing.params.value - 20 * DEG) < 1e-12, Math.abs(bank - 20 * DEG) < 1e-6, applied.section, D.serialize(P.shell.getState().history.present) === before], ['phi', true, true, null, true]);
});

test('Cancel puts the track back as it was', async () => {
  const P = await mountPanel(), before = D.serialize(P.shell.getState().history.present);
  P.set('From (m)', 300); P.set('To (m)', 500); P.set('Change', 'w'); P.set('How', 'add'); P.set('Value', 4);
  const opened = !!P.shell.getState().section;
  P.button('Cancel').onclick();
  assert.deepEqual([opened, P.shell.getState().section, D.serialize(P.shell.getState().history.present) === before], [true, null, true]);
});

test('"Pick on road" takes the next click on the track as the stretch\'s end, and that click is not a brush stroke or a camera drag', async () => {
  const P = await mountPanel(), seen = [];
  P.doc.addEventListener('t180-pick', (e) => e.detail.reply({ s: 432.4 }));
  P.stage.addEventListener('pointerdown', () => seen.push('other'));   // the brush and the camera listen on the stage too
  P.button('Pick start on road').onclick(); P.stage.fire('pointerdown');
  assert.deepEqual([P.fieldOf('From (m)').value, seen], ['432', []]);
});

test('the readout says what the stretch is now, in the user\'s units', async () => {
  const P = await mountPanel();
  P.set('From (m)', 100); P.set('To (m)', 400); P.set('Change', 'w');
  const w = P.shell.getState().history.present.pieces[0].channels.w[0];
  assert.match(P.text('data-section-now'), new RegExp(`now ${w.toFixed(1)} m`));
});

test('a stretch the core refuses says why next to the fields, and nothing is previewed', async () => {
  const P = await mountPanel();
  P.set('From (m)', 300); P.set('To (m)', 500); P.set('Ramp in (m)', 3); P.set('Change', 'w'); P.set('How', 'add'); P.set('Value', 4);
  assert.deepEqual([P.shell.getState().section, /ramp/.test(P.text('data-section-status'))], [null, true], P.text('data-section-status'));
});

test('a preview still waiting to run when the user presses Cancel or Clear does not run afterwards', async () => {
  const P = await mountPanel(), timers = [];
  P.doc.defaultView.setTimeout = (f) => { timers.push(f); return timers.length; };   // hold the scheduled preview
  P.set('From (m)', 300); P.set('To (m)', 500); P.set('Change', 'w'); P.set('How', 'add'); P.set('Value', 4);
  P.button('Clear').onclick();
  for (const f of timers.splice(0)) f();
  const afterClear = P.shell.getState().section;
  P.set('From (m)', 300); P.set('To (m)', 500); P.set('Value', 4);
  P.button('Cancel').onclick();
  for (const f of timers.splice(0)) f();
  assert.deepEqual([afterClear, P.shell.getState().section], [null, null]);
});

// ── the code review's findings (2026-10-05) ──
test('a brush drag does not rebuild the turn list on every tick (it cost a third more per tick)', async () => {
  const P = await mountPanel(); let calls = 0; const turns = P.shell.turns; P.shell.turns = () => { calls++; return turns(); };
  P.shell.beginBrush({ mode: 'rate', channel: 'phi', s0: 300, r: 60 }); P.shell.brushTo(0.01); P.shell.brushTo(0.02);
  const during = calls; P.shell.endBrush();
  assert.equal(during, 0);
});

test('"Pick on road" is let go by Clear, by a second click on it, and by Escape: the next click on the track is the camera\'s again', async () => {
  const P = await mountPanel(), seen = [];
  P.doc.addEventListener('t180-pick', (e) => e.detail.reply({ s: 400 }));
  P.stage.addEventListener('pointerdown', () => seen.push('camera'));
  P.button('Pick start on road').onclick(); P.button('Clear').onclick(); P.stage.fire('pointerdown');
  P.button('Pick start on road').onclick(); P.button('Pick start on road').onclick(); P.stage.fire('pointerdown');
  P.button('Pick end on road').onclick(); for (const f of P.doc.listeners.keydown || []) f({ key: 'Escape' }); P.stage.fire('pointerdown');
  assert.deepEqual([seen.length, P.fieldOf('From (m)').value, P.fieldOf('To (m)').value], [3, '', '']);
});

test('a stretch whose end is before its start says so', async () => {
  const P = await mountPanel();
  P.set('From (m)', 500); P.set('To (m)', 300);
  assert.match(P.text('data-section-status'), /end after it starts/);
});

test('a refused preview closes the one before it, so Apply cannot keep an edit the fields no longer say', async () => {
  const P = await mountPanel(), before = D.serialize(P.shell.getState().history.present);
  P.set('From (m)', 300); P.set('To (m)', 500); P.set('Change', 'w'); P.set('How', 'add'); P.set('Value', 4);
  const opened = !!P.shell.getState().section;
  P.set('Value', -40);   // a width below 0: refused
  assert.deepEqual([opened, P.shell.getState().section, D.serialize(P.shell.getState().history.present) === before, P.button('Apply').disabled, /width/.test(P.text('data-section-status'))], [true, null, true, true, true]);
});

test('switching what to change clears the value and closes the open preview (bank 20° does not become width 20 m)', async () => {
  const P = await mountPanel();
  P.set('From (m)', 300); P.set('To (m)', 500); P.set('Change', 'phi'); P.set('How', 'set'); P.set('Value', 20);
  const opened = !!P.shell.getState().section;
  P.set('Change', 'w');
  assert.deepEqual([opened, P.shell.getState().section, P.fieldOf('Value').value], [true, null, '']);
});

test('the camera goes to the stretch when it is picked from the turn list or by "Show on track", not on every typed end', async () => {
  const P = await mountPanel();
  P.set('From (m)', 300); P.set('To (m)', 500); const typed = P.bands().pop();
  P.set('Turn', '1'); const picked = P.bands().pop();
  P.button('Show on track').onclick(); const shown = P.bands().pop();
  assert.deepEqual([!!typed.frame, picked.frame, shown.frame], [false, true, true]);
});
