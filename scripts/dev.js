#!/usr/bin/env node
// dev.js: the app with LIVE RELOAD. Saving a file in app/, src/ or tools/ reloads the open window, about a second later.
//
//   npm run dev                  start `cargo tauri dev` (in src-tauri/) and keep its web folder in step with the sources
//   node scripts/dev.js --no-app keep the web folder in step only (when the app is started some other way)
//
// HOW. With no devUrl in tauri.conf.json, `cargo tauri dev` serves src-tauri/dist from its built-in dev server, which injects a
// reload script into every page and sends {"reload": true} when a file under dist changes (tauri-cli 2.12.1,
// src/dev/builtin_dev_server.rs; measured in the window, 2026-10-05). But dist is a COPY: src-tauri/build.rs makes it from app/,
// src/ and tools/ only when cargo builds, so an edit to the sources never reached the window until the next Rust build. This
// script mirrors each change into dist by build.rs's own rule (the three folders side by side, app/test left out), and the
// dev server does the rest. A Rust change still rebuilds and restarts the app, as `cargo tauri dev` always did.
//
// Development only: nothing here is in the installer, the export, or `cargo tauri build`. It writes only under src-tauri/dist,
// which build.rs rebuilds from scratch on every build, and which git ignores.
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const MIRRORED = Object.freeze(['app', 'src', 'tools']);   // src-tauri/build.rs copies these into dist/, side by side
const SKIPPED = Object.freeze(['app/test']);               // ... leaving tests out: they do not ship
const DEBOUNCE_MS = 50;                                     // one editor save is several events; Tauri's own debounce is 1 s

const posix = (rel) => rel.split(path.sep).join('/').replace(/\/+$/, '');

/** Where a source path (relative to the repo root) lives in src-tauri/dist, or null when build.rs does not copy it. */
function distPathOf(root, rel) {
  const r = posix(path.normalize(rel));
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  const top = r.split('/')[0];
  if (!MIRRORED.includes(top)) return null;
  if (SKIPPED.some((s) => r === s || r.startsWith(`${s}/`))) return null;
  return path.join(root, 'src-tauri', 'dist', ...r.split('/'));
}

/** Copy a folder as build.rs does: everything in it, recursively, except a SKIPPED folder (by its path from the root). */
function copyTree(root, rel, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const e of fs.readdirSync(path.join(root, rel), { withFileTypes: true })) {
    const childRel = `${rel}/${e.name}`, dst = path.join(to, e.name);
    if (SKIPPED.includes(childRel)) continue;
    if (e.isDirectory()) copyTree(root, childRel, dst);
    else fs.copyFileSync(path.join(root, rel, e.name), dst);
  }
}

/**
 * Bring one source path's copy in dist up to date: 'copied' (a file or a whole folder), 'removed' (the source is gone), or
 * 'skipped' (build.rs does not copy it). Throws when the disk refuses; the watcher reports that and carries on.
 */
function syncPath(root, rel) {
  const to = distPathOf(root, rel);
  if (!to) return 'skipped';
  const from = path.join(root, ...posix(rel).split('/'));
  let st = null;
  try { st = fs.statSync(from); } catch (e) { if (e.code !== 'ENOENT') throw e; }
  if (!st) { fs.rmSync(to, { recursive: true, force: true }); return 'removed'; }
  if (st.isDirectory()) copyTree(root, posix(rel), to);
  else { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(from, to); }
  return 'copied';
}

/**
 * Watch app/, src/ and tools/ and mirror every change into dist. onSync({ rel, action }) after each path; onError({ rel, error })
 * when a copy fails twice (a file still being written, say): it is reported, and the next save of that file tries again.
 * Returns { close() }.
 */
function watchMirror(root, { onSync = () => {}, onError = () => {} } = {}) {
  const pending = new Set();
  let timer = null;
  const flush = () => {
    timer = null;
    const batch = [...pending]; pending.clear();
    for (const rel of batch) {
      try { onSync({ rel, action: syncPath(root, rel) }); }
      catch {   // a file still being written: try once more, then report it
        setTimeout(() => { try { onSync({ rel, action: syncPath(root, rel) }); } catch (error) { onError({ rel, error }); } }, 150);
      }
    }
  };
  const watchers = MIRRORED.filter((d) => fs.existsSync(path.join(root, d))).map((d) => fs.watch(path.join(root, d), { recursive: true }, (_, file) => {
    if (!file) return;   // the platform did not say which file: nothing to mirror (a full copy happens on the next cargo build)
    const rel = `${d}/${posix(String(file))}`;
    if (!distPathOf(root, rel)) return;
    pending.add(rel);
    if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
  }));
  return { close() { for (const w of watchers) w.close(); if (timer) clearTimeout(timer); pending.clear(); } };
}

function main(argv) {
  const root = path.join(__dirname, '..');
  const mirror = watchMirror(root, {
    onSync: ({ rel, action }) => { if (action !== 'skipped') process.stdout.write(`[dev] ${action} ${rel}\n`); },
    onError: ({ rel, error }) => process.stderr.write(`[dev] could not mirror ${rel}: ${error.message} (save it again to retry)\n`),
  });
  process.stdout.write('[dev] mirroring app/, src/ and tools/ into src-tauri/dist: a saved file reloads the window\n');
  if (argv.includes('--no-app')) return;
  const app = spawn('cargo', ['tauri', 'dev'], { cwd: path.join(root, 'src-tauri'), stdio: 'inherit' });
  app.on('error', (e) => { mirror.close(); process.stderr.write(`[dev] could not start \`cargo tauri dev\`: ${e.message} (needs Rust and tauri-cli 2: cargo install tauri-cli)\n`); process.exit(1); });
  app.on('exit', (code) => { mirror.close(); process.exit(code === null ? 1 : code); });
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { distPathOf, syncPath, watchMirror, MIRRORED, SKIPPED };
