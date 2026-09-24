export const defaultLfo = () => ({
  wave: 0,
  target: 0,
  speed: 35,
  depth: 0,
  phase: 0,
  sync: 0,
  reset: 0,
  on: 1,
});
export function migrateLfo(p) {
  p.tracks.forEach((t) => (t.lfo = { ...defaultLfo(), ...t.lfo }));
  p.savedKit?.forEach((t) => (t.lfo = { ...defaultLfo(), ...t.lfo }));
}
export function lfoRate(l, bpm) {
  return l.sync ? bpm / 60 / [0, 0.25, 0.5, 1, 2, 4, 8][l.sync] : 0.05 * 400 ** (l.speed / 100);
}
export function waveAt(p, w) {
  p = ((p % 1) + 1) % 1;
  return w === 1
    ? 1 - 4 * Math.abs(p - 0.5)
    : w === 2
      ? p < 0.5
        ? 1
        : -1
      : w === 3
        ? 2 * p - 1
        : Math.sin(p * Math.PI * 2);
}
export function applyLfo(nodes, level, l, bpm, time, length, epoch = 0) {
  if (!l?.on || !l.depth) return;
  const rate = lfoRate(l, bpm),
    phase = l.phase / 100 + (l.reset ? 0 : (time - epoch) * rate),
    depth = l.depth / 100;
  const size = Math.max(2, Math.ceil(length * 160) + 1),
    curve = Float32Array.from({ length: size }, (_, i) => {
      const v = waveAt(phase + (i / (size - 1)) * length * rate, l.wave);
      return l.target === 1 ? 1 - depth * 0.5 + v * depth * 0.5 : v * depth * (l.target === 0 ? 1200 : 2400);
    });
  const targets =
    l.target === 1
      ? [level.gain]
      : nodes
          .filter(
            (n) =>
              n.detune && (l.target === 0 ? typeof n.start === 'function' : typeof n.start !== 'function'),
          )
          .map((n) => n.detune);
  for (const p of targets) p.setValueCurveAtTime(curve, time, length);
}
