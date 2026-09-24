export class LinkClock {
  constructor(onState, onTransport) {
    this.onState = onState;
    this.onTransport = onTransport;
    this.sync = false;
    this.ready = false;
    this.anchor = null;
    this.ws = null;
    this.peers = 0;
  }
  beatAt(time = performance.now()) {
    return this.anchor.beat + ((time - this.anchor.time) * this.anchor.bpm) / 60000;
  }
  audioTime(beat, ctx) {
    const time = this.anchor.time + ((beat - this.anchor.beat) * 60000) / this.anchor.bpm,
      stamp = ctx.getOutputTimestamp?.();
    return stamp?.performanceTime > 0
      ? stamp.contextTime + (time - stamp.performanceTime) / 1000
      : ctx.currentTime + (time - performance.now()) / 1000 - (ctx.outputLatency ?? ctx.baseLatency ?? 0);
  }
  send(data) {
    if (this.ws?.readyState === 1) this.ws.send(JSON.stringify(data));
  }
  connect() {
    if (this.ws) return;
    this.onState('CONNECTING');
    const ws = (this.ws = new WebSocket('ws://127.0.0.1:19876'));
    ws.onopen = () => {
      this.send({ type: 'sync', enabled: this.sync });
      this.ping();
      this.timer = setInterval(() => {
        if (this.last && performance.now() - this.last > 2000) {
          ws.close();
          return;
        }
        this.ping();
      }, 100);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      if (m.type !== 'state') return;
      const now = performance.now(),
        rtt = now - m.echo;
      if (rtt < 0 || rtt > 300) return;
      const first = !this.ready;
      this.last = now;
      this.anchor = { beat: m.beat, bpm: m.bpm, time: m.echo + rtt / 2 };
      this.ready = true;
      this.peers = m.peers;
      const changed = this.remotePlaying !== undefined && this.remotePlaying !== m.playing;
      this.remotePlaying = m.playing;
      this.onState('LINK ' + m.peers, m.bpm, first);
      if (changed && this.sync) this.onTransport(m.playing);
    };
    ws.onclose = () => {
      clearInterval(this.timer);
      this.timer = null;
      this.ws = null;
      this.ready = false;
      this.anchor = null;
      this.remotePlaying = undefined;
      this.onState('LINK OFF');
    };
    ws.onerror = () => this.onState('START BRIDGE');
  }
  ping() {
    this.send({ type: 'ping', time: performance.now() });
  }
  disconnect() {
    this.ws?.close();
  }
  setSync(on) {
    this.sync = on;
    this.send({ type: 'sync', enabled: on });
  }
  transport(playing) {
    if (this.sync) {
      this.remotePlaying = playing;
      this.send({ type: 'transport', playing });
    }
  }
}
