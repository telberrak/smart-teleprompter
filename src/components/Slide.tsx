import { memo, useMemo } from "react";
import rough from "roughjs";
import type { ExElement, Frame } from "../lib/excalidraw";

const gen = rough.generator();

// Excalidraw font ids → local font stacks (1 Virgil and 5 Excalifont are hand-drawn).
export const FONTS: Record<number, string> = {
  1: "Caveat, 'Segoe Print', cursive", 5: "Caveat, 'Segoe Print', cursive",
  2: "Helvetica, Arial, sans-serif", 6: "Nunito, 'Segoe UI', sans-serif",
  3: "'Cascadia Code', Consolas, monospace", 8: "'Comic Sans MS', cursive",
};
// Caveat runs narrower than Virgil; scale it up a little so text fills its box.
export const FONT_SCALE: Record<number, number> = { 1: 1.18, 5: 1.18 };

export type Path = { d: string; stroke: string; strokeWidth: number; fill?: string };

function opts(e: ExElement) {
  const fill = e.backgroundColor && e.backgroundColor !== "transparent" ? e.backgroundColor : undefined;
  return {
    seed: e.seed ?? 1,
    roughness: e.roughness ?? 1,
    stroke: e.strokeColor ?? "#1e1e1e",
    strokeWidth: e.strokeWidth ?? 2,
    fill,
    fillStyle: e.fillStyle ?? "hachure",
    hachureGap: (e.strokeWidth ?? 2) * 4,
    strokeLineDash: e.strokeStyle === "dashed" ? [12, 8] : e.strokeStyle === "dotted" ? [3, 6] : undefined,
    preserveVertices: true,
  };
}

function roundedRect(x: number, y: number, w: number, h: number) {
  const r = Math.min(w, h) * 0.25, rr = Math.min(r, 32);
  return `M${x + rr} ${y} L${x + w - rr} ${y} Q${x + w} ${y} ${x + w} ${y + rr} L${x + w} ${y + h - rr} Q${x + w} ${y + h} ${x + w - rr} ${y + h} L${x + rr} ${y + h} Q${x} ${y + h} ${x} ${y + h - rr} L${x} ${y + rr} Q${x} ${y} ${x + rr} ${y}`;
}

function arrowhead(pts: [number, number][], atEnd: boolean, size: number): [number, number][][] {
  const n = pts.length;
  const [tip, prev] = atEnd ? [pts[n - 1], pts[n - 2]] : [pts[0], pts[1]];
  const a = Math.atan2(tip[1] - prev[1], tip[0] - prev[0]);
  const len = Math.min(size, Math.hypot(tip[0] - prev[0], tip[1] - prev[1]) * 0.6);
  const wing = (s: number): [number, number] => [tip[0] - len * Math.cos(a + s), tip[1] - len * Math.sin(a + s)];
  return [[wing(0.45), tip, wing(-0.45)]];
}

export function shapes(e: ExElement): Path[] {
  const o = opts(e);
  const ds = [] as ReturnType<typeof gen.rectangle>[];
  switch (e.type) {
    case "rectangle":
      ds.push(e.roundness ? gen.path(roundedRect(e.x, e.y, e.width, e.height), o) : gen.rectangle(e.x, e.y, e.width, e.height, o));
      break;
    case "ellipse":
      ds.push(gen.ellipse(e.x + e.width / 2, e.y + e.height / 2, e.width, e.height, o));
      break;
    case "diamond": {
      const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
      ds.push(gen.polygon([[cx, e.y], [e.x + e.width, cy], [cx, e.y + e.height], [e.x, cy]], o));
      break;
    }
    case "line": case "arrow": case "freedraw": {
      const pts = (e.points ?? []).map(([px, py]) => [e.x + px, e.y + py] as [number, number]);
      if (pts.length < 2) break;
      const lineOpts = { ...o, fill: e.type === "line" && pts.length > 2 && o.fill ? o.fill : undefined };
      if (e.type === "freedraw") ds.push(gen.linearPath(pts, { ...lineOpts, roughness: 0 }));
      else if (e.roundness && pts.length > 2) ds.push(gen.curve(pts, lineOpts));
      else ds.push(gen.linearPath(pts, lineOpts));
      if (e.type === "arrow") {
        const size = 15 + (e.strokeWidth ?? 2) * 5;
        if (e.endArrowhead) for (const h of arrowhead(pts, true, size)) ds.push(gen.linearPath(h, { ...o, fill: undefined }));
        if (e.startArrowhead) for (const h of arrowhead(pts, false, size)) ds.push(gen.linearPath(h, { ...o, fill: undefined }));
      }
      break;
    }
  }
  return ds.flatMap(d => gen.toPaths(d) as Path[]);
}

function Text({ e }: { e: ExElement }) {
  const fam = e.fontFamily ?? 1;
  const size = (e.fontSize ?? 20) * (FONT_SCALE[fam] ?? 1);
  const lh = (e.lineHeight ?? 1.25) * (e.fontSize ?? 20);
  const lines = (e.text ?? "").split("\n");
  const anchor = e.textAlign === "center" ? "middle" : e.textAlign === "right" ? "end" : "start";
  const x = e.textAlign === "center" ? e.x + e.width / 2 : e.textAlign === "right" ? e.x + e.width : e.x;
  const top = e.y + (e.height - lines.length * lh) / 2;
  return (
    <text x={x} textAnchor={anchor} fontFamily={FONTS[fam] ?? FONTS[1]} fontSize={size} fill={e.strokeColor ?? "#1e1e1e"}>
      {lines.map((l, i) => <tspan key={i} x={x} y={top + lh * i + lh * 0.78}>{l}</tspan>)}
    </text>
  );
}

/** One Excalidraw frame drawn in the hand-drawn style. */
export const Slide = memo(function Slide({ frame }: { frame: Frame }) {
  const els = useMemo(() => frame.elements.map(e => ({ e, paths: e.type === "text" ? [] : shapes(e) })), [frame]);
  return (
    <svg viewBox={`${frame.x} ${frame.y} ${frame.width} ${frame.height}`} role="img" aria-label={frame.name} style={{ background: "#fff" }}>
      {els.map(({ e, paths }) => {
        const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
        return (
          <g key={e.id} opacity={(e.opacity ?? 100) / 100} transform={e.angle ? `rotate(${(e.angle * 180) / Math.PI} ${cx} ${cy})` : undefined}>
            {e.type === "text" ? <Text e={e} /> : paths.map((p, i) => (
              <path key={i} d={p.d} stroke={p.stroke} strokeWidth={p.strokeWidth} fill={p.fill ?? "none"} strokeLinecap="round" strokeLinejoin="round" />
            ))}
          </g>
        );
      })}
    </svg>
  );
});
