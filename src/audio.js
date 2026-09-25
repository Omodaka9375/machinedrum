import { applyLfo } from './lfo.js';
import { Effects, stepFx } from './fx.js';
import { drumVoice, holdAt } from './drums.js';
import { resolved, duration, recordHit } from './model.js';
const buffers = new WeakMap();
export function voice(ctx, out, engine, p, time, lfo, bpm = 120, epoch = 0) {
  if (['kick', 'snare', 'hat', 'fm'].includes(engine))
    return drumVoice(ctx, out, engine, p, time, lfo, bpm, epoch);
  const f = 440 * 2 ** ((p.pitch - 69) / 12),
    length = 0.025 + (p.decay / 100) ** 2 * 1.8;
  const amp = ctx.createGain(),
    filter = ctx.createBiquadFilter(),
    shape = ctx.createWaveShaper();
  filter.type = 'lowpass';
  filter.frequency.value = Math.min(19000, 180 * 2 ** (p.tone / 15));
  filter.Q.value = 0.7;
  const amount = 1 + p.drive * 0.1;
  shape.curve = Float32Array.from(
    { length: 512 },
    (_, i) => Math.tanh((i / 255.5 - 1) * amount) / Math.tanh(amount),
  );
  amp.gain.setValueAtTime(0, time);
  amp.gain.linearRampToValueAtTime((p.level / 100) * 0.42, time + 0.002);
  amp.gain.exponentialRampToValueAtTime(0.0001, time + length);
  filter.connect(shape);
  shape.connect(amp);
  const lfoGain = ctx.createGain();
  amp.connect(lfoGain);
  lfoGain.connect(out);
  const nodes = [filter, shape, amp, lfoGain],
    sources = [];
  function tone(freq, level, type = 'sine', bend = 0, fm = 0) {
    const o = ctx.createOscillator(),
      g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(15, freq * (1 + bend)), time);
    o.frequency.exponentialRampToValueAtTime(Math.max(15, freq), time + 0.008 + length * 0.16);
    g.gain.value = level;
    o.connect(g);
    g.connect(filter);
    nodes.push(o, g);
    sources.push(o);
    if (fm) {
      const m = ctx.createOscillator(),
        mg = ctx.createGain();
      m.frequency.value = freq * (1 + p.tone / 16);
      mg.gain.setValueAtTime(freq * fm, time);
      mg.gain.exponentialRampToValueAtTime(0.01, time + length);
      m.connect(mg);
      mg.connect(o.frequency);
      nodes.push(m, mg);
      sources.push(m);
    }
  }
  function noise(level) {
    if (!buffers.has(ctx)) {
      const b = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate),
        d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      buffers.set(ctx, b);
    }
    const n = ctx.createBufferSource(),
      g = ctx.createGain();
    n.buffer = buffers.get(ctx);
    n.loop = true;
    g.gain.value = level;
    n.connect(g);
    g.connect(filter);
    nodes.push(n, g);
    sources.push(n);
    if (engine === 'clap') {
      g.gain.setValueAtTime(0, time);
      for (let k = 0; k < 3; k++) {
        g.gain.setValueAtTime(level, time + k * 0.012);
        g.gain.linearRampToValueAtTime(0.01, time + k * 0.012 + 0.009);
      }
      g.gain.setValueAtTime(level * 0.65, time + 0.038);
    }
  }
  if (engine === 'tom') tone(f, 1, 'sine', p.sweep / 14, p.fm / 55);
  else if (engine === 'rim') {
    tone(f, 0.65, 'triangle', p.sweep / 50);
    tone(f * 2.73, 0.3, 'sine');
  }
  noise((p.noise / 100) * (engine === 'clap' || engine === 'noise' ? 0.9 : 0.2));
  applyLfo(nodes, lfoGain, lfo, bpm, time, length, epoch);
  for (const s of sources) {
    s.start(time);
    s.stop(time + length + 0.04);
  }
  sources[0].onended = () => nodes.forEach((n) => n.disconnect());
  return {
    length,
    stop(at) {
      envStop(at);
    },
  };
  function envStop(at) {
    // Same helper as drums.js: hold the envelope's real level, not the nominal peak.
    holdAt(amp.gain, at, (p.level / 100) * 0.42);
    amp.gain.linearRampToValueAtTime(0, at + 0.003);
    for (const s of sources) s.stop(Math.min(time + length + 0.04, at + 0.004));
  }
}
export class Audio {
  constructor(get, onStep) {
    this.get = get;
    this.onStep = onStep;
    this.playing = false;
    this.events = [];
    this.pattern = 0;
    this.pending = null;
    this.generation = 0;
    this.chokes = new Map();
    this.timeline = [];
    this.skipHits = [];

    // Created lazily in init(), which must run on a user gesture. Declared here so the types exist
    // for readers that run before or after it.
    /** @type {AudioContext | null} */
    this.ctx = null;
    /** @type {GainNode | null} */
    this.master = null;
    /** @type {GainNode | null} */
    this.metronome = null;
    /** @type {DynamicsCompressorNode | null} */
    this.comp = null;
    /** @type {AnalyserNode | null} */
    this.analyser = null;
    /** @type {import('./fx.js').Effects | null} */
    this.effects = null;

    // Hooks assigned from app.js — this class cannot reach UI state directly.
    /** @type {(() => boolean) | null} */
    this.isRecording = null;
    /** @type {((n: number) => void) | null} */
    this.onCount = null;
    /** @type {((position: any) => void) | null} */
    this.beforeStep = null;
    // MIDI hooks: sequencer fires afterStep per triggered track; one-shot auditions fire
    // onAudition. Assigned from app.js; the class itself stays MIDI-agnostic.
    /** @type {((step: number, track: number, playing: boolean) => void) | null} */
    this.afterStep = null;
    /** @type {((track: number) => void) | null} */
    this.onAudition = null;
  }
  async init() {
    if (!this.ctx) {
      if (navigator.audioSession) navigator.audioSession.type = 'playback';
      this.ctx = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.ctx.createGain();
      this.metronome = this.ctx.createGain();
      this.metronome.gain.value = 0;
      this.metronome.connect(this.master);
      this.comp = this.ctx.createDynamicsCompressor();
      this.comp.threshold.value = -10;
      this.comp.ratio.value = 8;
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 512;
      this.effects = new Effects(this.ctx, this.master);
      this.master.connect(this.comp);
      this.comp.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);
    }
    await this.ctx.resume();
    this.effects.update(this.get());
    this.master.gain.setTargetAtTime(this.get().master / 100, this.ctx.currentTime, 0.01);
  }
  async audition(track, step, velocity) {
    await this.init();
    const p = this.get();
    if (!this.playing)
      this.effects.update(
        stepFx(
          { ...p, patterns: [p.tracks.map((t) => [t === track ? { ...step, on: true } : { on: false }])] },
          0,
          0,
        ),
      );
    this.trigger(track, step, this.ctx.currentTime + 0.005, velocity);
    // Only the track index is reported: this is the live-hit path, where the step index is
    // whatever the last transport tick happened to leave on `this.step` — undefined before the
    // first play(). The one consumer (app.js, MIDI note-out) only wants the note to send.
    this.onAudition?.(this.get().tracks.indexOf(track));
  }
  trigger(track, step, at, velocity) {
    const group = track.choke ?? 0;
    if (group) this.chokes.get(group)?.stop(at);
    // Velocity (MIDI): a value in 0..1 scales the resolved level for this one hit.
    const params = resolved(track, step);
    const p =
      velocity === undefined || !Number.isFinite(velocity) || velocity < 0 || velocity > 1
        ? params
        : { ...params, level: Math.max(0, Math.min(100, Math.round((params.level ?? 58) * velocity))) };
    const v = voice(
      this.ctx,
      this.effects.inputs[this.get().tracks.indexOf(track)].input,
      track.engine,
      p,
      at,
      track.lfo,
      this.get().bpm,
      this.lfoEpoch ?? 0,
    );
    if (group) this.chokes.set(group, v);
    return v;
  }
  click(at, accent) {
    const o = this.ctx.createOscillator(),
      g = this.ctx.createGain();
    o.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.16, at);
    g.gain.exponentialRampToValueAtTime(0.0001, at + 0.06);
    o.connect(g);
    g.connect(this.metronome);
    o.start(at);
    o.stop(at + 0.07);
    o.onended = () => {
      o.disconnect();
      g.disconnect();
    };
  }
  async start(pattern, countIn = false) {
    const token = ++this.generation;
    clearInterval(this.clock);
    await this.init();
    if (token !== this.generation) return;
    this.playing = true;
    this.pattern = pattern;
    this.pending = null;
    this.timeline = [];
    this.skipHits = [];
    this.step = 0;
    this.next = this.ctx.currentTime + 0.015;
    this.lfoEpoch = this.next + (countIn ? (4 * 60) / this.get().bpm : 0);
    this.counting = countIn;
    this.metronome.gain.value = countIn ? 1 : 0;
    if (countIn) {
      const beat = 60 / this.get().bpm;
      for (let i = 0; i < 4; i++) {
        const at = this.next + i * beat;
        this.click(at, i === 0);
        this.events.push({ time: at, count: 4 - i });
      }
      this.next += 4 * beat;
      this.countEnd = this.next;
    }
    this.clock = setInterval(() => this.schedule(), 20);
    this.schedule();
  }
  position(quantized = true) {
    const now = this.ctx.currentTime,
      next = {
        time: this.next,
        step: this.step,
        pattern: this.step === 0 ? (this.pending ?? this.pattern) : this.pattern,
      };
    if (!quantized) return [...this.timeline].reverse().find((p) => p.time <= now) ?? next;
    return [...this.timeline, next].reduce(
      (best, p) => (Math.abs(p.time - now) < Math.abs(best.time - now) ? p : best),
      next,
    );
  }
  liveHit(index, velocity) {
    const p = this.get(),
      position = this.position(p.quantize !== false),
      s = recordHit(p, position, index),
      t = p.tracks[index],
      now = this.ctx.currentTime;
    s.offset = p.quantize === false ? Math.max(0, (now - position.time) / (60 / p.bpm / 4)) : 0;
    if (position.time > now) {
      position.voices?.[index]?.stop(now);
      this.skipHits.push({ time: position.time, index });
    }
    if (!t.mute) this.trigger(t, s, now + 0.003, velocity);
    return position;
  }
  schedule() {
    const p = this.get();
    while (this.next < this.ctx.currentTime + 0.07) {
      if (this.step === 0 && this.pending !== null) {
        this.pattern = this.pending;
        this.pending = null;
      }
      if (this.isRecording?.() && this.step % 4 === 0) this.click(this.next, this.step === 0);
      const event = { time: this.next, step: this.step, pattern: this.pattern, voices: [] };
      this.beforeStep?.(event);
      this.effects?.update(stepFx(p, this.pattern, this.step), this.next);
      p.tracks.forEach((t, i) => {
        const s = p.patterns[this.pattern][i][this.step];
        if (
          s.on &&
          !t.mute &&
          !this.skipHits.some((h) => h.index === i && Math.abs(h.time - this.next) < 0.000001)
        ) {
          event.voices[i] = this.trigger(t, s, this.next + ((s.offset ?? 0) * 60) / p.bpm / 4);
          this.afterStep?.(this.step, i, this.playing);
        }
      });
      this.events.push(event);
      this.timeline.push(event);
      if (this.timeline.length > 32) this.timeline.shift();
      this.skipHits = this.skipHits.filter((h) => h.time > this.next);
      this.next += duration(p.bpm, p.swingEnabled === false ? 0 : p.swing, this.step);
      this.step = (this.step + 1) % 16;
    }
  }
  tick() {
    if (!this.ctx) return;
    if (this.counting && this.ctx.currentTime >= this.countEnd) this.counting = false;
    while (this.events.length && this.events[0].time <= this.ctx.currentTime) {
      const event = this.events.shift();
      if (event.count) this.onCount?.(event.count);
      else this.onStep(event);
    }
  }
  stop() {
    this.generation++;
    clearInterval(this.clock);
    this.playing = false;
    this.counting = false;
    this.events = [];
    this.pending = null;
    this.chokes.clear();
    this.timeline = [];
    this.skipHits = [];
    if (this.ctx) {
      this.ctx.close();
      this.ctx = null;
    }
    this.onStep({ step: -1, pattern: this.pattern });
  }
}
