import { AbsoluteFill, Img, OffthreadVideo, Sequence, interpolate, staticFile, useCurrentFrame, useVideoConfig } from "remotion";

export interface Scene { kind: "camera" | "slide"; step: number; start: number; end: number; image?: string }
export interface Cue { start: number; end: number; text: string }
export interface Timeline {
  version: 1; title: string; fps: number; width: number; height: number; seconds: number;
  video: string; scenes: Scene[]; captions: Cue[];
  sentences: { sentence: number; take: number; start: number; end: number; text: string }[];
}

// Look of the video. Change these freely.
const BUBBLE = 360;        // camera bubble size, px
const MARGIN = 56;         // bubble distance from the corner, px
const MOVE = 0.4;          // seconds for the camera to shrink into / grow out of the bubble
const SLIDE_FADE = 0.25;   // seconds for a slide to fade in
const SHOW_CAPTIONS = true;

/** 0 = camera full screen, 1 = camera in the bubble, animated around scene changes. */
function bubbleAmount(scenes: Scene[], t: number): number {
  const i = scenes.findIndex(s => t >= s.start && t < s.end);
  const s = scenes[i === -1 ? scenes.length - 1 : i];
  if (!s) return 1;
  const target = s.kind === "slide" ? 1 : 0;
  const prev = scenes[i - 1];
  if (prev && (prev.kind === "slide" ? 1 : 0) !== target) {
    const p = interpolate(t, [s.start, s.start + MOVE], [0, 1], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
    return target ? p : 1 - p;
  }
  return target;
}

export const Whiteboard = ({ timeline }: { timeline: Timeline | null }) => {
  const frame = useCurrentFrame();
  const { fps, width, height } = useVideoConfig();
  if (!timeline) return <AbsoluteFill style={{ background: "#fff" }} />;
  const t = frame / fps;
  const k = bubbleAmount(timeline.scenes, t);

  // Camera: full frame (k = 0) to a circle in the bottom-right corner (k = 1).
  const size = interpolate(k, [0, 1], [width, BUBBLE]);
  const h = interpolate(k, [0, 1], [height, BUBBLE]);
  const left = interpolate(k, [0, 1], [0, width - BUBBLE - MARGIN]);
  const top = interpolate(k, [0, 1], [0, height - BUBBLE - MARGIN]);
  const radius = interpolate(k, [0, 1], [0, BUBBLE / 2]);
  const cue = SHOW_CAPTIONS ? timeline.captions.find(c => t >= c.start && t < c.end) : undefined;

  return (
    <AbsoluteFill style={{ background: "#fff" }}>
      {timeline.scenes.map((s, i) =>
        s.kind === "slide" && s.image ? (
          <Sequence key={i} from={Math.round(s.start * fps)} durationInFrames={Math.max(1, Math.round((s.end - s.start) * fps))}>
            <SlideImage src={staticFile(s.image)} />
          </Sequence>
        ) : null,
      )}
      <div style={{ position: "absolute", left, top, width: size, height: h, borderRadius: radius, overflow: "hidden",
        boxShadow: k > 0.5 ? "0 0 0 8px #fff, 0 6px 24px rgba(0,0,0,.35)" : "none" }}>
        {/* The cut is 16:9; object-fit cover centres the face inside the circle. */}
        <OffthreadVideo src={staticFile(timeline.video)} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      {cue && (
        <div style={{ position: "absolute", left: 0, right: 0, bottom: 24, display: "flex", justifyContent: "center" }}>
          <span style={{ background: "rgba(0,0,0,.72)", color: "#fff", font: "600 36px Arial, sans-serif", padding: "6px 18px", borderRadius: 8, maxWidth: width - 640 }}>
            {cue.text}
          </span>
        </div>
      )}
    </AbsoluteFill>
  );
};

const SlideImage = ({ src }: { src: string }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const opacity = interpolate(frame, [0, SLIDE_FADE * fps], [0, 1], { extrapolateRight: "clamp" });
  return <AbsoluteFill style={{ opacity }}><Img src={src} style={{ width: "100%", height: "100%", objectFit: "contain" }} /></AbsoluteFill>;
};
