// Access to the Electron main process (see electron/preload.cjs).
// In a plain browser (npm run web) these fall back to file pickers and in-memory saving.

export interface OpenedFile { path: string | null; name: string; content: string }
export interface OpenedScript extends OpenedFile { slides?: OpenedFile | null }

interface Bridge {
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
