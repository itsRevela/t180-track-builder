// THE LEFT COLUMN BY TASK (app/core/panel.js, 2026-10-05): the equation panel's controls in foldable sections, Build, Sculpt, Check and
// Example, each remembering on this machine whether it was left open. Before, every control sat in one long column in one order.
// Mounted for real on the fake DOM the panel tests use, against the real shell.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCoreShell } = require('../core/coreshell.js');

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
function memStorage() { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; }
async function mountPanel(storage) {
  const doc = { ids: {}, listeners: {}, createElement: (t) => new El(t, doc) };
  doc.getElementById = (id) => doc.ids[id] || null;
  doc.addEventListener = (e, f) => { (doc.listeners[e] = doc.listeners[e] || []).push(f); };
  doc.removeEventListener = () => {};
  doc.dispatchEvent = () => true;
  const win = { CustomEvent: class { constructor(type, init = {}) { this.type = type; this.detail = init.detail; } }, Option: class { constructor(t, v) { this.textContent = t; this.value = v; } },
    requestAnimationFrame: () => 0, cancelAnimationFrame: () => {}, setTimeout: () => 0, clearTimeout: () => {} };
  if (storage === 'throws') Object.defineProperty(win, 'localStorage', { get() { throw new Error('SecurityError: storage is off'); } });
  else if (storage) win.localStorage = storage;
  doc.defaultView = win;
  const root = doc.createElement('div'), shell = await createCoreShell({ brushFn: null });
  require('../core/panel.js').mount(root, shell);
  const sections = () => root.all().filter((e) => e.tagName === 'DETAILS' && e.attrs['data-section']);
  const section = (k) => sections().find((d) => d.attrs['data-section'] === k);
  return { root, shell, sections, section };
}

test('the panel is grouped by task: Build, Sculpt, Check and Example, each a section that folds', async () => {
  const P = await mountPanel(memStorage());
  assert.deepEqual(P.sections().map((d) => [d.attrs['data-section'], d.children[0].tagName, d.children[0].textContent]),
    [['build', 'SUMMARY', 'Build'], ['sculpt', 'SUMMARY', 'Sculpt'], ['check', 'SUMMARY', 'Check'], ['example', 'SUMMARY', 'Example']]);
});

test('Build and Check start open; Sculpt and Example start folded', async () => {
  const P = await mountPanel(memStorage());
  assert.deepEqual(P.sections().map((d) => !!d.open), [true, false, true, false]);
});

test('a section remembers being opened or folded on this machine, across a restart', async () => {
  const store = memStorage(), first = await mountPanel(store);
  first.section('sculpt').open = true; first.section('sculpt').ontoggle();
  first.section('build').open = false; first.section('build').ontoggle();
  const again = await mountPanel(store);
  assert.deepEqual([again.section('sculpt').open, again.section('build').open], [true, false]);
});

test('storage that throws (a private window) costs only the memory of the folds: the panel mounts with its defaults', async () => {
  const P = await mountPanel('throws');
  assert.deepEqual(P.sections().map((d) => !!d.open), [true, false, true, false]);
  P.section('sculpt').open = true;
  assert.doesNotThrow(() => P.section('sculpt').ontoggle());
});

test('every control is still in the panel, in the section of its task', async () => {
  const P = await mountPanel(memStorage());
  const has = (k, pred) => P.section(k).all().some(pred);
  const button = (t) => (e) => e.tagName === 'BUTTON' && e.textContent === t;
  assert.deepEqual(
    [has('build', button('Add turn')), has('build', button('Extend')), has('sculpt', (e) => e.attrs['aria-label'] === 'brush on'), has('check', button('Close the loop')), has('check', (e) => e.attrs['aria-label'] === 'water on'), has('example', button('Open example'))],
    [true, true, true, true, true, true],
  );
});

test('the panel\'s messages sit at the top, under the track\'s summary, where an action\'s refusal is seen', async () => {
  const P = await mountPanel(memStorage());
  const kids = P.root.children, msg = kids.findIndex((e) => e.tagName === 'P' && e.attrs.class && e.attrs.class.startsWith('message')), firstSection = kids.findIndex((e) => e.tagName === 'DETAILS');
  assert.ok(msg >= 0 && msg < firstSection, `message at ${msg}, first section at ${firstSection}`);
});
