// Background behind you on camera: MediaPipe's selfie segmenter finds you in each frame,
// then you are drawn over a picture (or a blurred room). Everything runs offline: the model
// ships in public/models and the WebAssembly comes from the npm package.
import { FilesetResolver, ImageSegmenter } from "@mediapipe/tasks-vision";
import wasmLoader from "@mediapipe/tasks-vision/vision_wasm_internal.js?url";
import wasmBinary from "@mediapipe/tasks-vision/vision_wasm_internal.wasm?url";

export type BgMode = "none" | "blur" | "image";
export interface BgSettings { mode: BgMode; /** Path of the picture, for mode "image". */ file?: string }

const KEY = "tp.bg";
export function loadBg(): BgSettings {
  try { const v = JSON.parse(localStorage.getItem(KEY) ?? "null"); if (v && ["none", "blur", "image"].includes(v.mode)) return v; } catch { /* private window */ }
  return { mode: "none" };
}
export function saveBg(b: BgSettings) { try { localStorage.setItem(KEY, JSON.stringify(b)); } catch { /* private window */ } }

let segmenter: Promise<ImageSegmenter> | null = null;
function getSegmenter(): Promise<ImageSegmenter> {
  if (segmenter) return segmenter;
  segmenter = (async () => {
    void FilesetResolver; // the files are bundled: no CDN lookup
    const fileset = { wasmLoaderPath: new URL(wasmLoader, document.baseURI).href, wasmBinaryPath: new URL(wasmBinary, document.baseURI).href };
    const modelAssetPath = new URL("models/selfie_segmenter_landscape.tflite", document.baseURI).href;
    const make = (delegate: "GPU" | "CPU") => ImageSegmenter.createFromOptions(fileset, {
      baseOptions: { modelAssetPath, delegate }, runningMode: "VIDEO", outputConfidenceMasks: true, outputCategoryMask: false,
    });
    try { return await make("GPU"); } catch { return make("CPU"); }
  })();
  segmenter.catch(() => { segmenter = null; });
  return segmenter;
}

export interface Backdrop {
  /** The camera with the new background: use it for the preview and the recording. */
  stream: MediaStream;
  stop(): void;
}

/**
 * Wrap a camera stream: same size and frame rate, background replaced.
 * `image` is the decoded picture for mode "image" (drawn to cover the frame).
 */
export async function withBackground(camera: MediaStream, mode: Exclude<BgMode, "none">, image?: HTMLImageElement | ImageBitmap | null): Promise<Backdrop> {
  const seg = await getSegmenter();
  const track = camera.getVideoTracks()[0];
  const set = track.getSettings();
  const W = set.width ?? 1280, H = set.height ?? 720, fps = Math.round(set.frameRate ?? 30);

  const video = document.createElement("video");
  video.muted = true; video.playsInline = true; video.srcObject = camera;
  await video.play();

  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const ctx = out.getContext("2d")!;
  const person = document.createElement("canvas"); person.width = W; person.height = H;
  const pctx = person.getContext("2d")!;
  const mask = document.createElement("canvas");
  const mctx = mask.getContext("2d")!;
  let maskData: ImageData | null = null;

  let alive = true, last = -1, handle = 0;
  const cover = (src: { width: number; height: number }) => {
    const k = Math.max(W / src.width, H / src.height), w = src.width * k, h = src.height * k;
    return [(W - w) / 2, (H - h) / 2, w, h] as const;
  };

  const frame = (now: number) => {
    if (!alive) return;
    const ts = Math.max(last + 1, Math.round(now));
    last = ts;
    try {
      const r = seg.segmentForVideo(video, ts);
      const m = r.confidenceMasks?.[0];
      if (m) {
        if (mask.width !== m.width || mask.height !== m.height) { mask.width = m.width; mask.height = m.height; maskData = mctx.createImageData(m.width, m.height); }
        const conf = m.getAsFloat32Array(), px = maskData!.data;
        // Soft edge: below 0.3 is room, above 0.7 is you, in between fades.
        for (let i = 0; i < conf.length; i++) { const a = (conf[i] - 0.3) / 0.4; px[i * 4 + 3] = a <= 0 ? 0 : a >= 1 ? 255 : a * 255; }
        mctx.putImageData(maskData!, 0, 0);
      }
      r.close();
    } catch { /* keep the previous mask */ }

    // You, cut out by the (smoothed, scaled-up) mask.
    pctx.globalCompositeOperation = "copy";
    pctx.filter = "blur(3px)";
    pctx.drawImage(mask, 0, 0, W, H);
    pctx.filter = "none";
    pctx.globalCompositeOperation = "source-in";
    pctx.drawImage(video, 0, 0, W, H);
    pctx.globalCompositeOperation = "source-over";

    // The background, then you on top.
    if (mode === "image" && image) { ctx.drawImage(image, ...cover(image)); }
    else { ctx.filter = "blur(18px)"; ctx.drawImage(video, -20, -20, W + 40, H + 40); ctx.filter = "none"; }
    ctx.drawImage(person, 0, 0);
    schedule();
  };
  const schedule = () => {
    if (!alive) return;
    if ("requestVideoFrameCallback" in video) handle = video.requestVideoFrameCallback(n => frame(n));
    else handle = requestAnimationFrame(frame);
  };
  schedule();

  const stream = out.captureStream(fps);
  return {
    stream,
    stop() {
      alive = false;
      if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(handle); else cancelAnimationFrame(handle);
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    },
  };
}
