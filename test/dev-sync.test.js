// The live-reload mirror (scripts/dev.js). `cargo tauri dev` serves a web folder from its built-in dev server and reloads the
// window when a file in it changes (tauri-cli 2.12.1, src/dev/builtin_dev_server.rs). The folder is the dev server's OWN,
// src-tauri/target/dev-web, given to it with `--config`, and never src-tauri/dist (found in the window, 2026-10-05):
//   · the CLI starts its dev server only if the folder EXISTS when it starts (src/dev.rs: `if path.exists()`), and a fresh
//     checkout has no dist until build.rs makes it, so the window loaded its built-in copy and nothing ever reloaded;
//   · build.rs deletes and remakes dist whenever app/, src/ or tools/ changed since the last build, and a watch on a deleted
//     folder goes dead, so after any edit made with the app closed, reloads silently stopped.
// The mirror fills dev-web by build.rs's own rule (app/, src/ and tools/ side by side, app/test left out) before the app starts,
// then copies each change into it.
'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs'), os = require('os'), path = require('path');
const { distPathOf, syncPath, mirrorAll, watchMirror, tauriDevArgs, webRoot } = require('../scripts/dev.js');

const made = [];
test.after(() => { for (const d of made) fs.rmSync(d, { recursive: true, force: true }); });
/** A throwaway repo: app/ (with app/test), src/, tools/, an unrelated docs/, and build.rs's src-tauri/dist. */
function repo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 't180b-devsync-')); made.push(root);
  const put = (rel, text) => { const p = path.join(root, rel); fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, text); };
  put('app/index.html', '<!doctype html>'); put('app/core/panel.js', 'panel v1'); put('app/test/a.test.js', 'a test');
  put('src/geom/path.js', 'path v1'); put('tools/kn5.cjs', 'kn5'); put('docs/notes.md', 'notes'); put('src-tauri/dist/app/index.html', 'build.rs copy');
  return { root, put, web: (rel) => path.join(webRoot(root), ...rel.split('/')) };
}
const files = (dir) => fs.readdirSync(dir, { recursive: true }).map((f) => f.split(path.sep).join('/')).filter((f) => fs.statSync(path.join(dir, f)).isFile()).sort();
const until = async (fn, ms = 4000) => { const end = Date.now() + ms; while (Date.now() < end) { if (fn()) return true; await new Promise((r) => setTimeout(r, 50)); } return false; };

test('the dev server gets its own folder, never build.rs\'s dist, and `cargo tauri dev` is pointed at it', () => {
  const r = repo(), args = tauriDevArgs(r.root), config = JSON.parse(args[args.indexOf('--config') + 1]);
  const dist = path.join(r.root, 'src-tauri', 'dist'), served = path.resolve(r.root, 'src-tauri', config.build.frontendDist);
  assert.deepEqual([args.slice(0, 2), served, webRoot(r.root).startsWith(dist)], [['tauri', 'dev'], webRoot(r.root), false]);
});

test('the folder reaches Tauri as a path relative to src-tauri, never one that reads as a URL (found in the window: "asset not found")', () => {
  // Tauri's build.frontendDist is a URL OR a folder, and an absolute Windows path, C:\…, parses as a URL whose scheme is "c":
  // the CLI then starts no dev server and the window asks its built-in assets for a page that is not there
  const args = tauriDevArgs(repo().root), value = JSON.parse(args[args.indexOf('--config') + 1]).build.frontendDist;
  assert.deepEqual([value, /^[A-Za-z][A-Za-z0-9+.-]*:/.test(value)], ['target/dev-web', false]);
});

test('a full mirror makes the dev folder from nothing, laid out as build.rs lays out dist (a fresh checkout has neither)', () => {
  const r = repo();
  mirrorAll(r.root);
  assert.deepEqual(files(webRoot(r.root)), ['app/core/panel.js', 'app/index.html', 'src/geom/path.js', 'tools/kn5.cjs']);
});

test('a full mirror leaves nothing stale behind, and never touches build.rs\'s dist', () => {
  const r = repo();
  mirrorAll(r.root);
  fs.rmSync(path.join(r.root, 'src', 'geom'), { recursive: true });
  mirrorAll(r.root);
  assert.deepEqual([fs.existsSync(r.web('src/geom/path.js')), fs.readFileSync(path.join(r.root, 'src-tauri', 'dist', 'app', 'index.html'), 'utf8')], [false, 'build.rs copy']);
});

test('a new or changed source file is copied into the dev folder at the same path, byte for byte', () => {
  const r = repo();
  assert.equal(syncPath(r.root, 'app/core/panel.js'), 'copied');
  r.put('app/core/panel.js', 'panel v2');
  syncPath(r.root, 'app/core/panel.js');
  assert.equal(fs.readFileSync(r.web('app/core/panel.js'), 'utf8'), 'panel v2');
});

test('a deleted source file or folder is removed from the dev folder', () => {
  const r = repo();
  syncPath(r.root, 'src');
  fs.rmSync(path.join(r.root, 'src', 'geom'), { recursive: true });
  assert.deepEqual([syncPath(r.root, 'src/geom'), fs.existsSync(r.web('src/geom'))], ['removed', false]);
});

test('app/test and anything outside app/, src/ and tools/ is never mirrored (build.rs leaves them out)', () => {
  const r = repo();
  assert.deepEqual(
    [distPathOf(r.root, 'app/test/a.test.js'), distPathOf(r.root, 'docs/notes.md'), distPathOf(r.root, 'package.json'), distPathOf(r.root, '../outside.js'), syncPath(r.root, 'app/test/a.test.js')],
    [null, null, null, null, 'skipped'],
  );
});

test('the watcher mirrors an edit made while it runs, and stops when closed', async () => {
  const r = repo();
  mirrorAll(r.root);
  const seen = [], w = watchMirror(r.root, { onSync: (e) => seen.push(e) });
  try {
    await new Promise((res) => setTimeout(res, 200));   // the OS watch is armed
    r.put('app/core/new-panel.js', 'new');
    assert.ok(await until(() => fs.existsSync(r.web('app/core/new-panel.js'))), `not mirrored; syncs seen: ${JSON.stringify(seen)}`);
  } finally { w.close(); }
  r.put('tools/after-close.cjs', 'late');
  await new Promise((res) => setTimeout(res, 400));
  assert.equal(fs.existsSync(r.web('tools/after-close.cjs')), false);
});
