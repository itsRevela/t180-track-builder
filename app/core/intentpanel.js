// intentpanel.js: EXTEND BY INTENT in the equation core's left column (2026-10-05). Four tabs, Straight, Turn, Climb / Dip and Bank,
// each a few fields in the user's own terms (an angle and a radius, a rise over a length), a readout of what it adds before it is
// added, and one Add button. The pieces are built by app/core/intents.js through the shell (shell.extendIntent: one undo step); the
// channel-by-channel Extend stays below, under "Custom", unchanged.
//
//   const ip = create({ el, field, num, send, shell, win })   el/field/num/send: the panel's own helpers (app/core/panel.js)
//   ip.box          the section to put in the column
//   ip.refresh(st)  after every shell change: the readout follows the head, and Add is off on a closed loop
//   ip.intent()     the intent the fields describe right now (tests, and the panel's ghost)
// It requires nothing of the core: the shell carries the intents (app/core/coreshell.js extendIntent, intentCandidate, intentReadout,
// intentBlendM), so the panel still loads in the webview's loader with no node built-in (app/test/core-xsec.test.js, D186).
'use strict';

const TABS = Object.freeze([['straight', 'Straight'], ['turn', 'Turn'], ['climb', 'Climb / Dip'], ['bank', 'Bank']]);
const ADD = Object.freeze({ straight: 'Add straight', turn: 'Add turn', climb: 'Add climb', bank: 'Add bank' });
const COLOURS = Object.freeze({ ok: '#9fe2c4', warn: '#ffd166', dim: '#aab2c0' });

const round = (x, d = 0) => { const f = 10 ** d, v = Math.round(x * f) / f; return (Object.is(v, -0) ? 0 : v).toLocaleString('en-US'); };
const signed = (x, d = 1) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${round(Math.abs(x), d)}`;

/** The readout's lines for an intent: [[text, colour], …]. Throws IntentError on bad fields (the caller shows the message). */
function readoutLines(shell, intent) {
  const r = shell.intentReadout(intent);
  if (intent.kind === 'straight') {
    return [[`Adds ${round(r.lengthM)} m of straight`, null],
      Math.abs(r.headingDeg) > 1e-6 ? [`It eases out of the curve at the head over the first ${round(Math.min(intent.blend, intent.length))} m (${signed(r.headingDeg)}° more), then runs dead straight.`, COLOURS.dim]
        : ['The head is straight, so this is straight from its first metre.', COLOURS.dim]];
  }
  if (intent.kind === 'turn') {
    return [[`Adds ${round(r.lengthM)} m · ${signed(r.headingDeg, 0)}° heading`, null],
      [`${round(r.loadG, 1)} g turning load at 460 km/h${intent.endStraight ? ', and it ends straight' : ', and it keeps curving into the next piece'}.`, COLOURS.dim],
      ...(r.blendM > r.blendAskedM + 1e-9 ? [[`Blend lengthened to ${round(r.blendM, 1)} m so the bank changes no faster than real T-180 tracks do.`, COLOURS.dim]] : [])];
  }
  if (intent.kind === 'climb') {
    return [[`Adds ${round(r.lengthM)} m · ${r.riseM > 0 ? 'rises' : 'drops'} ${round(Math.abs(r.riseM), 1)} m${intent.back ? ' and back' : ''} · steepest ${round(r.steepestDeg, 1)}°`, null],
      r.crestOk ? [`At full throttle (970 km/h) the crest keeps the car on the road (${round(r.crestLiftG, 2)} g of lift).`, COLOURS.ok]
        : [`At full throttle (970 km/h) the car leaves the road over the crest, and Export would refuse the lap: make it at least ${round(r.minLengthM)} m long, or lower.`, COLOURS.warn]];
  }
  return [[`Adds ${round(r.lengthM)} m · bank to ${round(r.bankDeg, 1)}°`, null],
    r.rateOk ? [`${round(r.rateDegPerM, 2)}°/m, within what real T-180 tracks bank.`, COLOURS.ok]
      : [`${round(r.rateDegPerM, 2)}°/m banks faster than real T-180 tracks do (${r.rateLimitDegPerM}°/m): make it longer.`, COLOURS.warn]];
}

function create({ el, field, num, send, shell, win }) {
  let tab = 'turn';
  const check = (on, label) => { const c = el('input', { type: 'checkbox', 'aria-label': label }); c.checked = on; return c; };
  const dir = el('select', { 'aria-label': 'turn direction' });
  dir.replaceChildren(new win.Option('Left', 'left'), new win.Option('Right', 'right')); dir.value = 'left';
  const F = {
    straight: { length: num(400, 10, 'metres of straight'), blend: num(shell.intentBlendM, 5, 'metres to ease out of a curve at the head (on a straight head, nothing to ease)') },
    turn: { dir, angle: num(90, 5, 'degrees of heading'), radius: num(200, 10, 'metres: the tightest point of the turn'), bank: num(0, 1, 'degrees the road leans into the turn'),
      blend: num(shell.intentBlendM, 5, 'metres the turn takes to tighten to its radius, and to straighten again'), out: check(true, 'the turn ends straight') },
    climb: { rise: num(10, 1, 'metres up, or down with a minus'), length: num(800, 50, 'metres the climb takes'), back: check(false, 'come back to the same height: a hill or a dip') },
    bank: { to: num(15, 1, 'degrees: + raises the left side'), length: num(200, 10, 'metres the bank takes') },
  };
  const n = (x) => Number(x.value);
  const intentOf = (k) => (k === 'straight' ? { kind: k, length: n(F.straight.length), blend: n(F.straight.blend) }
    : k === 'turn' ? { kind: k, dir: F.turn.dir.value, angle: n(F.turn.angle), radius: n(F.turn.radius), bank: n(F.turn.bank), blend: n(F.turn.blend), endStraight: F.turn.out.checked }
      : k === 'climb' ? { kind: k, rise: n(F.climb.rise), length: n(F.climb.length), back: F.climb.back.checked }
        : { kind: k, to: n(F.bank.to), length: n(F.bank.length) });

  const groups = {
    straight: el('div', { class: 'pickers', 'data-intent': 'straight' }, field('Length (m)', F.straight.length), field('Blend (m)', F.straight.blend)),
    turn: el('div', { class: 'pickers', 'data-intent': 'turn' }, field('Direction', F.turn.dir), field('Angle (°)', F.turn.angle), field('Radius (m)', F.turn.radius),
      field('Bank into turn (°)', F.turn.bank), field('Blend (m)', F.turn.blend), field('Ends straight', F.turn.out)),
    climb: el('div', { class: 'pickers', 'data-intent': 'climb' }, field('Rise (m, − = down)', F.climb.rise), field('Over (m)', F.climb.length), field('And back (hill / dip)', F.climb.back)),
    bank: el('div', { class: 'pickers', 'data-intent': 'bank' }, field('Bank to (°, + = left up)', F.bank.to), field('Over (m)', F.bank.length)),
  };
  const out = el('div', { 'aria-live': 'polite', 'data-intent-readout': '', style: 'margin:8px 0;font:600 14px/1.4 system-ui,"Segoe UI",sans-serif;color:#eef1f6' });
  const addBtn = el('button', { text: ADD[tab], title: 'add it at the open end of the track (one Undo takes it back)' });
  const tabBtns = TABS.map(([k, label]) => el('button', { text: label, 'aria-pressed': String(k === tab), 'data-intent-tab': k, onclick: () => pick(k) }));
  let closed = false;

  const readout = () => {
    let lines;
    try { lines = closed ? [['The loop is closed: nothing can be added at its end.', COLOURS.dim]] : readoutLines(shell, intentOf(tab)); }
    catch (e) { lines = [[e.message, COLOURS.warn]]; }
    out.replaceChildren(...lines.map(([t, c]) => el('div', { text: t, style: c ? `color:${c};font-weight:500` : '' })));
  };
  // the ghost: what Add would place, drawn by the preview at the head ('t180-ghost', as the channel Extend does); a candidate the
  // core refuses says why in the readout, and no ghost is left showing
  const ghost = () => {
    readout();
    if (closed) return;
    try { send('t180-ghost', { candidate: shell.intentCandidate(intentOf(tab)) }); } catch (e) { send('t180-ghost-clear'); }
  };
  const pick = (k) => {
    tab = k;
    for (const b of tabBtns) b.setAttribute('aria-pressed', String(b.getAttribute('data-intent-tab') === k));
    for (const [g, box] of Object.entries(groups)) box.style.display = g === k ? '' : 'none';
    addBtn.textContent = ADD[k];
    readout();
  };
  for (const g of Object.values(F)) for (const f of Object.values(g)) f.oninput = f.onchange = ghost;
  addBtn.onclick = () => { send('t180-ghost-clear'); shell.extendIntent(intentOf(tab)); };
  addBtn.onmouseenter = ghost; addBtn.onmouseleave = () => send('t180-ghost-clear');

  const box = el('section', { 'aria-label': 'add at the head by intent' },
    el('h3', { text: 'Add at the head' }),
    el('div', { class: 'actions', role: 'group', 'aria-label': 'what to add' }, ...tabBtns),
    ...Object.values(groups), out, el('div', { class: 'actions' }, addBtn));
  pick(tab);
  return {
    box,
    intent: () => intentOf(tab),
    tab: () => tab,
    pick,
    refresh(st) { closed = !!st.history.present.closed; addBtn.disabled = closed; readout(); },
  };
}

module.exports = { create, readoutLines, TABS };
