#!/usr/bin/env node
// dev.js: the app with LIVE RELOAD. Saving a file in app/, src/ or tools/ reloads the open window, about a second later.
//
//   npm run dev                  fill the dev server's folder, start `cargo tauri dev` on it, and keep it in step with the sources
//   node scripts/dev.js --no-app keep the folder in step only (when the app is started some other way)
//
// HOW. With no devUrl in tauri.conf.json, `cargo tauri dev` serves a web folder (build.frontendDist) from its built-in dev server,
// which injects a reload script into every page and sends {"reload": true} when a file under the folder changes (tauri-cli 2.12.1,
// src/dev/builtin_dev_server.rs; measured in the window, 2026-10-05). This script gives that server a folder of its OWN,
// src-tauri/target/dev-web (git ignores target/), with `--config`, fills it before the app starts, and copies every change in
// app/, src/ and tools/ into it by src-tauri/build.rs's own rule (the three folders side by side, app/test left out).
//
// WHY NOT src-tauri/dist, build.rs's copy (both found in the window, 2026-10-05):
//   · the CLI starts its dev server only if the folder EXISTS when it starts (src/dev.rs: `if path.exists()`), and a fresh
//     checkout has no dist until build.rs makes it during the build, so the window loaded its built-in copy and never reloaded;
//   · build.rs deletes and remakes dist whenever app/, src/ or tools/ changed since the last build (that is, after any edit made
//     while the app was closed), and the dev server's watch on the deleted folder goes dead, so reloads silently stopped.
//
// A Rust change still rebuilds and restarts the app, as `cargo tauri dev` always did. Development only: nothing here is in the
// installer, the export, or `cargo tauri build`, and tauri.conf.json is not changed (`--config` merges for this run alone).
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');

const MIRRORED = Object.freeze(['app', 'src', 'tools']);   // src-tauri/build.rs copies these into dist/, side by side
const SKIPPED = Object.freeze(['app/test']);               // ... leaving tests out: they do not ship
const WEB = Object.freeze(['src-tauri', 'target', 'dev-web']);   // the dev server's own folder (git ignores src-tauri/target/)
const DEBOUNCE_MS = 50;                                     // one editor save is several events; Tauri's own debounce is 1 s

const posix = (rel) => rel.split(path.sep).join('/').replace(/\/+$/, '');

/** The dev server's folder for a repo. */
const webRoot = (root) => path.join(root, ...WEB);

/** Where a source path (relative to the repo root) lives in the dev folder, or null when build.rs does not copy it. */
function distPathOf(root, rel) {
  const r = posix(path.normalize(rel));
  if (!r || r.startsWith('..') || path.isAbsolute(r)) return null;
  const top = r.split('/')[0];
  if (!MIRRORED.includes(top)) return null;
  if (SKIPPED.some((s) => r === s || r.startsWith(`${s}/`))) return null;
  return path.join(webRoot(root), ...r.split('/'));
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

/** Make the dev folder from scratch, as build.rs makes dist: nothing stale survives a deleted file. */
function mirrorAll(root) {
  const web = webRoot(root);
  fs.rmSync(web, { recursive: true, force: true });
  fs.mkdirSync(web, { recursive: true });
  for (const d of MIRRORED) if (fs.existsSync(path.join(root, d))) copyTree(root, d, path.join(web, d));
}

/**
 * Bring one source path's copy in the dev folder up to date: 'copied' (a file or a whole folder), 'removed' (the source is gone),
 * or 'skipped' (build.rs does not copy it). Throws when the disk refuses; the watcher reports that and carries on.
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
 * Watch app/, src/ and tools/ and mirror every change into the dev folder. onSync({ rel, action }) after each path; onError({ rel,
 * error }) when a copy fails twice (a file still being written, say): it is reported, and the next save of that file tries again.
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
    if (!file) return;   // the platform did not say which file: nothing to mirror (the next start mirrors everything)
    const rel = `${d}/${posix(String(file))}`;
    if (!distPathOf(root, rel)) return;
    pending.add(rel);
    if (!timer) timer = setTimeout(flush, DEBOUNCE_MS);
  }));
  return { close() { for (const w of watchers) w.close(); if (timer) clearTimeout(timer); pending.clear(); } };
}

/**
 * `cargo tauri dev`, its built-in dev server pointed at the dev folder for this run alone (tauri.conf.json is untouched). The folder
 * goes RELATIVE to src-tauri (as tauri.conf.json's own "dist"): build.frontendDist is a URL or a folder, and an absolute Windows path,
 * C:\…, parses as a URL with the scheme "c", so the CLI started no dev server and the window found no page (seen: "asset not found").
 */
const tauriDevArgs = (root) => ['tauri', 'dev', '--config', JSON.stringify({ build: { frontendDist: path.relative(path.join(root, 'src-tauri'), webRoot(root)).split(path.sep).join('/') } })];

function main(argv) {
  const root = path.join(__dirname, '..');
  mirrorAll(root);   // before the app starts: the CLI serves the folder only if it exists then
  const mirror = watchMirror(root, {
    onSync: ({ rel, action }) => { if (action !== 'skipped') process.stdout.write(`[dev] ${action} ${rel}\n`); },
    onError: ({ rel, error }) => process.stderr.write(`[dev] could not mirror ${rel}: ${error.message} (save it again to retry)\n`),
  });
  process.stdout.write(`[dev] serving ${path.relative(root, webRoot(root))}, kept in step with app/, src/ and tools/: a saved file reloads the window\n`);
  if (argv.includes('--no-app')) return;
  const app = spawn('cargo', tauriDevArgs(root), { cwd: path.join(root, 'src-tauri'), stdio: 'inherit' });
  app.on('error', (e) => { mirror.close(); process.stderr.write(`[dev] could not start \`cargo tauri dev\`: ${e.message} (needs Rust and tauri-cli 2: cargo install tauri-cli)\n`); process.exit(1); });
  app.on('exit', (code) => { mirror.close(); process.exit(code === null ? 1 : code); });
}

if (require.main === module) main(process.argv.slice(2));

module.exports = { distPathOf, syncPath, mirrorAll, watchMirror, tauriDevArgs, webRoot, MIRRORED, SKIPPED };
