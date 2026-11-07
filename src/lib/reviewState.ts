// Review choices (which read each sentence uses, locks, hidden reads), shared by Review and Production.
// Saved next to the takes (review.json) so they survive closing the app; localStorage is a fallback.
import { useCallback, useEffect, useRef, useState } from "react";
import { takes as io } from "./bridge";
import { emptyReview, type ReviewState } from "./edit";

const key = (scriptPath: string | null) => "tp.review:" + scriptPath;

function fromStorage(scriptPath: string | null): ReviewState {
  try {
    const v = localStorage.getItem(key(scriptPath));
    if (v) return { ...emptyReview(), ...JSON.parse(v) };
    const old = localStorage.getItem("tp.picks:" + scriptPath); // before review.json
    if (old) return { ...emptyReview(), picks: JSON.parse(old) };
  } catch { /* private window */ }
  return emptyReview();
}

export function useReview(scriptPath: string | null) {
  const [state, setState] = useState<ReviewState>(() => fromStorage(scriptPath));
  const [ready, setReady] = useState(!io);
  const path = useRef(scriptPath);
  useEffect(() => {
    path.current = scriptPath;
    setReady(false);
    const local = fromStorage(scriptPath);
    setState(local);
    if (!io) { setReady(true); return; }
    let gone = false;
    io.getReview(scriptPath)
      .then(r => { if (!gone && r) setState({ ...emptyReview(), ...r, picks: r.picks ?? {}, hidden: r.hidden ?? [] }); })
      .catch(() => { /* keep the local copy */ })
      .finally(() => { if (!gone) setReady(true); });
    return () => { gone = true; };
  }, [scriptPath]);
  const update = useCallback((f: (s: ReviewState) => ReviewState) => {
    setState(prev => {
      const next = f(prev);
      try { localStorage.setItem(key(path.current), JSON.stringify(next)); } catch { /* private window */ }
      void io?.setReview(path.current, next).catch(() => { /* saved locally */ });
      return next;
    });
  }, []);
  return { review: state, update, ready };
}
