// The Production export runs here, outside the screen, so it keeps going when you switch tabs
// and the result is waiting when you come back.
import { useSyncExternalStore } from "react";
import { takes as io, type ProductionResult } from "./bridge";

export interface ExportJob {
  scriptPath: string | null;
  running: boolean;
  /** 0..1 */
  progress: number;
  /** What it is doing now, for the button and the header. */
  stage: string;
  result: ProductionResult | null;
  short: string | null;
  error: string;
}

let job: ExportJob | null = null;
const subs = new Set<() => void>();
const emit = () => subs.forEach(f => f());

export const exportJob = {
  get: () => job,
  start(scriptPath: string | null) {
    job = { scriptPath, running: true, progress: 0, stage: "Preparing slides", result: null, short: null, error: "" };
    emit();
  },
  set(patch: Partial<ExportJob>) { if (job) { job = { ...job, ...patch }; emit(); } },
  clear() { if (job && !job.running) { job = null; emit(); } },
};

// FFmpeg progress from the main process (shared channel: only counted while the export runs).
io?.onExportProgress(x => { if (job?.running && job.stage !== "Preparing slides") { job = { ...job, progress: x }; emit(); } });

export function useExportJob(): ExportJob | null {
  return useSyncExternalStore(cb => { subs.add(cb); return () => { subs.delete(cb); }; }, () => job);
}
