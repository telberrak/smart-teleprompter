import { Composition, staticFile } from "remotion";
import { Whiteboard, type Timeline } from "./Whiteboard";

// public/timeline.json is written by Smart Teleprompter (Review > Make whiteboard video).
// Re-export from the app to refresh it; your edits in src/ are kept.
export const Root = () => (
  <Composition
    id="Whiteboard"
    component={Whiteboard}
    defaultProps={{ timeline: null as Timeline | null }}
    fps={30}
    width={1920}
    height={1080}
    durationInFrames={30}
    calculateMetadata={async () => {
      const timeline: Timeline = await fetch(staticFile("timeline.json")).then(r => r.json());
      return {
        fps: timeline.fps,
        width: timeline.width,
        height: timeline.height,
        durationInFrames: Math.max(1, Math.ceil(timeline.seconds * timeline.fps)),
        props: { timeline },
      };
    }}
  />
);
