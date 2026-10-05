// sectionpanel.js: EDIT A STRETCH, the panel for the section edit (2026-10-05), mounted by app/core/panel.js like the intent tabs.
// The user's ask: "edit a specific turn of the already created track by tuning the bank of the turn", "edit the width of a specific
// section (and have the width adjust gradually and be able to define how gradual it is)".
//
// The stretch is picked from the track's turns (app/core/turns.js), by clicking the road ("Pick start/end on road": the next click on
// the preview, taken before the brush or the camera see it; a second click on the button, Escape, Apply, Cancel or Clear let it go), or
// typed in metres. A stretch picked from the list, or "Show on track", puts the camera on it. What changes (bank, width, height, cup), how
// (SET to a value or CHANGE BY an amount) and the ramps (in and out, each its own length, smooth or linear) are fields. A committed field
// (Enter, leaving it, a pick) previews the edit through the shell (app/core/coreshell.js previewSection): the track, the validation and
// the lap proof show it as it would be; Apply keeps it as one undo step, Cancel puts the track back. A refused preview closes the one
// before it (Apply never keeps an edit the fields no longer say), and switching what to change clears the value. A preview of a long
// track takes a second or two, so the status says "previewing…" first and the work runs after the browser has painted it.
//
//   create({ el, field, num, send, shell, win, stage }) -> { box, refresh(st), unmount() }
//   sends 't180-section' { from, to, rampIn, rampOut, frame? } | null: the stretch and its ramps, for the preview to draw on the road
//   (frame: true asks the preview to put the camera on it)
'use strict';
const DEG = Math.PI / 180;
// what the panel offers, in the user's units: the document's channel, the unit shown, and the conversion to and from the document
const PROPS = Object.freeze({
  phi: { label: 'Bank', unit: '°', toDoc: (v) => v * DEG, fromDoc: (v) => v / DEG, step: 1, sign: '+ = left side up' },
  w: { label: 'Width', unit: 'm', toDoc: (v) => v, fromDoc: (v) => v, step: 0.5 },
  h: { label: 'Height', unit: 'm', toDoc: (v) => v, fromDoc: (v) => v, step: 0.5 },
  c: { label: 'Cup', unit: '°', toDoc: (v) => v, fromDoc: (v) => v, step: 1 },
});
const RAMP_DEFAULT_M = 60, PREVIEW_DELAY_MS = 30;
const numberOf = (input) => (input.value === '' || input.value == null ? NaN : Number(input.value));
/** The preview on the track is the one these params asked for (the shell keeps its own frozen copy). */
const sameParams = (a, b) => !!a && !!b && Object.keys(b).every((k) => a[k] === b[k]);

function create({ el, field, num, send, shell, win, stage }) {
  const doc = stage ? stage.ownerDocument : null;   // for Escape while a pick is armed
  const select = (label, options) => { const s = el('select', { 'aria-label': label }); s.replaceChildren(...options.map(([v, t]) => new win.Option(t, v))); s.value = options[0][0]; return s; };
  const turn = el('select', { 'aria-label': 'pick a turn' });
  const from = num('', 1, 'where the stretch starts, in metres along the track'), to = num('', 1, 'where the stretch ends, in metres along the track');
  const prop = select('what to change', Object.entries(PROPS).map(([k, p]) => [k, `${p.label} (${p.unit})`]));
  const how = select('set to or change by', [['set', 'Set to'], ['add', 'Change by']]);
  const value = num('', PROPS.phi.step, 'Set to: the value the whole stretch takes. Change by: the amount added to it (− to lower)'), unit = el('span', { text: `Value (${PROPS.phi.unit})` });
  const rampIn = num(RAMP_DEFAULT_M, 5, 'metres before the stretch over which the change grows in'), rampOut = num(RAMP_DEFAULT_M, 5, 'metres after the stretch over which it fades out');
  const shape = select('ramp shape', [['smooth', 'Smooth (S-curve)'], ['linear', 'Linear']]);
  const now = el('p', { class: 'src', 'data-section-now': '' }), status = el('p', { class: 'message', role: 'status', 'data-section-status': '' });
  let armed = null;                        // 'from' | 'to': the next click on the road sets that end
  let pending = null, scheduled = false;   // the preview waiting to run (Apply, Cancel, Clear and unmount drop it, so it never runs after them)
  const pickFrom = el('button', { text: 'Pick start on road', title: 'then click the road where the stretch starts (Escape or a second click: never mind)', onclick: () => arm('from') });
  const pickTo = el('button', { text: 'Pick end on road', title: 'then click the road where the stretch ends (Escape or a second click: never mind)', onclick: () => arm('to') });
  const show = el('button', { text: 'Show on track', title: 'put the camera on the stretch', onclick: () => { const s = stretch(); if (s) send('t180-section', { ...s, frame: true }); } });
  /** Drop what is waiting: a scheduled preview and an armed pick. */
  const settle = () => { pending = null; disarm(); };
  const apply = el('button', { text: 'Apply', class: 'primary', title: 'keep the previewed edit (one undo step)', onclick: () => { settle(); shell.applySection(); say(''); } });
  const cancel = el('button', { text: 'Cancel', title: 'put the track back as it was before the preview', onclick: () => { settle(); shell.cancelSection(); say(''); } });
  const clear = el('button', { text: 'Clear', title: 'forget the stretch (an open preview is cancelled)', onclick: () => { settle(); if (shell.getState().section) shell.cancelSection(); from.value = ''; to.value = ''; value.value = ''; turn.value = ''; say(''); update(false); } });

  const say = (text, kind = 'ok') => { status.textContent = text; status.className = kind === 'ok' ? 'message ok' : 'message'; };
  const stretch = () => {
    const a = numberOf(from), b = numberOf(to), i = numberOf(rampIn), o = numberOf(rampOut);
    return [a, b, i, o].every(Number.isFinite) && b > a ? { from: a, to: b, rampIn: i, rampOut: o } : null;
  };
  const params = () => {
    const s = stretch(), v = numberOf(value), P = PROPS[prop.value];
    return s && Number.isFinite(v) ? { channel: prop.value, ...s, shape: shape.value, op: how.value, value: P.toDoc(v) } : null;
  };
  /** What the stretch is now (before an open edit), in the user's units. */
  const showNow = () => {
    const s = stretch(), P = PROPS[prop.value]; unit.textContent = `Value (${P.unit})`;
    const r = s && shell.sectionRange(prop.value, s.from, s.to);
    if (!r) { now.textContent = ''; return; }
    const lo = P.fromDoc(r.min).toFixed(1), hi = P.fromDoc(r.max).toFixed(1);
    now.textContent = `${P.label} over the stretch: now ${lo === hi ? lo : `${lo} to ${hi}`} ${P.unit}${P.sign ? ` (${P.sign})` : ''}`;
  };
  const run = () => {
    scheduled = false; const p = pending; pending = null; if (!p) return;
    const done = shell.previewSection(p), st = shell.getState();   // null: the core refused it (the shell's message says why)
    if (done && st.section && sameParams(st.section.params, p)) { say(st.message ? `Preview: ${st.message}` : 'Preview shown: check the track and the lap, then Apply or Cancel.'); return; }
    // refused: an older preview is still on the track, but the fields no longer say it, so it is closed (Apply cannot keep it)
    const why = st.message || 'not previewed';
    if (st.section) shell.cancelSection();
    say(why, 'error');
  };
  /** The stretch shown on the road, the readout, and (when there is a value) a preview after the status has painted. */
  const update = (preview = true, frame = false) => {
    const s = stretch(); send('t180-section', s && frame ? { ...s, frame: true } : s);
    showNow();
    const a = numberOf(from), b = numberOf(to);
    if (Number.isFinite(a) && Number.isFinite(b) && !(b > a)) { pending = null; say(`the stretch must end after it starts (from ${a} m, to ${b} m)`, 'error'); return; }
    const p = preview ? params() : null;
    if (!p) { pending = null; return; }
    pending = p; say('previewing…');
    if (!scheduled) { scheduled = true; win.setTimeout(run, PREVIEW_DELAY_MS); }
  };
  for (const f of [from, to, value, rampIn, rampOut, how, shape]) f.onchange = () => { if (f === from || f === to) turn.value = ''; update(); };
  // a new thing to change: the old number meant something else (bank 20° is not width 20 m), so it is cleared and an open preview closed
  prop.onchange = () => { pending = null; if (shell.getState().section) shell.cancelSection(); value.value = ''; value.step = String(PROPS[prop.value].step); say(''); update(false); };
  turn.onchange = () => {
    const t = shell.turns().find((x) => String(x.n) === turn.value);
    if (!t) return;
    from.value = String(Math.round(t.from)); to.value = String(Math.round(t.to)); update(true, true);
  };

  // PICKING ON THE ROAD: the next click on the preview, in the CAPTURE phase so the brush and the camera never see it
  function disarm() { armed = null; pickFrom.setAttribute('aria-pressed', 'false'); pickTo.setAttribute('aria-pressed', 'false'); }
  function arm(end) {
    if (armed === end) { disarm(); say(''); return; }   // a second click: never mind
    disarm(); armed = end; (end === 'from' ? pickFrom : pickTo).setAttribute('aria-pressed', 'true');
    say(`click the road where the stretch ${end === 'from' ? 'starts' : 'ends'} (Escape: never mind)`);
  }
  const onKey = (e) => { if (armed && e.key === 'Escape') { disarm(); say(''); } };
  const onPick = (e) => {
    if (!armed || e.button !== 0) return;
    e.stopImmediatePropagation(); e.preventDefault();
    const r = stage.getBoundingClientRect(); let hit = null;
    send('t180-pick', { x: e.clientX - r.left, y: e.clientY - r.top, reply: (h) => { hit = h; } });
    if (!hit) { say('no road under the pointer: click on the road (Escape: never mind)', 'error'); return; }
    const end = armed; disarm();
    (end === 'from' ? from : to).value = String(Math.round(hit.s)); turn.value = ''; say(''); update();
  };
  if (stage) stage.addEventListener('pointerdown', onPick, true);
  if (doc) doc.addEventListener('keydown', onKey);

  const box = el('div', { class: 'section-edit' },
    el('div', { class: 'pickers' }, field('Turn', turn), field('From (m)', from), field('To (m)', to)),
    el('div', { class: 'actions' }, pickFrom, pickTo, show),
    el('div', { class: 'pickers' }, field('Change', prop), field('How', how), el('label', { class: 'picker' }, unit, value),
      field('Ramp in (m)', rampIn), field('Ramp out (m)', rampOut), field('Ramp shape', shape)),
    now, status,
    el('div', { class: 'actions' }, apply, cancel, clear));

  let turnsShown = null;
  function refresh(st) {
    // a brush drag makes a new document every tick: the turn list waits for the drag's end (it cost a third more per tick)
    if (st.brush) return;
    const list = shell.turns();
    if (list !== turnsShown) {
      turnsShown = list;
      const keep = turn.value;
      turn.replaceChildren(new win.Option(list.length ? 'Pick a turn…' : 'no turns on this track', ''), ...list.map((t) => { const o = new win.Option(t.label, String(t.n)); o.disabled = t.crossesStart; return o; }));
      turn.value = list.some((t) => String(t.n) === keep) ? keep : '';
    }
    const open = !!st.section;
    apply.disabled = !open; cancel.disabled = !open;
    if (!open && !pending && /^Preview/.test(status.textContent)) say('');
  }
  return { box, refresh, unmount() { settle(); if (stage) stage.removeEventListener('pointerdown', onPick, true); if (doc) doc.removeEventListener('keydown', onKey); } };
}

module.exports = { create, PROPS, RAMP_DEFAULT_M };
