import { applyLfo } from './lfo.js';
const noiseCache = new WeakMap();

// Each layer has its own envelope; the final gain is reserved for choke events.
export function drumVoice(ctx, out, engine, p, time, lfo, bpm = 120, epoch = 0) {
  const nodes = [],
    sources = [];
  const make = (type) => {
    const node = ctx[type]();
    nodes.push(node);
    return node;
  };
  const sum = make('createGain'),
    drive = make('createWaveShaper'),
    dc = make('createBiquadFilter'),
    gain = make('createGain');
  const amount = 1 + p.drive * 0.055;
  drive.curve = Float32Array.from(
    { length: 512 },
    (_, i) => Math.tanh((i / 255.5 - 1) * amount) / Math.tanh(amount),
  );
  drive.oversample = '2x';
  dc.type = 'highpass';
  dc.frequency.value = 15;
  gain.gain.value = (p.level / 100) * 0.6;
  sum.connect(drive);
  drive.connect(dc);
  dc.connect(gain);
  const lfoGain = make('createGain');
  gain.connect(lfoGain);
  lfoGain.connect(out);
  const hz = 440 * 2 ** ((p.pitch - 69) / 12),
    d = p.decay / 100;
  function envelope(destination, level, length, attack = 0.001) {
    const g = make('createGain');
    g.gain.setValueAtTime(0, time);
    g.gain.linearRampToValueAtTime(level, time + attack);
    g.gain.exponentialRampToValueAtTime(0.00001, time + Math.max(attack + 0.002, length));
    g.connect(destination);
    return g;
  }
  function osc(freq, type, level, length, destination = sum, bend = 0, sweep = 0.025) {
    const o = make('createOscillator');
    o.type = type;
    const cap = ctx.sampleRate * 0.45,
      f = Math.max(8, Math.min(cap, freq));
    o.frequency.setValueAtTime(Math.min(cap, f * (1 + bend)), time);
    o.frequency.exponentialRampToValueAtTime(f, time + sweep);
    o.connect(envelope(destination, level, length));
    sources.push({ node: o, end: time + length + 0.01 });
    return o;
  }
  function noise(level, length, type, frequency, q = 0.7) {
    if (!noiseCache.has(ctx)) {
      const buffer = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
        data = buffer.getChannelData(0);
      let seed = 785;
      for (let i = 0; i < data.length; i++) {
        seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
        data[i] = seed / 2147483648 - 1;
      }
      noiseCache.set(ctx, buffer);
    }
    const n = make('createBufferSource'),
      filter = make('createBiquadFilter');
    n.buffer = noiseCache.get(ctx);
    n.loop = true;
    filter.type = type;
    filter.frequency.value = Math.min(ctx.sampleRate * 0.45, frequency);
    filter.Q.value = q;
    n.connect(filter);
    filter.connect(envelope(sum, level, length));
    sources.push({ node: n, end: time + length + 0.01 });
  }
  let length;
  if (engine === 'kick') {
    length = 0.08 + d * d * 2;
    const body = make('createBiquadFilter');
    body.type = 'lowpass';
    body.frequency.value = 600 + p.tone * 60;
    body.connect(sum);
    const fundamental = osc(hz, 'sine', 0.9, length, body, p.sweep / 9, 0.008 + (100 - p.tone) / 1800);
    // A short harmonic layer supplies the beater; it does not lengthen the bass tail.
    osc(hz * 2, 'triangle', (p.fm / 100) * 0.3, 0.015 + d * 0.09, body, p.sweep / 18, 0.015);
    noise((p.noise / 100) * 0.6, 0.003 + p.tone / 5000, 'highpass', 1800 + p.tone * 50);
    fundamental.frequency.setValueAtTime(Math.max(8, hz), time + length);
  } else if (engine === 'snare') {
    length = 0.055 + d * d * 1.1;
    const body = make('createBiquadFilter');
    body.type = 'lowpass';
    body.frequency.value = 1300 + p.tone * 65;
    body.connect(sum);
    const mix = p.noise / 100,
      bodyLevel = 0.8 * (1 - mix * 0.8);
    osc(hz, 'triangle', bodyLevel, length * 0.52, body, p.sweep / 85, 0.014);
    osc(hz * (1.48 + p.fm / 240), 'sine', bodyLevel * 0.55, length * 0.32, body, p.sweep / 130, 0.009);
    noise(mix * 0.9, length, 'bandpass', 1100 * 2 ** (p.tone / 32), 0.45 + p.fm / 180);
    noise(0.03 + p.sweep / 900, 0.009, 'highpass', 4200);
  } else if (engine === 'hat') {
    length = 0.018 + d * d * 1.55;
    const metal = make('createBiquadFilter'),
      band = make('createBiquadFilter');
    metal.type = 'highpass';
    metal.frequency.value = 1800 + p.tone * 65;
    band.type = 'bandpass';
    band.frequency.value = Math.min(ctx.sampleRate * 0.42, 6500 + p.tone * 38);
    band.Q.value = 0.6 + p.sweep / 70;
    metal.connect(band);
    band.connect(sum);
    const fundamental = 150 + hz * 0.28,
      spread = p.fm / 100;
    [1, 1.342, 1.807, 2.413, 2.731, 3.119].forEach((r, i) =>
      osc(fundamental * (r + spread * i * 0.071), 'square', 0.16, length, metal),
    );
    noise((p.noise / 100) * 0.23, length * 0.8, 'highpass', 4000 + p.tone * 40);
  } else if (engine === 'fm') {
    length = 0.04 + d * d * 2;
    const ratio = 0.25 * 2 ** (p.tone / 20),
      filter = make('createBiquadFilter');
    filter.type = 'lowpass';
    filter.frequency.value = Math.min(ctx.sampleRate * 0.45, 14000);
    filter.connect(sum);
    const carrier = osc(hz, 'sine', 0.78, length, filter);
    const mod = make('createOscillator'),
      index = make('createGain');
    mod.frequency.value = Math.min(ctx.sampleRate * 0.45, hz * ratio);
    index.gain.setValueAtTime(hz * (p.fm / 100) ** 2 * 12, time);
    index.gain.exponentialRampToValueAtTime(0.00001, time + 0.008 + (p.sweep / 100) ** 2 * length * 1.2);
    mod.connect(index);
    index.connect(carrier.frequency);
    sources.push({ node: mod, end: time + length + 0.01 });
    noise((p.noise / 100) * 0.15, 0.012, 'highpass', 2500);
  }
  applyLfo(nodes, lfoGain, lfo, bpm, time, length, epoch);
  let remaining = sources.length;
  for (const { node, end } of sources) {
    node.onended = () => {
      if (--remaining === 0) nodes.forEach((n) => n.disconnect());
    };
    node.start(time);
    node.stop(end);
  }
  return {
    length,
    stop(at) {
      gain.gain.cancelScheduledValues(at);
      gain.gain.setValueAtTime((p.level / 100) * 0.6, at);
      gain.gain.linearRampToValueAtTime(0, at + 0.003);
      for (const s of sources) s.node.stop(Math.min(s.end, at + 0.004));
    },
  };
}
