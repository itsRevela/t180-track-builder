// The live-reload mirror (scripts/dev.js): while `cargo tauri dev` runs, Tauri's built-in dev server serves src-tauri/dist and
// reloads the window when a file in it changes (measured 2026-10-05: the reload script is injected and {"reload": true} is sent);
// dist is a COPY that src-tauri/build.rs makes only when cargo builds, so the mirror keeps it up to date as app/, src/ and tools/
// are edited, by build.rs's own rule: those three folders, side by side, app/test left out.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { distPathOf, syncPath, watchMirror } = require('../scripts/dev.js');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
/** A throwaway repo: app/ (with app/test), src/, tools/, an unrelated docs/, and an empty src-tauri/dist. */
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-devsync-')); made.push(root);
  const put = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put('app/index.html', '<!doctype html>'); put('app/core/panel.js', 'panel v1'); put('app/test/a.test.js', 'a test');
  put('src/geom/path.js', 'path v1'); put('tools/kn5.cjs', 'kn5'); put('docs/notes.md', 'notes');
  fs.mkdirSync(path.join(root, 'src-tauri', 'dist'), { recursive: true });
  return { root, put, dist: (rel) => path.join(root, 'src-tauri', 'dist', ...rel.split('/')) };
}
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('a new or changed source file is copied into dist at the same path, byte for byte', () => {
  const r = repo();
  assert.equal(syncPath(r.root, 'app/core/panel.js'), 'copied');
  r.put('app/core/panel.js', 'panel v2');
  syncPath(r.root, 'app/core/panel.js');
  assert.equal(fs.readFileSync(r.dist('app/core/panel.js'), 'utf8'), 'panel v2');
});

test('a deleted source file or folder is removed from dist', () => {
  const r = repo();
  syncPath(r.root, 'src');
  fs.rmSync(path.join(r.root, 'src', 'geom'), { recursive: true });
  assert.deepEqual([syncPath(r.root, 'src/geom'), fs.existsSync(r.dist('src/geom'))], ['removed', false]);
});

test('app/test and anything outside app/, src/ and tools/ is never mirrored (build.rs leaves them out)', () => {
  const r = repo();
  assert.deepEqual(
    [distPathOf(r.root, 'app/test/a.test.js'), distPathOf(r.root, 'docs/notes.md'), distPathOf(r.root, 'package.json'), distPathOf(r.root, '../outside.js'), syncPath(r.root, 'app/test/a.test.js')],
    [null, null, null, null, 'skipped'],
  );
});

test('a whole folder is mirrored as build.rs lays it out: app without app/test, src and tools side by side', () => {
  const r = repo();
  for (const d of ['app', 'src', 'tools']) syncPath(r.root, d);
  const files = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
  assert.deepEqual(files(path.join(r.root, 'src-tauri', 'dist')), ['app/core/panel.js', 'app/index.html', 'src/geom/path.js', 'tools/kn5.cjs']);
});

test('the watcher mirrors an edit made while it runs, and stops when closed', async () => {
  const r = repo();
  const seen = [], w = watchMirror(r.root, { onSync: (e) => seen.push(e) });
  try {
    await new Promise((res) => setTimeout(res, 200));   // the OS watch is armed
    r.put('app/core/new-panel.js', 'new');
    assert.ok(await until(() => fs.existsSync(r.dist('app/core/new-panel.js'))), `not mirrored; syncs seen: ${JSON.stringify(seen)}`);
  } finally { w.close(); }
  r.put('tools/after-close.cjs', 'late');
  await new Promise((res) => setTimeout(res, 400));
  assert.equal(fs.existsSync(r.dist('tools/after-close.cjs')), false);
});
