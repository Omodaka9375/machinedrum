// LINK: transport + tempo sync between MACHINEDRUM tabs in the SAME browser, via
// BroadcastChannel — no MIDI, no server, no driver. Same origin (the deployed app, or two
// localhost tabs) is the platform's own restriction, and it is what makes this safe to use
// with zero pairing.
//
// Protocol (all messages {type, ...payload}):
//   hello  — posted on connect; any linked tab that is playing answers with state
//   state  {bpm, playing} — the answer; an idle tab that receives a playing state adopts it
//   tempo  {bpm} — a user tempo edit, followers adopt
//   play   {bpm} — a tab started; idle followers start too (sounds/patterns stay local)
//   stop   — a tab stopped; playing followers stop
//
// The app decides what "adopt" means (app.js); this module is only the wire. BroadcastChannel
// is touched nowhere at import time — the constructor is resolved inside connect(), so the
// pure tests can inject a fake and a bare import stays navigator-free.

/** @typedef {{ type: string, bpm?: number, playing?: boolean }} LinkMessage */

/**
 * @param {{ onEvent?: (m: LinkMessage) => void, onStatus?: (connected: boolean, extra?: string) => void,
 *   Channel?: (() => { postMessage: (m: object) => void, close: () => void,
 *     onmessage: ((e: { data: LinkMessage }) => void) | null }) | null }} [opts]
 *   Channel: factory for the underlying channel — injectable for tests; null forces the
 *   "unsupported" path even where a global exists.
 */
export function createLink({ onEvent, onStatus, Channel } = {}) {
  /** @typedef {{ postMessage: (m: object) => void, close: () => void, onmessage: ((e: { data: LinkMessage }) => void) | null }} Wire */
  const Ctor =
    Channel !== undefined
      ? Channel
      : typeof BroadcastChannel === 'function'
        ? () => /** @type {Wire} */ (new BroadcastChannel('ferro-link'))
        : null;
  /** @type {Wire | null} */
  let channel = null;
  return {
    get connected() {
      return !!channel;
    },
    connect() {
      if (channel) return true;
      if (!Ctor) {
        onStatus?.(false, 'not supported in this browser');
        return false;
      }
      const wire = Ctor();
      wire.onmessage = (e) => {
        const m = e.data;
        if (m && typeof m.type === 'string') onEvent?.(m);
      };
      // Ask the room for its state: a playing tab answers, an idle one stays quiet —
      // joining never starts anyone's transport by itself.
      wire.postMessage({ type: 'hello' });
      channel = wire;
      onStatus?.(true);
      return true;
    },
    disconnect() {
      if (!channel) return;
      channel.onmessage = null;
      channel.close();
      channel = null;
      onStatus?.(false);
    },
    /** Fire-and-forget; a no-op when not connected (e.g. between a toggle and its click). */
    post(/** @type {LinkMessage} */ msg) {
      channel?.postMessage(msg);
    },
  };
}