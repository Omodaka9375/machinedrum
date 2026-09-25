import { migrateLfo, lfoRate } from './lfo.js';
import { migrateFx } from './fx.js';
import {
  names,
  params,
  labels,
  soundInfo,
  demo,
  resolved,
  storeKit,
  reloadKit,
  recordParameter,
  validShapes,
} from './model.js';
import { Audio } from './audio.js';
import { MidiEngine, BleMidi, TempoEstimator, trackFromNote, velocityScale } from './midi.js';
const $ = (s) => document.querySelector(s),
  key = 'ferro-study-v1';
let project = demo();
try {
  const saved = JSON.parse(localStorage.getItem(key));
  if (saved?.version === 1 && validShapes(saved)) project = saved;
} catch {}
migrateFx(project);
migrateLfo(project);
project.tracks.forEach((t, i) => {
  t.choke ??= i === 2 || i === 3 ? 1 : 0;
});
if (!project.savedKit) storeKit(project);
let stepPage = 0,
  editPage = 'synth';
let track = 0,
  pattern = 0,
  step = 0,
  lock = false,
  starting = false,
  recording = false,
  gridMode = 'sequence',
  held = null,
  suppressClick = null,
  gesture = null;
const recordedValues = {};
const isLocked = () => lock || !!held;
const audio = new Audio(
  () => project,
  ({ step: s, pattern: p }) => {
    document
      .querySelectorAll('.step')
      .forEach((b, i) =>
        b.classList.toggle('current', gridMode === 'sequence' && audio.playing && p === pattern && i === s),
      );
    $('#lcdStep').textContent = s < 0 ? '— / 16' : `${String(s + 1).padStart(2, '0')} / 16`;
    $('#lcdState').textContent = audio.playing
      ? `${recording ? 'REC' : 'PLAY'} ${'ABCD'[p]}01`
      : recording
        ? 'REC ARMED'
        : 'READY';
    renderPatterns();
  },
);
audio.isRecording = () => recording;
audio.onCount = (n) => {
  $('#lcdState').textContent = 'COUNT ' + n;
  $('#lcdStep').textContent = String(n);
  status('Count-in ' + n + ' · recording starts after four beats');
};
const current = () => project.tracks[track],
  selected = () => project.patterns[pattern][track][step];
// save() is trailing-debounced: change() fires per input event while a knob is being dragged,
// and serialising the ~32 KB project plus a blocking localStorage write on every tick buys no
// durability that the flush hooks below don't already cover. Edits land once the burst settles.
const SAVE_DEBOUNCE_MS = 300;
let saveTimer = null;
function save() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flushSave, SAVE_DEBOUNCE_MS);
}
function flushSave() {
  if (saveTimer === null) return; // nothing pending — no write needed
  clearTimeout(saveTimer);
  saveTimer = null;
  localStorage.setItem(key, JSON.stringify(project));
}
// Durability backstops, so the debounce never widens the loss window:
//   pagehide                fires on close / refresh / navigation, even into bfcache
//   visibilitychange hidden  is the checkpoint when a hidden tab can be killed outright
window.addEventListener('pagehide', flushSave);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flushSave();
});
function status(text) {
  $('#status').textContent = text;
}
// Transient press feedback for the momentary panel buttons (TRIG/YES, EXIT/NO, the nav
// arrows). They carry no state so there is no persistent .active to react to — unlike the pads,
// which use .padHit, these get a short lit flash. The single timer resets on every press, so a
// rapid repeat (arrow-key held) keeps the last press lit instead of flickering.
let flashTimer = null;
function flash(el) {
  el.classList.add('pressed');
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    document.querySelectorAll('.pressed').forEach((b) => b.classList.remove('pressed'));
  }, 120);
}
function audition() {
  hit(track);
}
function hit(index, velocity) {
  if (held) return;
  track = index;
  if (recording && audio.playing && !audio.counting) {
    const pos = audio.liveHit(index, velocity);
    save();
    status(`Recorded ${names[index]} /${'ABCD'[pos.pattern]}${String(pos.step + 1).padStart(2, '0')}`);
  } else
    audio
      .audition(current(), isLocked() ? selected() : { locks: {} }, velocity)
      .catch(() => status('Audio is not running yet — tap TRIG again'));
  render();
  const b = document.querySelector(`[data-step="${index}"]`);
  if (gridMode === 'pads') {
    b.classList.add('padHit');
    setTimeout(() => b.classList.remove('padHit'), 100);
  }
}
audio.beforeStep = (position) => {
  if (recording && !audio.counting && gesture && !isLocked()) {
    recordParameter(project, position, gesture.track, gesture.param, gesture.value);
    save();
  }
};
$('#tracks').innerHTML = names
  .map(
    (n, i) =>
      `<button class="track" data-track="${i}" aria-label="Select track ${i + 1} ${n}"><i></i>${n}<kbd>${i < 8 ? i + 1 : '⇧' + (i - 7)}</kbd></button>`,
  )
  .join('');
$('#steps').innerHTML = Array.from(
  { length: 16 },
  (_, i) =>
    `<button class="step" data-step="${i}"><small>${String(i + 1).padStart(2, '0')} <span>${names[i]}</span></small></button>`,
).join('');
$('#patterns').innerHTML = ['A', 'B', 'C', 'D']
  .map(
    (n, i) =>
      `<button data-pattern="${i}" aria-label="Pattern ${n}" aria-keyshortcuts="Control+Shift+${i + 1}" title="Control+Shift+${i + 1}: Pattern ${n}">${n}</button>`,
  )
  .join('');
$('#knobs').innerHTML = params
  .map(
    (p, i) =>
      `<div class="knobcell"><button class="knob" role="slider" aria-label="${labels[i]}" aria-valuemin="0" aria-valuemax="100" data-param="${p}" title="Drag up / down · scroll wheel · arrow keys; double-click to audition"></button><small>${String.fromCharCode(65 + i)} / ${labels[i]}</small><output></output></div>`,
  )
  .join('');
function renderPatterns() {
  document.querySelectorAll('[data-pattern]').forEach((b, i) => {
    b.classList.toggle('active', i === pattern);
    b.classList.toggle('pending', audio.playing && audio.pending === i);
    b.setAttribute('aria-pressed', i === pattern);
  });
}
function render() {
  for (const id of ['quantize', 'swingEnabled']) {
    $('#' + id).setAttribute('aria-pressed', project[id] !== false);
    $('#' + id).classList.toggle('active', project[id] !== false);
  }
  if (audio.ctx) audio.metronome.gain.setValueAtTime(recording ? 1 : 0, audio.ctx.currentTime);
  for (let i = 0; i < 2; i++) {
    $('#stepPage' + i).classList.toggle('active', stepPage === i);
    $('#stepPage' + i).setAttribute('aria-pressed', stepPage === i);
  }
  document
    .querySelectorAll('[data-step]')
    .forEach((b, i) => b.classList.toggle('keyPage', Math.floor(i / 8) === stepPage));
  document.querySelectorAll('[data-track]').forEach((b, i) => {
    b.classList.toggle('selected', i === track);
    b.classList.toggle('muted', project.tracks[i].mute);
    b.setAttribute('aria-pressed', i === track);
  });
  document.querySelectorAll('[data-step]').forEach((b, i) => {
    const s = project.patterns[pattern][track][i],
      t = project.tracks[i],
      seq = gridMode === 'sequence';
    b.classList.toggle('on', seq ? s.on : gridMode === 'mutes' ? !t.mute : false);
    b.classList.toggle('selected', seq ? i === step : i === track);
    b.classList.toggle(
      'locked',
      seq && Object.keys(s.locks).length + Object.keys(s.fxLocks ?? {}).length > 0,
    );
    b.classList.toggle('held', held?.step === i && seq);
    if (!seq) b.classList.remove('current');
    b.setAttribute(
      'aria-label',
      seq
        ? `Step ${i + 1} ${s.on ? 'on' : 'off'}${Object.keys(s.locks).length + Object.keys(s.fxLocks ?? {}).length ? ' · locked' : ''}`
        : gridMode === 'mutes'
          ? `Mute track ${i + 1} ${names[i]} ${t.mute ? 'muted' : 'audible'}`
          : `Hit track ${i + 1} ${names[i]}`,
    );
    b.setAttribute('aria-pressed', seq ? s.on : gridMode === 'mutes' ? t.mute : i === track);
  });
  $('#trigMode').classList.toggle('active', gridMode === 'sequence');
  $('#padMode').classList.toggle('active', gridMode === 'pads');
  $('#muteMode').classList.toggle('active', gridMode === 'mutes');
  $('#trigMode').setAttribute('aria-pressed', gridMode === 'sequence');
  $('#padMode').setAttribute('aria-pressed', gridMode === 'pads');
  $('#muteMode').setAttribute('aria-pressed', gridMode === 'mutes');
  $('#record').classList.toggle('active', recording);
  $('#record').setAttribute('aria-pressed', recording);
  $('#gridTitle').textContent =
    gridMode === 'sequence'
      ? 'TRIG SEQUENCER'
      : gridMode === 'pads'
        ? 'LIVE PADS / 16 VOICES'
        : 'TRACK MUTES / LIT = AUDIBLE';
  const info = soundInfo[current().engine],
    titles = info?.labels ?? labels;
  $('#hint').textContent =
    info?.help ?? 'Knobs edit the whole track. Turn on STEP LOCK to give every step its own sound.';
  const values = isLocked()
    ? resolved(current(), selected())
    : { ...current().p, ...(recording ? recordedValues[track] : {}) };
  document.querySelectorAll('[data-param]').forEach((b, i) => {
    const p = b.dataset.param,
      v = values[p];
    b.setAttribute('aria-label', titles[i]);
    b.parentElement.querySelector('small').textContent = String.fromCharCode(65 + i) + ' / ' + titles[i];
    b.style.setProperty('--angle', `${v * 2.7 - 135}deg`);
    b.setAttribute('aria-valuenow', v);
    b.removeAttribute('aria-valuetext');
    b.parentElement.classList.toggle('locked', isLocked() && p in selected().locks);
    b.parentElement.querySelector('output').textContent = String(v).padStart(3, '0');
  });
  $('#lcdValues').innerHTML = params
    .map((p, i) => lcdDial(titles[i].slice(0, 4), values[p], values[p]))
    .join('');
  $('#lcdName').textContent =
    `${names[track]} / ${info?.name.split(' / ')[1] ?? current().engine.toUpperCase()}`;
  $('#lcdPattern').textContent = `${'ABCD'[pattern]}01 · TR${String(track + 1).padStart(2, '0')}`;
  $('#lcdEdit').textContent = isLocked()
    ? `LOCK / STEP ${String(step + 1).padStart(2, '0')}`
    : recording
      ? 'LIVE RECORD / 1:16'
      : 'KIT / SYNTHESIS';
  // The arrow buttons / arrow keys move the step selection at rest, and that must be readable:
  // during playback the onStep callback owns this readout (it shows the playing step), so only
  // write it here while stopped and in sequence mode.
  if (!audio.playing && gridMode === 'sequence')
    $('#lcdStep').textContent = `${String(step + 1).padStart(2, '0')} / 16`;
  $('#lock').classList.toggle('active', lock);
  $('#lock').setAttribute('aria-pressed', lock);
  $('#mute').classList.toggle('active', current().mute);
  $('#mute').setAttribute('aria-pressed', current().mute);
  $('#unlock').disabled = !Object.keys(selected().locks).length;
  $('#choke').value = current().choke ?? 0;
  if (document.activeElement !== $('#lcdTempo')) $('#lcdTempo').value = project.bpm.toFixed(1);
  $('#swing').value = project.swing;
  $('#volume').value = project.master;
  renderPatterns();
  renderFx();
}
function change(p, v) {
  if (editPage === 'lfo') {
    changeLfo(p, v);
    return;
  }
  if (editPage === 'fx') {
    changeFx(p, v);
    return;
  }
  v = Math.max(0, Math.min(100, Math.round(v)));
  if (held) {
    held.changed = true;
    const target = project.patterns[held.pattern][held.track][held.step];
    target.on = true;
    target.locks[p] = v;
  } else if (lock) {
    selected().on = true;
    selected().locks[p] = v;
  } else if (recording && audio.playing && !audio.counting) {
    recordParameter(project, audio.position(), track, p, v);
    (recordedValues[track] ??= {})[p] = v;
    if (gesture) gesture.value = v;
  } else current().p[p] = v;
  render();
  save();
}
function choose(index) {
  if (held) return;
  if (gridMode === 'pads') hit(index);
  else if (gridMode === 'mutes') {
    project.tracks[index].mute = !project.tracks[index].mute;
    render();
    save();
  } else {
    track = index;
    render();
  }
}
$('#tracks').onclick = (e) => {
  const b = e.target.closest('[data-track]');
  if (!b || held) return;
  track = +b.dataset.track;
  render();
};
$('#steps').onpointerdown = (e) => {
  const b = e.target.closest('[data-step]');
  if (!b || e.button !== 0) return;
  if (gridMode !== 'sequence') return;
  held = {
    pointer: e.pointerId,
    step: +b.dataset.step,
    track,
    pattern,
    started: performance.now(),
    changed: false,
    paint: false,
    canPaint: !e.shiftKey,
  };
  step = held.step;
  render();
};
$('#steps').onpointermove = (e) => {
  if (
    !held ||
    held.pointer !== e.pointerId ||
    !(e.buttons & 1) ||
    !held.canPaint ||
    (held.changed && !held.paint)
  )
    return;
  const b = document.elementFromPoint(e.clientX, e.clientY)?.closest('#steps [data-step]');
  if (!b || +b.dataset.step === step) return;
  held.paint = true;
  held.changed = true;
  project.patterns[held.pattern][held.track][held.step].on = true;
  const next = +b.dataset.step;
  for (let i = Math.min(step, next); i <= Math.max(step, next); i++)
    project.patterns[held.pattern][held.track][i].on = true;
  step = next;
  render();
  save();
};
// While a step drag is in progress the wheel must never scroll the page: the paint-drag reads
// document.elementFromPoint against a layout that must not move under the pointer, and a scroll
// mid-drag also lands the cursor somewhere the musician never intended. Non-passive so the
// preventDefault is allowed; with nothing held this listener does nothing at all.
document.addEventListener(
  'wheel',
  (e) => {
    if (held) e.preventDefault();
  },
  { passive: false },
);
// The panel hint promises "hold a step + scroll wheel to lock params". Over a knob, the knob's
// own wheel handler already does that; over the step grid the wheel mirrors the up/down arrow
// keys (SYNTH pitch / FX send A), and change() writes the result as a parameter lock for the
// held step.
$('#steps').addEventListener(
  'wheel',
  (e) => {
    if (!held) return;
    e.preventDefault();
    change(
      'pitch',
      (editPage === 'lfo'
        ? lfoValue('pitch')
        : editPage === 'fx'
          ? fxValue('pitch')
          : (isLocked() ? resolved(current(), selected()) : current().p).pitch) +
        (e.deltaY < 0 ? 1 : -1) * increment('pitch'),
    );
  },
  { passive: false },
);
function releaseHold(e) {
  if (!held || (e && e.pointerId !== held.pointer)) return;
  if (!e || held.changed || performance.now() - held.started > 200)
    suppressClick = { step: held.paint ? null : held.step, until: performance.now() + 600 };
  held = null;
  render();
}
document.addEventListener('pointerup', releaseHold);
document.addEventListener('pointercancel', releaseHold);
window.addEventListener('blur', () => {
  releaseHold();
  gesture = null;
});
$('#steps').onclick = (e) => {
  const b = e.target.closest('[data-step]');
  if (!b) return;
  const index = +b.dataset.step;
  if (
    suppressClick &&
    (suppressClick.step === null || suppressClick.step === index) &&
    performance.now() < suppressClick.until
  ) {
    suppressClick = null;
    return;
  }
  if (gridMode !== 'sequence') {
    choose(index);
    return;
  }
  step = index;
  if (e.shiftKey) {
    lock = true;
    selected().on = true;
  } else selected().on = !selected().on;
  render();
  save();
  if (selected().on && !audio.playing) audio.audition(current(), selected());
};
$('#steps').oncontextmenu = (e) => {
  const b = e.target.closest('[data-step]');
  if (!b || gridMode !== 'sequence') return;
  e.preventDefault();
  releaseHold();
  step = +b.dataset.step;
  lock = true;
  render();
};
$('#patterns').onclick = (e) => {
  const b = e.target.closest('[data-pattern]');
  if (!b || held) return;
  gesture = null;
  pattern = +b.dataset.pattern;
  if (audio.playing) audio.pending = pattern;
  document.querySelectorAll('.current').forEach((b) => b.classList.remove('current'));
  render();
  status(audio.playing ? 'Pattern will switch at the next bar' : 'Editing Pattern ' + 'ABCD'[pattern]);
};
$('#lock').onclick = () => {
  lock = !lock;
  render();
};
$('#unlock').onclick = () => {
  if (editPage === 'fx') selected().fxLocks = {};
  else selected().locks = {};
  render();
  save();
};
$('#choke').onchange = (e) => {
  current().choke = +e.target.value;
  save();
  status(
    current().choke
      ? 'Sounds in this group will cut each other off on the next trigger'
      : 'This track does not choke with the others',
  );
};
$('#mute').onclick = () => {
  current().mute = !current().mute;
  render();
  save();
};
$('#audition').onclick = () => {
  flash($('#audition'));
  audition();
};
for (const b of document.querySelectorAll('.knob')) {
  const p = b.dataset.param,
    value = () =>
      editPage === 'lfo'
        ? lfoValue(p)
        : editPage === 'fx'
          ? fxValue(p)
          : isLocked()
            ? resolved(current(), selected())[p]
            : ((recording ? recordedValues[track]?.[p] : undefined) ?? current().p[p]);
  let drag = null;
  b.onpointerdown = (e) => {
    if (e.button !== 0) return;
    drag = { y: e.clientY, v: value() };
    gesture = editPage === 'synth' ? { track, param: p, value: value() } : null;
    b.setPointerCapture(e.pointerId);
  };
  b.onpointermove = (e) => {
    if (drag) change(p, drag.v + (drag.y - e.clientY) * (e.shiftKey ? 0.15 : 0.6));
  };
  b.onpointerup = () => {
    if (drag) {
      drag = null;
      gesture = null;
      if (editPage === 'synth' && !audio.playing && !held) audition();
    }
  };
  b.onpointercancel = () => {
    drag = null;
    gesture = null;
  };
  b.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      change(p, value() + (e.deltaY < 0 ? 1 : -1) * increment(p));
    },
    { passive: false },
  );
  b.onkeydown = (e) => {
    if (['ArrowUp', 'ArrowRight', 'ArrowDown', 'ArrowLeft'].includes(e.key)) {
      e.preventDefault();
      change(p, value() + (['ArrowUp', 'ArrowRight'].includes(e.key) ? 1 : -1) * increment(p));
    }
    if (e.key === 'Home') {
      e.preventDefault();
      change(p, 0);
    }
    if (e.key === 'End') {
      e.preventDefault();
      change(p, 100);
    }
  };
  b.ondblclick = audition;
}
async function play() {
  if (starting) return;
  if (audio.playing) {
    stop();
    return;
  }
  starting = true;
  try {
    await audio.start(pattern, recording);
    $('#play').innerHTML =
      '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4h5v16H5zM14 4h5v16h-5z"/></svg>';
    $('#play').setAttribute('aria-label', 'Pause');
    status('Playing · turn a knob, or select a step to lock it');
  } catch {
    status('Cannot start audio — try again');
  } finally {
    starting = false;
  }
}
function stop() {
  recording = false;
  gridMode = 'sequence';
  gesture = null;
  Object.keys(recordedValues).forEach((k) => delete recordedValues[k]);
  audio.stop();
  render();
  $('#play').innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3 21 12 7 21Z"/></svg>';
  $('#play').setAttribute('aria-label', 'Play');
}
$('#play').onclick = () => play();
$('#stop').onclick = () => stop();
document.addEventListener('keydown', (e) => {
  if (document.querySelector('dialog[open],.patternMenu')) return;
  if (
    e.isComposing ||
    e.metaKey ||
    e.defaultPrevented ||
    e.target.closest('input,select,textarea,[contenteditable="true"]')
  )
    return;
  const patternKey = /^(?:Digit|Numpad)([1-4])$/.exec(e.code);
  if (e.ctrlKey && e.shiftKey && !e.altKey && patternKey) {
    e.preventDefault();
    if (!e.repeat) document.querySelector('[data-pattern="' + (+patternKey[1] - 1) + '"]').click();
    return;
  }
  if (e.ctrlKey || e.altKey) return;
  if (e.code === 'Tab' && !e.shiftKey) {
    e.preventDefault();
    if (!e.repeat) {
      stepPage = 1 - stepPage;
      render();
    }
    return;
  }
  const stepKey = ['KeyZ', 'KeyX', 'KeyC', 'KeyV', 'KeyB', 'KeyN', 'KeyM', 'Comma'].indexOf(e.code);
  if (stepKey >= 0) {
    e.preventDefault();
    if (e.repeat || held) return;
    if (recording || gridMode === 'pads') hit(stepKey + (e.shiftKey ? 8 : 0));
    else if (e.shiftKey) hit(track);
    else {
      gridMode = 'sequence';
      step = stepPage * 8 + stepKey;
      selected().on = !selected().on;
      render();
      save();
    }
    return;
  }
  document.body.classList.toggle('shift-bank', e.shiftKey);
  const digit = /^(?:Digit|Numpad)([1-8])$/.exec(e.code);
  if (digit) {
    e.preventDefault();
    if (!e.repeat) choose(+digit[1] - 1 + (e.shiftKey ? 8 : 0));
    return;
  }
  const nav = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
  if (nav[e.code]) {
    e.preventDefault();
    document.querySelector('[data-nav="' + nav[e.code] + '"]').click();
    return;
  }
  const action = {
    Space: () => play(),
    Enter: () => $('#audition').click(), // same action, but flashes the TRIG button like Escape does EXIT
    KeyL: () => $('#lock').click(),
    KeyU: () => $(e.shiftKey ? '#muteMode' : '#mute').click(),
    KeyG: () => $('#trigMode').click(), // G = back to the step grid from either performance mode
    KeyP: () => $('#padMode').click(),
    KeyR: () => $('#record').click(),
    Escape: () => $('#exitLock').click(),
  }[e.code];
  if (action) {
    e.preventDefault();
    if (!e.repeat) action();
  }
});
document.addEventListener('keyup', (e) => {
  if (!e.shiftKey) document.body.classList.remove('shift-bank');
});
window.addEventListener('blur', () => document.body.classList.remove('shift-bank'));
for (const id of ['quantize', 'swingEnabled'])
  $('#' + id).onclick = () => {
    project[id] = project[id] === false;
    save();
    render();
  };
for (const id of ['swing'])
  $('#' + id).onchange = (e) => {
    const v = Number(e.target.value);
    project[id] = Math.max(+e.target.min, Math.min(+e.target.max, Number.isFinite(v) ? v : 124));
    save();
    render();
  };
$('#volume').oninput = (e) => {
  project.master = +e.target.value;
  if (audio.ctx) audio.master.gain.setTargetAtTime(project.master / 100, audio.ctx.currentTime, 0.01);
  save();
};
$('#saveKit').onclick = () => {
  storeKit(project);
  save();
  status('Kit stored. RELOAD brings it back, even after a refresh.');
};
$('#reloadKit').onclick = () => {
  gesture = null;
  Object.keys(recordedValues).forEach((k) => delete recordedValues[k]);
  reloadKit(project);
  migrateFx(project);
  migrateLfo(project);
  if (audio.ctx) audio.effects.update(project);
  save();
  render();
  status('Kit sounds restored · patterns, parameter locks and mutes kept · playback continues');
};
$('#demo').onclick = () => {
  if (
    !confirm(
      'Factory reset: load the four demo patterns and default sounds? Your current edits will be replaced.',
    )
  )
    return;
  stop();
  project = demo();
  migrateFx(project);
  migrateLfo(project);
  storeKit(project);
  pattern = 0;
  track = 0;
  step = 0;
  lock = false;
  save();
  render();
  status('Factory reset done');
};
const lfoSpec = [
  ['wave', 'WAVE', 0, 3, 1],
  ['target', 'DEST', 0, 2, 1],
  ['speed', 'SPEED', 0, 100, 1],
  ['depth', 'DEPTH', 0, 100, 1],
  ['phase', 'PHASE', 0, 100, 1],
  ['sync', 'SYNC', 0, 6, 1],
  ['reset', 'MODE', 0, 1, 1],
  ['on', 'LFO', 0, 1, 1],
];
function lfoValue(p) {
  const [id, , min, max] = lfoSpec[params.indexOf(p)];
  return ((current().lfo[id] - min) / (max - min)) * 100;
}
function changeLfo(p, v) {
  const [id, , min, max] = lfoSpec[params.indexOf(p)];
  current().lfo[id] = Math.round(min + ((max - min) * Math.max(0, Math.min(100, v))) / 100);
  save();
  render();
}
function lfoText(id) {
  const l = current().lfo;
  return id === 'wave'
    ? ['SINE', 'TRI', 'SQR', 'SAW'][l.wave]
    : id === 'target'
      ? ['PITCH', 'LEVEL', 'FILTER'][l.target]
      : id === 'sync'
        ? ['FREE', '1/16', '1/8', '1/4', '1/2', '1BAR', '2BAR'][l.sync]
        : id === 'reset'
          ? l.reset
            ? 'TRIG'
            : 'FREE'
          : id === 'on'
            ? l.on
              ? 'ON'
              : 'OFF'
            : id === 'speed'
              ? lfoRate(l, project.bpm).toFixed(2)
              : l[id];
}
function renderLfo() {
  $('#lcdName').textContent = 'LFO / ' + names[track];
  $('#lcdEdit').textContent = 'TRACK ' + String(track + 1).padStart(2, '0') + ' / MODULATION';
  document.querySelector('.datafoot span').innerHTML = '<i></i> LFO';
  $('#hint').textContent = 'A per-track LFO · PITCH / LEVEL / FILTER · changes apply from the next trigger';
  $('#lcdValues').innerHTML = lfoSpec
    .map(([id, label], i) => lcdDial(label, lfoValue(params[i]), lfoText(id)))
    .join('');
  document.querySelectorAll('[data-param]').forEach((b, i) => {
    const [id, label] = lfoSpec[i],
      n = lfoValue(params[i]);
    b.setAttribute('aria-label', label);
    b.setAttribute('aria-valuenow', n);
    b.setAttribute('aria-valuetext', String(lfoText(id)));
    b.style.setProperty('--angle', `${n * 2.7 - 135}deg`);
    b.parentElement.querySelector('small').textContent = String.fromCharCode(65 + i) + ' / ' + label;
    b.parentElement.querySelector('output').textContent = lfoText(id);
    b.parentElement.classList.remove('locked');
  });
}
const fxSpec = [
  ['sendDelay', 'D.SEND', 0, 100, 1],
  ['sendReverb', 'R.SEND', 0, 100, 1],
  ['time', 'TIME', 40, 1500, 10],
  ['feedback', 'FDBK', 0, 78, 1],
  ['delay', 'D.RET', 0, 80, 1],
  ['room', 'DECAY', 0.2, 4, 0.1],
  ['reverb', 'R.RET', 0, 80, 1],
];
function fxActual(id) {
  if (isLocked() && id in (selected().fxLocks ?? {})) return selected().fxLocks[id];
  return id === 'sendDelay'
    ? current().send.delay
    : id === 'sendReverb'
      ? current().send.reverb
      : project.fx[id];
}
function increment(p) {
  const spec =
    editPage === 'lfo' ? lfoSpec[params.indexOf(p)] : editPage === 'fx' ? fxSpec[params.indexOf(p)] : null;
  return spec ? (spec[4] / (spec[3] - spec[2])) * 100 : 1;
}
function fxValue(p) {
  const spec = fxSpec[params.indexOf(p)];
  return spec ? ((fxActual(spec[0]) - spec[2]) / (spec[3] - spec[2])) * 100 : 0;
}
function changeFx(p, v) {
  const spec = fxSpec[params.indexOf(p)];
  if (!spec) return;
  const [id, , min, max, unit] = spec;
  const n = +Math.max(
    min,
    Math.min(max, Math.round((min + ((max - min) * Math.max(0, Math.min(100, v))) / 100) / unit) * unit),
  ).toFixed(1);
  if (isLocked()) {
    if (id === 'room') return;
    if (held) held.changed = true;
    selected().on = true;
    (selected().fxLocks ??= {})[id] = n;
    save();
    render();
    return;
  }
  if (id === 'sendDelay') current().send.delay = n;
  else if (id === 'sendReverb') current().send.reverb = n;
  else project.fx[id] = n;
  if (audio.ctx) audio.effects.update(project);
  save();
  render();
}
function lcdDial(label, n, value) {
  const angle = ((n * 2.7 - 135) * Math.PI) / 180;
  const rim = 'M7 3 H18 V5 H21 V8 H23 V18 H21 V21 H18 V23 H7 V21 H4 V18 H2 V8 H4 V5 H7 Z';
  return `<span class="fxDial"><em>${label}</em><svg viewBox="0 0 26 26" aria-hidden="true" shape-rendering="crispEdges"><path class="dialRim" d="${rim}"/><path d="M13 13 L${Math.round(13 + 9 * Math.sin(angle))} ${Math.round(13 - 9 * Math.cos(angle))}"/><rect x="12" y="12" width="2" height="2"/></svg><b>${value}</b></span>`;
}
function renderFx() {
  const on = editPage !== 'synth';
  $('.display').classList.toggle('fxPage', on);
  document.querySelectorAll('[data-edit-page]').forEach((b) => {
    b.classList.toggle('active', b.dataset.editPage === editPage);
    b.setAttribute('aria-pressed', b.dataset.editPage === editPage);
  });
  $('#lock').disabled = editPage === 'lfo';
  $('#unlock').disabled =
    editPage === 'lfo' ||
    !Object.keys(editPage === 'fx' ? (selected().fxLocks ?? {}) : selected().locks).length;
  document.querySelector('.datafoot span').innerHTML = '<i></i> ' + (on ? 'EFFECTS' : 'SYNTHESIS');
  document.querySelectorAll('[data-param]').forEach((b, i) => {
    b.disabled = editPage === 'fx' && (i >= fxSpec.length || (isLocked() && fxSpec[i]?.[0] === 'room'));
  });
  if (editPage === 'lfo') {
    renderLfo();
    return;
  }
  if (!on) return;
  $('#lcdName').textContent = 'FX / ' + names[track];
  $('#lcdEdit').textContent = isLocked()
    ? 'FX LOCK / STEP ' + String(step + 1).padStart(2, '0')
    : 'A–B TRACK · C–G MASTER';
  $('#hint').textContent =
    'STEP LOCK: lock sends, delay and returns per step; DECAY is the global reverb length. On a clash in the same step, the higher-numbered track wins.';
  $('#lcdValues').innerHTML = params
    .map((p, i) => {
      const spec = fxSpec[i];
      return spec
        ? lcdDial(spec[1], fxValue(p), fxActual(spec[0]) + (spec[0] === 'room' ? 's' : ''))
        : '<span class="fxDial empty">—</span>';
    })
    .join('');
  document.querySelectorAll('[data-param]').forEach((b, i) => {
    const spec = fxSpec[i],
      n = fxValue(params[i]);
    b.setAttribute('aria-label', spec?.[1] ?? 'UNUSED');
    b.setAttribute('aria-valuenow', n);
    b.setAttribute('aria-valuetext', spec ? String(fxActual(spec[0])) : '');
    b.style.setProperty('--angle', `${n * 2.7 - 135}deg`);
    b.parentElement.querySelector('small').textContent =
      String.fromCharCode(65 + i) + ' / ' + (spec?.[1] ?? '—');
    b.parentElement.querySelector('output').textContent = spec ? fxActual(spec[0]) : '—';
    b.parentElement.classList.toggle('locked', isLocked() && !!spec && spec[0] in (selected().fxLocks ?? {}));
  });
}
for (const b of document.querySelectorAll('[data-edit-page]'))
  b.onclick = () => {
    if (held) return;
    gesture = null;
    editPage = b.dataset.editPage;
    render();
  };
for (let i = 0; i < 2; i++)
  $('#stepPage' + i).onclick = () => {
    stepPage = i;
    render();
  };
const canvas = $('#scope'),
  g = canvas.getContext('2d'),
  wave = new Uint8Array(512);
let last = 0;
function frame(now) {
  audio.tick();
  if (now - last > 33) {
    last = now;
    g.clearRect(0, 0, 420, 90);
    g.strokeStyle = '#394c30';
    g.lineWidth = 1.5;
    g.beginPath();
    if (audio.ctx) {
      audio.analyser.getByteTimeDomainData(wave);
      wave.forEach((v, i) => {
        const x = (i / 511) * 420,
          y = 45 + (v - 128) * 0.3;
        i ? g.lineTo(x, y) : g.moveTo(x, y);
      });
    } else {
      g.moveTo(0, 45);
      g.lineTo(420, 45);
    }
    g.stroke();
  }
  requestAnimationFrame(frame);
}
render();
requestAnimationFrame(frame);

// Jog wheel: drag to rotate. A step fires when the pointer crosses the midpoint between two
// notch positions (22.5° per track, threshold at ±11.25° of accumulated travel since the last
// step), so a slow full turn sweeps all 16 tracks and quick circular strokes rack up steps like
// a real jog wheel. A plain click (no rotation) still auditions.
const jog = $('#jog');
// Declared before jogAngle, which reads it. Nothing calls jogAngle during module evaluation, so
// the previous order happened to work — but a TDZ read only stays invisible until something does.
let jogCenter = { x: 0, y: 0 };
let jogDrag = null;
const jogAngle = (e) => Math.atan2(e.clientY - jogCenter.y, e.clientX - jogCenter.x);
jog.addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    if (held) return;
    jogStep(e.deltaY > 0 ? 1 : -1);
  },
  { passive: false },
);
jog.onpointerdown = (e) => {
  if (e.button !== 0 || held) return;
  const r = jog.getBoundingClientRect();
  jogCenter = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  jogDrag = { pointer: e.pointerId, moved: false, angle: jogAngle(e), crossing: 0 };
  jog.setPointerCapture(e.pointerId);
};
jog.onpointermove = (e) => {
  if (!jogDrag || jogDrag.pointer !== e.pointerId) return;
  const angle = jogAngle(e);
  let delta = angle - jogDrag.angle;
  // atan2 wraps at ±π; a drag the long way round arrives as many small events, but a single
  // event can still straddle the wrap, so normalise to the signed short way.
  if (delta > Math.PI) delta -= 2 * Math.PI;
  else if (delta < -Math.PI) delta += 2 * Math.PI;
  jogDrag.angle = angle;
  if (Math.abs(delta) > 0) jogDrag.moved = true;
  // Detent accumulator: fires a step once travel since the last step reaches the midpoint
  // (±half a sector), consuming a full sector. Strict comparisons both ways: after a forward
  // fire the residue sits at exactly −half-sector when the threshold was hit dead-on, and a
  // non-strict reverse loop would immediately cancel the step it just fired.
  const sector = (2 * Math.PI) / 16;
  jogDrag.crossing += delta;
  while (jogDrag.crossing > sector / 2) {
    jogDrag.crossing -= sector;
    jogStep(1);
  }
  while (jogDrag.crossing < -sector / 2) {
    jogDrag.crossing += sector;
    jogStep(-1);
  }
};
jog.onpointerup = (e) => {
  if (!jogDrag || jogDrag.pointer !== e.pointerId) return;
  const moved = jogDrag.moved;
  jogDrag = null;
  // A click with no rotation auditions, as before; a drag does not.
  if (!moved) audition();
};
jog.onpointercancel = () => (jogDrag = null);
jog.onclick = (e) => {
  // pointerup already handled the audition; suppress the duplicate click.
  e.preventDefault();
};
function jogStep(direction) {
  track = (track + (direction > 0 ? 1 : 15)) % 16;
  jog.style.setProperty('--jog', `${(track * 360) / 16}deg`);
  render();
}
jog.onkeydown = (e) => {
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
    e.preventDefault();
    if (held) return;
    jogStep(['ArrowDown', 'ArrowRight'].includes(e.key) ? 1 : -1);
  }
};
// Rotate the notch to the restored/current track on load.
jog.style.setProperty('--jog', `${(track * 360) / 16}deg`);
$('#exitLock').onclick = () => {
  flash($('#exitLock'));
  lock = false;
  render();
};
for (const b of document.querySelectorAll('[data-nav]'))
  b.onclick = () => {
    flash(b);
    const direction = b.dataset.nav;
    if (direction === 'left' || direction === 'right') {
      if (held) return;
      step = (step + (direction === 'right' ? 1 : 15)) % 16;
      render();
    } else {
      change(
        'pitch',
        (editPage === 'lfo'
          ? lfoValue('pitch')
          : editPage === 'fx'
            ? fxValue('pitch')
            : (isLocked() ? resolved(current(), selected()) : current().p).pitch) +
          (direction === 'up' ? 1 : -1) * increment('pitch'),
      );
      if (!audio.playing && !held) audition();
    }
  };

$('#play').title = 'Space: play / stop';
$('#audition').title = 'Enter: audition the current sound';
$('#mute').title = 'U: mute the current track';
$('#lock').title = 'L: toggle per-step parameter lock';
$('#exitLock').title = 'Esc: exit parameter lock';

// ---------------------------------------------------------------------------
// MIDI. Two transports feed one handler: Web MIDI (USB / OS-paired BT) and direct BLE pairing
// over Web Bluetooth. Notes come in on the GM drum map (or chromatically C1..D#2) and hit
// tracks with velocity; while recording they are captured into the pattern like pad hits.
// Transport / continue / stop follow the incoming clock; program change 1-4 switches pattern.
// Outbound: sequencer steps echo as notes on the first available output (channel 10, drums).
const midiClock = new TempoEstimator();
function midiEmit(type, detail) {
  if (type === 'noteon') {
    const t = trackFromNote(detail.note);
    if (t === null) return;
    hit(t, velocityScale(detail.velocity) ?? 1);
  } else if (type === 'clock') {
    const bpm = midiClock.tick();
    if (bpm !== null && bpm !== project.bpm && bpm >= 40 && bpm <= 240) setTempo(bpm);
  } else if (type === 'start' || type === 'continue') {
    if (!audio.playing) play();
  } else if (type === 'stop') {
    if (audio.playing) stop();
  } else if (type === 'program') {
    const p = detail.value & 3; // 1-4 -> 0-3
    if (p !== pattern) {
      pattern = p;
      if (audio.playing) audio.pending = p;
      render();
      status(`Pattern ${'ABCD'[pattern]} (MIDI program change)`);
    }
  }
}
const midiStatus = (label, connected, extra) => {
  const btn = label === 'midi' ? $('#midi') : $('#bt');
  if (!btn) return;
  btn.setAttribute('aria-pressed', connected);
  btn.classList.toggle('active', connected);
  if (label === 'midi') status(connected ? `MIDI connected · ${extra ?? ''}` : 'MIDI disconnected');
  else status(connected ? `Bluetooth MIDI: ${extra ?? ''}` : 'Bluetooth MIDI disconnected');
};
const midi = new MidiEngine(midiEmit, midiStatus);
const ble = new BleMidi(midiEmit, midiStatus);
// Sequencer echo: track -> GM drum note on channel 10. sendNote no-ops without an output.
audio.afterStep = (stepIndex, trackIndex) => {
  const t = project.tracks[trackIndex];
  const s = project.patterns[pattern][trackIndex][stepIndex];
  midi.sendNote(9, trackIndex + 36, resolved(t, s).level / 100);
};
audio.onAudition = (trackIndex) =>
  midi.sendNote(9, trackIndex + 36, project.tracks[trackIndex].p.level / 100);
$('#midi').onclick = async () => {
  if (midi.connected) {
    midi.disconnect();
    midiStatus('midi', false);
    return;
  }
  try {
    await audio.init(); // unlock audio on the same gesture
    const n = await midi.connect();
    midiStatus('midi', true, `${n} input${n === 1 ? '' : 's'}`);
  } catch (e) {
    status(`MIDI: ${e.message}`);
  }
};
$('#bt').onclick = async () => {
  if (ble.connected) {
    ble.disconnect();
    midiStatus('ble', false);
    return;
  }
  try {
    await audio.init();
    const name = await ble.connect();
    midiStatus('ble', true, name);
  } catch (e) {
    // NotFoundError = user cancelled the chooser; not worth a scary message.
    status(e.name === 'NotFoundError' ? 'Bluetooth pairing cancelled' : `Bluetooth MIDI: ${e.message}`);
  }
};

const setGridMode = (mode) => {
  if (recording) return;
  releaseHold();
  gridMode = mode;
  render();
};
$('#trigMode').onclick = () => setGridMode('sequence');
$('#padMode').onclick = () => setGridMode(gridMode === 'pads' ? 'sequence' : 'pads');
$('#muteMode').onclick = () => setGridMode(gridMode === 'mutes' ? 'sequence' : 'mutes');
$('#record').onclick = () => {
  const wasPlaying = audio.playing;
  if (recording) {
    if (audio.counting) stop();
    else {
      recording = false;
      gridMode = 'sequence';
    }
  } else {
    if (wasPlaying) stop();
    recording = true;
    releaseHold();
    lock = false;
    gridMode = 'pads';
  }
  gesture = null;
  Object.keys(recordedValues).forEach((k) => delete recordedValues[k]);
  render();
  $('#lcdState').textContent = audio.playing ? 'PLAY' : recording ? 'REC ARMED' : 'READY';
  status(
    recording
      ? 'REC: press Space — recording starts after a four-beat count-in; while stopped, taps only audition'
      : 'Recording off · back to step editing',
  );
  if (recording && wasPlaying) play();
};

function confirmPattern(message) {
  return new Promise((resolve) => {
    const d = document.createElement('dialog');
    d.className = 'patternConfirm';
    const p = document.createElement('p');
    p.textContent = message;
    const cancel = document.createElement('button'),
      ok = document.createElement('button');
    cancel.textContent = 'CANCEL';
    ok.textContent = 'CONFIRM';
    d.append(p, cancel, ok);
    document.body.append(d);
    const finish = (value) => {
      d.close();
      d.remove();
      resolve(value);
    };
    cancel.onclick = () => finish(false);
    ok.onclick = () => finish(true);
    d.oncancel = (e) => {
      e.preventDefault();
      finish(false);
    };
    d.showModal();
    cancel.focus();
  });
}
let clearedPattern = null;
$('#clearPattern').onclick = async () => {
  const target = pattern;
  if (
    !(await confirmPattern(
      `Clear all notes and parameter locks in Pattern ${'ABCD'[target]}?\nPlayback will stop. Sounds, other patterns and Kit are kept.`,
    ))
  )
    return;
  releaseHold();
  stop();
  clearedPattern = { index: target, data: structuredClone(project.patterns[target]) };
  project.patterns[target] = Array.from({ length: 16 }, () =>
    Array.from({ length: 16 }, () => ({ on: false, locks: {} })),
  );
  lock = false;
  gridMode = 'sequence';
  step = 0;
  save();
  render();
  $('#undoClear').disabled = false;
  status(`Pattern ${'ABCD'[target]} cleared. Undo available until refresh.`);
};
$('#undoClear').onclick = async () => {
  if (!clearedPattern) return;
  if (
    !(await confirmPattern(
      `Restore Pattern ${'ABCD'[clearedPattern.index]} before clearing? New edits in this pattern will be replaced.`,
    ))
  )
    return;
  releaseHold();
  stop();
  pattern = clearedPattern.index;
  project.patterns[pattern] = clearedPattern.data;
  clearedPattern = null;
  $('#undoClear').disabled = true;
  gridMode = 'sequence';
  save();
  render();
  status('Pattern restored.');
};

// RANDOMIZE fills the current pattern with a fresh groove. Not uniform noise: each track draws
// from its role's step pool (BD/SD land on the classic grid, hats are dense, cymbals sparse),
// probabilities follow a density curve (step 0 strongest, 6 and 10 - the classic pushes - high),
// and a few tracks get a single parameter lock so the pattern isn't 16 identical hits. Any
// track that already has notes is left alone - randomize seeds an empty pattern or fills
// remaining space, it never bulldozes what you programmed.
$('#randomPattern').onclick = () => {
  const target = pattern;
  releaseHold();
  const beats = project.patterns[target];
  const rng = mulberry32((Date.now() ^ (target << 4)) >>> 0);
  // Role pools: [track indices] + per-step hit probability.
  const roles = [
    { tracks: [0], pool: [0, 4, 8, 10, 12], p: 0.75 }, // BD: the grid + the 10 push
    { tracks: [1], pool: [4, 12, 7, 14, 11], p: 0.6 }, // SD: backbeat first, ghosts rare
    { tracks: [2, 3], pool: [0, 2, 4, 6, 8, 10, 12, 14], p: 0.8 }, // hats: eighths
    { tracks: [4], pool: [4, 12], p: 0.5 }, // CP: with the snare or off it
    { tracks: [5, 6], pool: [7, 15, 6, 14], p: 0.35 }, // toms: fills
    { tracks: [7], pool: [2, 10], p: 0.3 }, // RS: off-beat ticks
    { tracks: [8, 9], pool: [3, 11, 6, 14], p: 0.4 }, // FM: syncopated color
    { tracks: [10, 11], pool: [0, 8], p: 0.3 }, // cymbals: accents only
    { tracks: [12], pool: [5, 13], p: 0.25 }, // NO: odd ticks
    { tracks: [13], pool: [0, 8], p: 0.4 }, // SUB: reinforce the low
    { tracks: [14, 15], pool: [7, 11, 15], p: 0.3 }, // PERC/MET: tail chatter
  ];
  let placed = 0;
  for (const role of roles) {
    for (const t of role.tracks) {
      const existing = beats[t].some((s) => s.on);
      if (existing) continue;
      let any = false;
      for (const stepIndex of role.pool) {
        // Density curve: strongest at step 0, a lift at the 10 push, fade toward the end.
        const curve = { 0: 1, 10: 0.9, 6: 0.7 }[stepIndex] ?? 0.55;
        if (rng() < role.p * curve) {
          const s = beats[t][stepIndex];
          s.on = true;
          s.locks = {};
          any = true;
          placed++;
        }
      }
      // One parameter lock on a random hit for a third of the seeded tracks.
      if (any && rng() < 0.33) {
        const on = beats[t].filter((s) => s.on);
        const pick = on[Math.floor(rng() * on.length)];
        const params = ['pitch', 'decay', 'drive', 'tone'];
        const param = params[Math.floor(rng() * params.length)];
        pick.locks[param] = Math.round(40 + rng() * 55);
      }
    }
  }
  save();
  render();
  status(placed ? `Pattern ${'ABCD'[target]} randomized` : 'Nothing to randomize');
};
// Tiny deterministic PRNG - same seed, same pattern; seed varies per click and per pattern slot.
function mulberry32(a) {
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let patternClipboard = null,
  patternMenu = null;
function closePatternMenu() {
  patternMenu?.remove();
  patternMenu = null;
}
$('#patterns').addEventListener('contextmenu', (e) => {
  const button = e.target.closest('[data-pattern]');
  if (!button || held) return;
  e.preventDefault();
  closePatternMenu();
  const target = +button.dataset.pattern,
    menu = document.createElement('div');
  patternMenu = menu;
  menu.className = 'patternMenu';
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Pattern ' + 'ABCD'[target]);
  const copy = document.createElement('button'),
    paste = document.createElement('button');
  copy.textContent = 'COPY PATTERN';
  paste.textContent = 'PASTE PATTERN';
  paste.disabled = !patternClipboard;
  for (const b of [copy, paste]) b.setAttribute('role', 'menuitem');
  menu.append(copy, paste);
  document.body.append(menu);
  const box = menu.getBoundingClientRect();
  menu.style.left = Math.max(4, Math.min(e.clientX, innerWidth - box.width - 4)) + 'px';
  menu.style.top = Math.max(4, Math.min(e.clientY, innerHeight - box.height - 4)) + 'px';
  copy.focus();
  copy.onclick = () => {
    patternClipboard = structuredClone(project.patterns[target]);
    closePatternMenu();
    button.focus();
    status('Pattern ' + 'ABCD'[target] + ' copied.');
  };
  paste.onclick = async () => {
    const data = structuredClone(patternClipboard);
    closePatternMenu();
    if (
      project.patterns[target].some((t) =>
        t.some((s) => s.on || Object.keys(s.locks).length || Object.keys(s.fxLocks ?? {}).length),
      ) &&
      !(await confirmPattern('Replace Pattern ' + 'ABCD'[target] + ' with the copied pattern?'))
    )
      return;
    project.patterns[target] = data;
    save();
    render();
    button.focus();
    status('Pattern ' + 'ABCD'[target] + ' pasted.');
  };
  menu.onkeydown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      closePatternMenu();
      button.focus();
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      (document.activeElement === copy && !paste.disabled ? paste : copy).focus();
    }
  };
});
document.addEventListener('pointerdown', (e) => {
  if (patternMenu && !patternMenu.contains(e.target)) closePatternMenu();
});
window.addEventListener('blur', closePatternMenu);
window.addEventListener('resize', closePatternMenu);
document.addEventListener('scroll', closePatternMenu, true);

function setTempo(value) {
  const number = Number(value);
  if (String(value).trim() !== '' && Number.isFinite(number)) {
    project.bpm = Math.max(40, Math.min(240, number));
    save();
  }
  $('#lcdTempo').value = project.bpm.toFixed(1);
}
$('#lcdTempo').onfocus = (e) => e.target.select();
$('#lcdTempo').onchange = (e) => setTempo(e.target.value);
$('#lcdTempo').onkeydown = (e) => {
  e.stopPropagation();
  if (e.key === 'Enter') {
    e.preventDefault();
    e.target.blur();
  }
  if (e.key === 'Escape') {
    e.target.value = project.bpm.toFixed(1);
    e.target.blur();
  }
};
$('#lcdTempo').addEventListener(
  'wheel',
  (e) => {
    e.preventDefault();
    setTempo(Math.round((project.bpm + (e.deltaY < 0 ? 1 : -1) * (e.shiftKey ? 0.1 : 1)) * 10) / 10);
  },
  { passive: false },
);
