// THE RESTYLE (2026-10-05): dark fields instead of the browser's white boxes, labels the intent rows can read on one line, the main
// action of a section marked as primary, and a focus ring for the keyboard. The rules the layout tests pin stay as they are
// (app/test/layout-css.test.js: the base .picker row is 60px minmax(0, 1fr), and its field rule holds fields to their track).
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8').replace(/\r\n/g, '\n');
const block = (selRe) => { const m = html.match(new RegExp(`^\\s*${selRe}\\s*\\{([^}]*)\\}`, 'm')); assert.ok(m, `a rule for ${selRe}`); return m[1]; };

test('the value fields are dark like the rest of the page, not the browser\'s white boxes', () => {
  const r = block('input\\[type="number"\\],[^{]*');
  assert.deepEqual([/background:\s*var\(--bg\)/.test(r), /color:\s*var\(--text\)/.test(r), /border:[^;]*var\(--line\)/.test(r)], [true, true, true]);
});

test('the intent rows give their labels a wider column, and the base row keeps its pinned 60 px', () => {
  assert.match(block('\\.pickers\\[data-intent\\] \\.picker'), /grid-template-columns:\s*\d{2,3}px\s+minmax\(0,\s*1fr\)/);
  assert.match(block('\\.picker'), /grid-template-columns:\s*60px\s+minmax\(0,\s*1fr\)/);
});

test('a primary button stands out in the accent colour', () => {
  assert.match(block('button\\.primary'), /background:\s*var\(--accent\)/);
});

test('the left column scrolls with a dark scrollbar, not the browser\'s white one', () => {
  const m = html.match(/#left\s*\{[^}]*scrollbar-color:\s*var\(--line\)\s+var\(--panel\)/);
  assert.ok(m, 'a #left rule with scrollbar-color: var(--line) var(--panel)');
});

test('keyboard focus shows a ring on fields, buttons and section titles', () => {
  const m = html.match(/([^{}]*:focus-visible[^{]*)\{([^}]*)\}/);
  assert.ok(m && /input/.test(m[1]) && /button/.test(m[1]) && /summary/.test(m[1]) && /outline:/.test(m[2]), m ? m[0] : 'no :focus-visible rule');
});
