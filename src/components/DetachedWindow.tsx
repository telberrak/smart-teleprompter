import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";

/**
 * Renders its children in a separate window (same app, same state: a React portal into a
 * window.open() popup). The app's styles are copied in. Closing the window calls onClosed.
 */
export function DetachedWindow({ title, onClosed, children }: { title: string; onClosed: () => void; children: ReactNode }) {
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const closed = useRef(onClosed);
  closed.current = onClosed;
  const win = useRef<Window | null>(null);

  useEffect(() => {
    const w = window.open("", `onscreen-${Date.now()}`, "width=1280,height=760");
    if (!w) { closed.current(); return; }
    win.current = w;
    const d = w.document;
    d.head.innerHTML = "";
    document.querySelectorAll('style, link[rel="stylesheet"]').forEach(n => d.head.appendChild(n.cloneNode(true)));
    d.body.className = "detached-body";
    d.body.innerHTML = "";
    const el = d.createElement("div");
    el.className = "detached";
    d.body.appendChild(el);
    setRoot(el);
    let leaving = false;
    const gone = () => { if (!leaving) closed.current(); };
    w.addEventListener("pagehide", gone);
    // The main window closing or reloading takes this one with it.
    const bye = () => w.close();
    window.addEventListener("beforeunload", bye);
    return () => {
      leaving = true;
      w.removeEventListener("pagehide", gone);
      window.removeEventListener("beforeunload", bye);
      w.close();
      win.current = null;
      setRoot(null);
    };
  }, []);

  useEffect(() => { if (win.current) win.current.document.title = title; }, [title, root]);

  return root ? createPortal(children, root) : null;
}
