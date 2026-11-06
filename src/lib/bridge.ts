// Access to the Electron main process (see electron/preload.cjs).
// In a plain browser (npm run web) these fall back to a file picker and in-memory saving.

export interface OpenedScript { path: string | null; name: string; content: string }

interface Bridge {
  openScript(): Promise<OpenedScript | null>;
  saveScript(path: string, content: string): Promise<boolean>;
}

declare global { interface Window { teleprompter?: Bridge } }

export const inElectron = typeof window !== "undefined" && !!window.teleprompter;

export async function openScript(): Promise<OpenedScript | null> {
  if (window.teleprompter) return window.teleprompter.openScript();
  return new Promise(resolve => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".md,.txt";
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: null, name: f.name, content: await f.text() } : null);
    };
    input.click();
  });
}

export async function saveScript(path: string | null, content: string): Promise<boolean> {
  if (path && window.teleprompter) return window.teleprompter.saveScript(path, content);
  return false; // browser mode: kept in memory only
}
