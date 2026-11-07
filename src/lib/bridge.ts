import type { Segment, TakeInfo } from "./edit";
import type { Timeline } from "./storyboard";
// Access to the Electron main process (see electron/preload.cjs).
// In a plain browser (npm run web) these fall back to file pickers and in-memory saving.

export interface OpenedFile { path: string | null; name: string; content: string }
export interface OpenedScript extends OpenedFile { slides?: OpenedFile | null }

export interface VoiceStatus {
  engine: boolean; engineError: string;
  model: boolean; modelPath: string; modelName: string;
  device: string; passMs: number;
  /** Chosen model id ("tiny.en", "base.en", "small.en" or "custom"), the built-in ones, and fast listening. */
  modelId: string;
  models: { id: string; label: string; mb: number; note: string; downloaded: boolean }[];
  fast: boolean;
  phase: "idle" | "downloading" | "loading" | "ready" | "error";
  progress: number; message: string;
}
export interface Heard { text: string; ms: number; error?: string }
export interface VoiceBridge {
  status(): Promise<VoiceStatus>;
  setup(): Promise<VoiceStatus>;
  pickModel(): Promise<VoiceStatus>;
  choose(id: string): Promise<VoiceStatus>;
  setFast(on: boolean): Promise<VoiceStatus>;
  log(...parts: unknown[]): Promise<void>;
  transcribe(pcm: Int16Array, prompt: string): Promise<Heard | null>;
  onState(cb: (s: VoiceStatus) => void): () => void;
}

export interface TakesBridge {
  begin(scriptPath: string | null): Promise<{ id: number; file: string; take: number }>;
  chunk(id: number, data: ArrayBuffer): Promise<boolean>;
  end(id: number, meta: unknown): Promise<{ file: string; json: string; bytes: number } | null>;
  reveal(file: string): Promise<void>;
  list(scriptPath: string | null): Promise<{ dir: string; takes: (TakeInfo & { error?: string })[] }>;
  exportCut(scriptPath: string | null, segs: Segment[], opts?: { srt?: string; burn?: boolean }): Promise<ExportResult>;
  exportWhiteboard(scriptPath: string | null, segs: Segment[], opts: WhiteboardOptions): Promise<WhiteboardResult>;
  onExportProgress(cb: (p: number) => void): () => void;
}

export interface WhiteboardOptions {
  /** Image paths in the timeline are bare names ("step-01.png"); main places them. */
  timeline: Timeline;
  images: Record<string, Uint8Array>;
  mask: Uint8Array;
  ring: Uint8Array;
  srt: string;
  captions: boolean;
  remotion: boolean;
}
export interface WhiteboardResult { file: string; seconds: number; timeline: string; remotion: string | null; remotionError: string; srt: string | null }

export interface ExportResult { file: string; seconds: number; srt?: string | null; captioned?: string | null; captionError?: string }

/** A file on disk as a URL the page can play (served by the take:// protocol). */
export const mediaUrl = (file: string) => "take://media/" + encodeURIComponent(file);

interface Bridge {
  takes: TakesBridge;
  voice: VoiceBridge;
  openScript(): Promise<OpenedScript | null>;
  openSlides(): Promise<OpenedFile | null>;
  saveScript(path: string, content: string): Promise<boolean>;
}

declare global { interface Window { teleprompter?: Bridge } }

export const inElectron = typeof window !== "undefined" && !!window.teleprompter;

function pick(accept: string): Promise<OpenedFile | null> {
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: null, name: f.name, content: await f.text() } : null);
    };
    input.click();
  });
}

/** Open a script. In the desktop app, the slides next to it (1.x-slides.excalidraw) come along. */
export async function openScript(): Promise<OpenedScript | null> {
  if (window.teleprompter) return window.teleprompter.openScript();
  return pick(".md,.txt");
}

export async function openSlides(): Promise<OpenedFile | null> {
  if (window.teleprompter) return window.teleprompter.openSlides();
  return pick(".excalidraw,.json");
}

export async function saveScript(path: string | null, content: string): Promise<boolean> {
  if (path && window.teleprompter) return window.teleprompter.saveScript(path, content);
  return false; // browser mode: kept in memory only
}

/** whisper.cpp in the desktop app; null in the browser preview. */
export const voice: VoiceBridge | null = typeof window !== "undefined" ? window.teleprompter?.voice ?? null : null;

/** Saving takes to disk in the desktop app; null in the browser preview. */
export const takes: TakesBridge | null = typeof window !== "undefined" ? window.teleprompter?.takes ?? null : null;
