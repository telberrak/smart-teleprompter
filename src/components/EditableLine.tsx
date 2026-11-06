import { useEffect, useRef, useState } from "react";

/** A textarea for editing one sentence with its markup (**stress**, /). Enter saves, Esc cancels. */
export function EditableLine({ value, onSave, onCancel }: { value: string; onSave: (v: string) => void; onCancel: () => void }) {
  const [text, setText] = useState(value);
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.focus(); el.setSelectionRange(el.value.length, el.value.length);
  }, []);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    el.style.height = "auto"; el.style.height = el.scrollHeight + "px";
  }, [text]);
  const commit = () => { const v = text.replace(/\s+/g, " ").trim(); if (v && v !== value) onSave(v); else onCancel(); };
  return (
    <textarea
      ref={ref}
      value={text}
      rows={1}
      aria-label="Edit sentence"
      onChange={e => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={e => {
        if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commit(); }
        if (e.key === "Escape") { e.preventDefault(); onCancel(); }
        e.stopPropagation();
      }}
    />
  );
}
