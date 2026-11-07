// Camera + microphone recording with MediaRecorder, streamed to disk by the main process.
import type { TakesBridge } from "./bridge";

export interface Mark { sentence: number; start: number; end?: number; text: string }

export async function openCamera(cameraId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    video: {
      deviceId: cameraId ? { exact: cameraId } : undefined,
      width: { ideal: 1920 }, height: { ideal: 1080 }, frameRate: { ideal: 30 },
    },
  });
}

/** Audio for the recording itself: untouched (no noise suppression or auto gain). */
async function openRecordingMic(micId?: string): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { deviceId: micId ? { exact: micId } : undefined, echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 },
  });
}

function pickType(video: boolean): string {
  const prefs = video
    ? ["video/webm;codecs=vp9,opus", "video/webm;codecs=vp8,opus", "video/webm"]
    : ["audio/webm;codecs=opus", "audio/webm"];
  return prefs.find(t => MediaRecorder.isTypeSupported(t)) ?? "";
}

export interface Take {
  file: string;
  take: number;
  /** Seconds since recording started. */
  elapsed(): number;
  /** Stop, flush to disk and write the sidecar JSON. */
  stop(meta: Record<string, unknown>): Promise<{ file: string; json: string; bytes: number } | null>;
}

export async function startTake(io: TakesBridge, opts: { scriptPath: string | null; camera: MediaStream | null; micId?: string }): Promise<Take> {
  const mic = await openRecordingMic(opts.micId);
  const tracks = [...(opts.camera?.getVideoTracks() ?? []), ...mic.getAudioTracks()];
  const stream = new MediaStream(tracks);
  const video = !!opts.camera?.getVideoTracks().length;
  const mimeType = pickType(video);
  const rec = new MediaRecorder(stream, { mimeType, videoBitsPerSecond: 8_000_000, audioBitsPerSecond: 192_000 });
  const { id, file, take } = await io.begin(opts.scriptPath);

  // Write chunks in order, one at a time.
  let chain: Promise<unknown> = Promise.resolve();
  rec.ondataavailable = e => {
    if (!e.data.size) return;
    chain = chain.then(async () => io.chunk(id, await e.data.arrayBuffer()));
  };
  const t0 = performance.now();
  const startedAt = new Date().toISOString();
  rec.start(1000);

  return {
    file, take,
    elapsed: () => (performance.now() - t0) / 1000,
    async stop(meta) {
      const done = new Promise<void>(r => { rec.onstop = () => r(); });
      if (rec.state !== "inactive") rec.stop();
      await done;
      await chain;
      mic.getTracks().forEach(t => t.stop()); // the camera stays open for the preview
      return io.end(id, { startedAt, seconds: +((performance.now() - t0) / 1000).toFixed(2), mimeType, ...meta });
    },
  };
}
