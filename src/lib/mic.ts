// Microphone capture at 16 kHz mono, kept in a rolling buffer for whisper.cpp.

const RATE = 16000;
const KEEP_S = 30;

export interface Mic {
  /** The last `secs` seconds as 16-bit PCM (what whisper.cpp wants). */
  last(secs: number): Int16Array;
  /** Loudness of the last ~100 ms, 0..1. */
  level(): number;
  /** Seconds since the level was last above the speech threshold. */
  quietFor(): number;
  stop(): void;
  /** For the log: what the browser actually opened. */
  info: Record<string, unknown>;
  /** Loudest level since the last call, 0..1 (for the log). */
  peak(): number;
}

export async function startMic(deviceId?: string): Promise<Mic> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { deviceId: deviceId ? { exact: deviceId } : undefined, channelCount: 1, echoCancellation: false, noiseSuppression: true, autoGainControl: true },
  });
  // Open the context at the device's own rate (forcing 16 kHz can give silence on some
  // Windows drivers) and resample to 16 kHz ourselves.
  const ac = new AudioContext();
  const step = ac.sampleRate / RATE;
  let frac = 0;
  const src = ac.createMediaStreamSource(stream);
  // ScriptProcessor is old but needs no extra module file, and 4096 samples = 256 ms is fine here.
  const proc = ac.createScriptProcessor(4096, 1, 1);
  const ring = new Float32Array(RATE * KEEP_S);
  let write = 0, filled = 0, rms = 0, peak = 0, lastLoud = performance.now();
  proc.onaudioprocess = e => {
    const x = e.inputBuffer.getChannelData(0);
    let sum = 0;
    let added = 0;
    for (let i = 0; i < x.length; i++) sum += x[i] * x[i];
    // Linear-interpolation resampler, carrying the fractional position between buffers.
    for (; frac < x.length; frac += step) {
      const i = Math.floor(frac), t = frac - i;
      ring[write] = x[i] * (1 - t) + (x[i + 1] ?? x[i]) * t; write = (write + 1) % ring.length; added++;
    }
    frac -= x.length;
    filled = Math.min(ring.length, filled + added);
    rms = Math.sqrt(sum / x.length); peak = Math.max(peak, rms);
    if (rms > 0.006) lastLoud = performance.now();
  };
  src.connect(proc);
  // A ScriptProcessor only runs when connected to the output; route it through a muted gain.
  const mute = ac.createGain(); mute.gain.value = 0;
  proc.connect(mute); mute.connect(ac.destination);

  if (ac.state === "suspended") await ac.resume();
  const track = stream.getAudioTracks()[0];
  return {
    info: { device: track?.label, settings: track?.getSettings(), contextRate: ac.sampleRate, state: ac.state },
    peak: () => { const p = peak; peak = 0; return +p.toFixed(4); },
    last(secs) {
      const n = Math.min(filled, Math.round(secs * RATE));
      const out = new Int16Array(n);
      let r = (write - n + ring.length) % ring.length;
      for (let i = 0; i < n; i++) { const v = Math.max(-1, Math.min(1, ring[r])); out[i] = v < 0 ? v * 0x8000 : v * 0x7fff; r = (r + 1) % ring.length; }
      return out;
    },
    level: () => Math.min(1, rms * 6),
    quietFor: () => (performance.now() - lastLoud) / 1000,
    stop() {
      proc.disconnect(); src.disconnect(); mute.disconnect();
      stream.getTracks().forEach(t => t.stop());
      void ac.close();
    },
  };
}
