export const names = [
  'BD',
  'SD',
  'CH',
  'OH',
  'CP',
  'LT',
  'HT',
  'RS',
  'FM1',
  'FM2',
  'CB',
  'CY',
  'NO',
  'SUB',
  'PERC',
  'MET',
];
export const engines = ['kick', 'snare', 'hat', 'clap', 'tom', 'rim', 'fm', 'noise'];
export const params = ['pitch', 'decay', 'tone', 'sweep', 'noise', 'fm', 'drive', 'level'];
export const labels = ['PITCH', 'DECAY', 'TONE', 'SWEEP', 'NOISE', 'FM', 'DRIVE', 'LEVEL'];
export const clone = (x) => structuredClone(x);
export function kit() {
  const kinds = [
    'kick',
    'snare',
    'hat',
    'hat',
    'clap',
    'tom',
    'tom',
    'rim',
    'fm',
    'fm',
    'fm',
    'hat',
    'noise',
    'kick',
    'rim',
    'fm',
  ];
  const pitches = [35, 53, 82, 74, 57, 43, 55, 74, 59, 66, 79, 91, 60, 23, 63, 86];
  // Factory FX routing: sends tuned so the wet path is audible the moment play starts.
  // Echo on the hats, rim and sparse percussion; room on the snare, clap, cymbal and noise.
  // Kick and SUB stay dry on purpose — low end drowned in reverb loses its punch.
  const sends = [
    //      BD  SD  CH  OH  CP  LT  HT  RS FM1 FM2  CB  CY  NO SUB PERC MET
    { delay: 0, reverb: 0 }, //   BD
    { delay: 0, reverb: 32 }, //  SD
    { delay: 16, reverb: 0 }, //  CH
    { delay: 22, reverb: 0 }, //  OH
    { delay: 0, reverb: 26 }, //  CP
    { delay: 0, reverb: 0 }, //   LT
    { delay: 0, reverb: 0 }, //   HT
    { delay: 30, reverb: 18 }, // RS
    { delay: 18, reverb: 0 }, //  FM1
    { delay: 0, reverb: 20 }, //  FM2
    { delay: 0, reverb: 0 }, //   CB
    { delay: 0, reverb: 38 }, //  CY
    { delay: 0, reverb: 28 }, //  NO
    { delay: 0, reverb: 0 }, //   SUB
    { delay: 34, reverb: 22 }, // PERC
    { delay: 24, reverb: 0 }, //  MET
  ];
  return kinds.map((engine, i) => ({
    engine,
    mute: false,
    choke: i === 2 || i === 3 ? 1 : 0,
    p: {
      pitch: pitches[i],
      decay: [36, 24, 8, 46, 27, 34, 27, 10, 24, 19, 18, 65, 32, 57, 14, 42][i],
      tone: engine === 'kick' ? 36 : 76,
      sweep: engine === 'kick' ? 72 : 22,
      noise: engine === 'snare' ? 76 : engine === 'hat' || engine === 'clap' || engine === 'noise' ? 92 : 10,
      fm: engine === 'fm' ? 67 : 12,
      drive: 18,
      level: i < 2 ? 86 : 58,
    },
    send: sends[i],
  }));
}
export const emptyPattern = () =>
  Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => ({ on: false, locks: {} })));
export function demo() {
  const patterns = Array.from({ length: 8 }, emptyPattern);
  for (let p = 0; p < 8; p++) {
    const beats = [
      [0, 4, 8, 10, 12],
      [4, 12],
      [0, 2, 4, 6, 8, 10, 12, 14],
      [7, 15],
      [12],
      [14],
      [],
      [3, 11],
      [1, 6, 9, 14],
      [7, 15],
      [],
      [],
      [],
      [],
      [],
      [],
    ];
    beats.forEach((a, t) => a.forEach((s) => (patterns[p][t][s].on = true)));
    if (p % 2) {
      patterns[p][0][10].on = false;
      patterns[p][1][15].on = true;
      patterns[p][8][3].on = true;
    }
    if (p > 1) {
      patterns[p][5][6].on = true;
      patterns[p][6][15].on = true;
    }
    if (p > 3) {
      // The E–H slots add their own tier so the second half is not a carbon copy of the first.
      patterns[p][14][7].on = true;
      patterns[p][12][8].on = true;
    }
    patterns[p][8][6].locks = { pitch: 74 + p * 2, decay: 45, fm: 86 };
    patterns[p][8][14].locks = { pitch: 47, decay: 60, drive: 65 };
    patterns[p][0][10].locks = { pitch: 47, decay: 15 };
  }
  return { version: 1, bpm: 124, swing: 8, master: 65, tracks: kit(), patterns };
}
export const resolved = (track, step) => ({ ...track.p, ...step.locks });
export const duration = (bpm, swing, step) => (60 / bpm / 4) * (1 + ((step % 2 ? -1 : 1) * swing) / 100);

export const soundInfo = {
  kick: {
    name: 'BD / PUNCH',
    labels: ['PITCH', 'DECAY', 'TONE', 'SWEEP', 'CLICK', 'HARM', 'DRIVE', 'LEVEL'],
    help: 'SWEEP sets the pitch-drop depth · CLICK sets the beater transient · HARM adds short harmonics',
  },
  snare: {
    name: 'SD / WIRE',
    labels: ['PITCH', 'DECAY', 'TONE', 'SNAP', 'WIRE', 'BODY', 'DRIVE', 'LEVEL'],
    help: 'WIRE blends the buzz ratio · BODY shapes the head resonance · SNAP controls the attack hit',
  },
  hat: {
    name: 'HH / METAL',
    labels: ['PITCH', 'DECAY', 'TONE', 'RES', 'NOISE', 'METAL', 'DRIVE', 'LEVEL'],
    help: 'Six-oscillator metal · DECAY sets open / close length · tracks in the same CHOKE group cut each other off',
  },
  fm: {
    name: 'FM / ALLOY',
    labels: ['PITCH', 'DECAY', 'RATIO', 'M.DEC', 'CLICK', 'INDEX', 'DRIVE', 'LEVEL'],
    help: 'RATIO is the modulation ratio · INDEX is the modulation depth · M.DEC sets the metal overtone decay on its own',
  },
};

const isRecord = (x) => !!x && typeof x === 'object' && !Array.isArray(x);

/**
 * Structural validation for a project read back from localStorage. Checking `version` alone is
 * not enough: a save from another build can carry the same version number with a shorter or
 * differently shaped tree, and the renderer dereferences `tracks[i].p` and `step.locks`
 * unconditionally — so one missing entry becomes a throw on the first render and the user sees a
 * blank panel instead of the instrument. Rejecting anything not fully formed makes a malformed
 * payload fall back to the factory demo, which always renders.
 *
 * Fields that migrateFx()/migrateLfo() backfill (fx, send, lfo) and the genuinely optional ones
 * (choke, fxLocks, offset) are deliberately NOT required — this only checks the skeleton.
 */
export function validShapes(project) {
  if (!isRecord(project)) return false;
  for (const field of ['bpm', 'swing', 'master']) {
    if (typeof project[field] !== 'number' || !Number.isFinite(project[field])) return false;
  }
  if (!Array.isArray(project.tracks) || project.tracks.length !== names.length) return false;
  for (const t of project.tracks) {
    if (!isRecord(t) || !engines.includes(t.engine)) return false;
    if (!isRecord(t.p)) return false;
    for (const param of params) {
      if (typeof t.p[param] !== 'number' || !Number.isFinite(t.p[param])) return false;
    }
  }
  if (!Array.isArray(project.patterns) || project.patterns.length !== 8) return false;
  for (const pattern of project.patterns) {
    if (!Array.isArray(pattern) || pattern.length !== names.length) return false;
    for (const steps of pattern) {
      if (!Array.isArray(steps) || steps.length !== 16) return false;
      for (const s of steps) {
        if (!isRecord(s) || typeof s.on !== 'boolean') return false;
        if (!isRecord(s.locks)) return false;
        if (s.fxLocks !== undefined && !isRecord(s.fxLocks)) return false;
        if (s.offset !== undefined && !Number.isFinite(s.offset)) return false;
        // Play probability: optional, 0-100 integer-ish. Absent = always plays, so old
        // saves and untouched steps stay byte-identical in meaning.
        if (s.prob !== undefined && (!Number.isFinite(s.prob) || s.prob < 0 || s.prob > 100)) return false;
      }
    }
  }
  return true;
}

export function storeKit(project) {
  project.savedKit = project.tracks.map(({ engine, choke, p, send, lfo, pan }) => ({
    lfo: clone(lfo),
    engine,
    choke: choke ?? 0,
    p: clone(p),
    send: clone(send ?? { delay: 0, reverb: 0 }),
    pan: pan ?? 0,
  }));
  project.savedFx = clone(project.fx);
}
export function reloadKit(project) {
  project.savedKit.forEach((sound, i) => Object.assign(project.tracks[i], clone(sound)));
  if (project.savedFx) project.fx = clone(project.savedFx);
}
/**
 * Structural validation for a kit loaded from a DOWNLOADED file (UPLOAD). Same skeleton
 * discipline as validShapes: anything not fully formed is refused, so a truncated or
 * foreign JSON can never reach the renderer. `kind` is checked by the caller — this
 * guards only the payload the apply loop dereferences. Optional fields (choke, send,
 * lfo, pan, fx) are backfilled on apply, so only their TYPE is checked when present.
 */
export function validKit(kit) {
  if (!isRecord(kit) || !Array.isArray(kit.tracks) || kit.tracks.length !== names.length) return false;
  for (const t of kit.tracks) {
    if (!isRecord(t) || !engines.includes(t.engine)) return false;
    if (!isRecord(t.p)) return false;
    for (const param of params) {
      if (typeof t.p[param] !== 'number' || !Number.isFinite(t.p[param])) return false;
    }
    if (t.choke !== undefined && !Number.isFinite(t.choke)) return false;
    if (t.send !== undefined && (!isRecord(t.send) || !Number.isFinite(t.send.delay) || !Number.isFinite(t.send.reverb)))
      return false;
    if (t.lfo !== undefined && !isRecord(t.lfo)) return false;
    if (t.pan !== undefined && !Number.isFinite(t.pan)) return false;
  }
  if (kit.fx !== undefined && !isRecord(kit.fx)) return false;
  return true;
}
export function recordHit(project, position, track) {
  const s = project.patterns[position.pattern][track][position.step];
  s.on = true;
  return s;
}
export function recordParameter(project, position, track, param, value) {
  project.patterns[position.pattern][track][position.step].locks[param] = Math.max(
    0,
    Math.min(100, Math.round(value)),
  );
}
