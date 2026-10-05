// strip.js: THE STATUS STRIP (2026-10-05). The validation summary, always in sight over the 3D view (#status-strip in app/index.html):
// before, it sat at the foot of a long left column and was usually scrolled out of view. It MIRRORS the panel's summary (panel.js
// summary: the lap shown is Export's), and a click on it brings the full panel into view. The panel itself stays where the layout
// puts it, in the left column under the controls (app/test/shell-layout.test.js).
//
//   stripModel(state) -> [{ text, level: 'clear' | 'ok' | 'amber' | 'red', title }]   pure: the controller's state in, chips out
//   paintStrip(root, model, onClick)                                                   the chips as buttons in root
'use strict';
const { summary } = require('./panel.js');
const { lapText } = require('./labels.js');

function stripModel(state) {
  if (state && state.error) return [{ text: `not validated: ${state.error}`, level: 'red', title: state.error }];
  if (!state || !state.result) return [{ text: 'nothing to check yet', level: 'clear', title: 'place a piece and it is checked as it is placed' }];
  const s = summary(state), lap = s.lap;
  const jumps = `${s.jumps} jump${s.jumps === 1 ? '' : 's'}${s.jumpsPending ? ` (${s.jumpsPending} waiting for ${s.jumpsPending === 1 ? 'its landing' : 'their landings'})` : ''}`;
  return [
    { text: `${s.red} red`, level: s.red ? 'red' : 'clear', title: 'what would break in Assetto Corsa: Export refuses a track with any' },
    { text: `${s.amber} amber`, level: s.amber ? 'amber' : 'clear', title: 'past what real T-180 tracks do: allowed, worth a look' },
    { text: lapText(lap), level: lap && lap.ok === true ? 'ok' : lap && lap.ok === false ? 'red' : 'clear', title: 'the lap as Export proves it' },
    { text: jumps, level: 'clear', title: 'jumps, with both landings checked' },
  ].concat(s.pendingFrom != null ? [{ text: `checked to ${Math.round(s.pendingFrom)} m, the rest when the drag ends`, level: 'clear', title: '' }] : []);
}

function paintStrip(root, model, onClick) {
  const doc = root.ownerDocument;
  root.replaceChildren(...model.map((c) => {
    const b = doc.createElement('button');
    b.textContent = c.text; b.title = c.title ? `${c.title} (click: the full check)` : 'click: the full check';
    b.setAttribute('data-level', c.level); b.onclick = onClick;
    return b;
  }));
}

module.exports = { stripModel, paintStrip };
