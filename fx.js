export const defaultFx = () => ({ time: 300, feedback: 35, delay: 30, room: 1.5, reverb: 25 });
export function migrateFx(p) {
  p.fx = { ...defaultFx(), ...p.fx };
  p.tracks.forEach((t) => {
    t.send = { delay: 0, reverb: 0, ...t.send };
  });
  if (p.savedKit) {
    p.savedKit.forEach((t) => {
      t.send = { delay: 0, reverb: 0, ...t.send };
    });
    p.savedFx ??= { ...p.fx };
  }
}
export class Effects {
  constructor(ctx, out) {
    this.ctx = ctx;
    this.delay = ctx.createDelay(2);
    this.feedback = ctx.createGain();
    this.echo = ctx.createGain();
    this.reverb = ctx.createConvolver();
    this.wet = ctx.createGain();
    this.feedback.gain.value = 0;
    this.echo.gain.value = 0;
    this.wet.gain.value = 0;
    this.delay.delayTime.value = 0.3;
    this.delay.connect(this.feedback);
    this.feedback.connect(this.delay);
    this.delay.connect(this.echo);
    this.echo.connect(out);
    this.reverb.connect(this.wet);
    this.wet.connect(out);
    this.inputs = Array.from({ length: 16 }, () => {
      const input = ctx.createGain(),
        d = ctx.createGain(),
        r = ctx.createGain();
      d.gain.value = 0;
      r.gain.value = 0;
      input.connect(out);
      input.connect(d);
      input.connect(r);
      d.connect(this.delay);
      r.connect(this.reverb);
      return { input, d, r };
    });
  }
  update(p, at) {
    const c = this.ctx,
      t = at ?? c.currentTime,
      f = p.fx;
    this.delay.delayTime.setTargetAtTime(f.time / 1000, t, 0.03);
    this.feedback.gain.setTargetAtTime(f.feedback / 100, t, 0.02);
    this.echo.gain.setTargetAtTime(f.delay / 100, t, 0.02);
    this.wet.gain.setTargetAtTime(f.reverb / 100, t, 0.02);
    p.tracks.forEach((track, i) => {
      this.inputs[i].d.gain.setTargetAtTime(track.send.delay / 100, t, 0.02);
      this.inputs[i].r.gain.setTargetAtTime(track.send.reverb / 100, t, 0.02);
    });
    if (this.room !== f.room) {
      this.room = f.room;
      const b = c.createBuffer(2, Math.ceil(c.sampleRate * f.room), c.sampleRate);
      let seed = 123;
      for (let ch = 0; ch < 2; ch++) {
        const a = b.getChannelData(ch);
        for (let i = 0; i < a.length; i++) {
          seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
          a[i] = (seed / 2147483648 - 1) * Math.pow(1 - i / a.length, 2.5);
        }
      }
      this.reverb.buffer = b;
    }
  }
}

export function stepFx(p, pattern, step) {
  const fx = { ...p.fx },
    tracks = p.tracks.map((t) => ({ send: { ...t.send } }));
  p.tracks.forEach((t, i) => {
    const s = p.patterns[pattern][i][step];
    if (t.mute || !s.on) return;
    for (const [key, value] of Object.entries(s.fxLocks ?? {})) {
      if (key === 'sendDelay') tracks[i].send.delay = value;
      else if (key === 'sendReverb') tracks[i].send.reverb = value;
      else if (['time', 'feedback', 'delay', 'reverb'].includes(key)) fx[key] = value;
    }
  });
  return { fx, tracks };
}
