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
  }));
}
export function demo() {
  const patterns = Array.from({ length: 4 }, () =>
    Array.from({ length: 16 }, () => Array.from({ length: 16 }, () => ({ on: false, locks: {} }))),
  );
  for (let p = 0; p < 4; p++) {
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

export function storeKit(project) {
  project.savedKit = project.tracks.map(({ engine, choke, p, send, lfo }) => ({
    lfo: clone(lfo),
    engine,
    choke: choke ?? 0,
    p: clone(p),
    send: clone(send ?? { delay: 0, reverb: 0 }),
  }));
  project.savedFx = clone(project.fx);
}
export function reloadKit(project) {
  project.savedKit.forEach((sound, i) => Object.assign(project.tracks[i], clone(sound)));
  if (project.savedFx) project.fx = clone(project.savedFx);
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
