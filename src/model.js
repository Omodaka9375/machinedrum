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
// Factory stereo field (−100…100, 0 = center): the kit ships spread so the machine sounds
// three-dimensional from the first beat. Practice, not gimmick — the low-end anchors (BD,
// SUB) and the snare stay CENTER (mono low end keeps its punch; the BD/SD backbone reads
// straight down the middle), while everything else answers across the sides: hats pair
// left/right, the tom rack spreads like a real kit, and the chatter (CB, NO, PERC, MET)
// lives out on the edges where it can sparkle without crowding the center. The LFO's PAN
// destination sweeps AROUND wherever this places a voice.
export const factoryPans = [
  //  BD  SD  CH  OH  CP  LT  HT  RS FM1 FM2  CB  CY  NO SUB PERC MET
  0, 0, -18, 22, 10, -38, 38, -26, 18, -14, 44, -34, 40, 0, -46, 30,
];
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
    pan: factoryPans[i],
  }));
}
export const emptyPattern = () =>
  Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => ({ on: false, locks: {} })));
export function demo() {
  const patterns = Array.from({ length: 8 }, emptyPattern);
  // Eight hand-crafted starting grooves — each slot is a distinct feel, not a variation of
  // the last. Track order: 0 BD · 1 SD · 2 CH · 3 OH · 4 CP · 5 LT · 6 HT · 7 RS ·
  // 8 FM1 · 9 FM2 · 10 CB · 11 CY · 12 NO · 13 SUB · 14 PERC · 15 MET.
  const grooves = [
    {
      // A — the four-on-the-floor starter every manual example builds on.
      name: 'A',
      beats: [
        [0, 4, 8, 12], // BD straight quarters
        [4, 12], // SD backbeat
        [0, 2, 4, 6, 8, 10, 12, 14], // CH eighths
        [7, 15], // OH off-beat stabs
        [12], // CP tail
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
      ],
      locks: { 8: { 6: { pitch: 76, decay: 45, fm: 86 }, 14: { pitch: 47, decay: 60, drive: 65 } }, 0: { 10: { pitch: 47, decay: 15 } } },
    },
    {
      // B — broken-beat house: the kick dodges the grid, hats swing the off-eighths.
      name: 'B',
      beats: [
        [0, 3, 6, 10, 11], // BD skips — the broken pocket
        [4, 12], // SD backbeat
        [2, 6, 10, 14], // CH off-eighths
        [7], // OH gasp
        [12],
        [],
        [],
        [5, 13],
        [3, 11],
        [],
        [],
        [],
        [8],
        [],
        [7, 15],
        [],
      ],
      locks: { 8: { 3: { pitch: 64, decay: 38, fm: 72 } }, 0: { 6: { pitch: 45, decay: 22 } } },
    },
    {
      // C — half-time trap skeleton: slow head-nod, rolls on the hats.
      name: 'C',
      beats: [
        [0, 10], // BD sparse
        [8], // SD single half-time crack
        [0, 2, 4, 6, 8, 10, 12, 14], // CH steady
        [12], // OH after the crack
        [],
        [6], // LT roll
        [7], // HT roll
        [11],
        [],
        [4, 13],
        [],
        [],
        [],
        [],
        [],
        [],
      ],
      locks: { 2: { 5: { prob: 55 }, 13: { prob: 55 } }, 8: { 6: { pitch: 69, decay: 30, fm: 90 } } },
    },
    {
      // D — electro / Miami: tight machine-gun hats, syncopated FM bass.
      name: 'D',
      beats: [
        [0, 8], // BD two anchors
        [4, 12], // SD claps
        [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // CH full sixteenths
        [14], // OH release
        [4, 12],
        [],
        [],
        [2, 6, 10, 14],
        [3, 7, 11, 15], // FM1 sixteen-syncopation
        [6, 14],
        [],
        [],
        [],
        [],
        [5, 13],
        [],
      ],
      locks: { 8: { 3: { pitch: 70, decay: 50, fm: 88 }, 7: { pitch: 58, decay: 44, fm: 76 } }, 2: { 5: { prob: 45 } } },
    },
    {
      // E — dub / steppers: space, rim shots, one-deep bass.
      name: 'E',
      beats: [
        [0, 4, 8, 12], // BD steppers
        [7], // SD off
        [0, 4, 8, 12], // CH on the quarters
        [],
        [],
        [10],
        [],
        [2, 6, 10, 14], // RS skank
        [],
        [14],
        [],
        [],
        [5, 11], // NO wash
        [0, 8], // SUB
        [],
        [],
      ],
      locks: { 2: { 8: { prob: 40 } }, 12: { 5: { prob: 60 } }, 8: { 6: { pitch: 40, decay: 70 } } },
    },
    {
      // F — jungle: half-time snare over tangled breakbeat kick.
      name: 'F',
      beats: [
        [0, 5, 10, 13], // BD tangle
        [4, 12], // SD layer
        [2, 6, 10, 14], // CH
        [7, 15],
        [8],
        [3, 11], // LT
        [9], // HT
        [1, 13],
        [4, 12],
        [7],
        [],
        [],
        [6],
        [0],
        [11],
        [],
      ],
      locks: { 2: { 10: { prob: 50 }, 14: { prob: 60 } }, 8: { 4: { pitch: 72, decay: 26, fm: 80 } } },
    },
    {
      // G — industrial four: driving, metronomic, walls of NO.
      name: 'G',
      beats: [
        [0, 2, 4, 6, 8, 10, 12, 14], // BD pumping eighths
        [4, 12],
        [0, 4, 8, 12],
        [],
        [4, 12], // CP doubled
        [],
        [],
        [],
        [2, 10],
        [6, 14],
        [],
        [],
        [0, 4, 8, 12], // NO on the quarters
        [0, 8],
        [],
        [4, 12], // MET hammer
      ],
      locks: { 8: { 2: { pitch: 66, decay: 34, drive: 70 } }, 12: { 8: { prob: 65 } } },
    },
    {
      // H — ambient sketch: no drums, only the noise/perc texture to build on.
      name: 'H',
      beats: [
        [],
        [],
        [],
        [],
        [],
        [],
        [],
        [4, 12],
        [],
        [],
        [0, 8],
        [],
        [0, 6, 10, 14],
        [],
        [2, 9],
        [],
      ],
      locks: { 12: { 6: { prob: 35 }, 14: { prob: 45 } }, 8: { 6: { pitch: 52, decay: 85, fm: 40 } } },
    },
  ];
  for (const g of grooves) {
    g.beats.forEach((a, t) => a.forEach((s) => (patterns[grooves.indexOf(g)][t][s].on = true)));
    for (const [t, steps] of Object.entries(g.locks ?? {}))
      for (const [s, l] of Object.entries(steps)) Object.assign(patterns[grooves.indexOf(g)][+t][+s], l);
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
