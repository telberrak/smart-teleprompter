// Slide pictures for the final video: each diagram step drawn to a 1920x1080 PNG on a canvas.
// Canvas uses the page's own loaded fonts (Caveat for hand-drawn text), so pictures match the app.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { Frame } from "./excalidraw";
import type { Script } from "./script";
import type { SlideView } from "../components/ScreenCard";
import { FONTS, FONT_SCALE, shapes } from "../components/Slide";
import { Diagram } from "../components/Diagram";

import { W, H, fitFrame } from "./slideLayout";
export { W, H };

function canvas(w = W, h = H) {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const ctx = c.getContext("2d")!;
  return { c, ctx };
}

const png = (c: HTMLCanvasElement) =>
  new Promise<Uint8Array>((res, rej) => c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error("Could not draw the slide"))), "image/png"));

async function fontsReady() {
  try { await Promise.all([document.fonts.load("40px Caveat"), document.fonts.load("700 40px Caveat")]); } catch { /* offline: fallback fonts */ }
}

/** One Excalidraw frame, fitted inside 1920x1080 on white. */
export function drawFrame(ctx: CanvasRenderingContext2D, frame: Frame, w = W, h = H) {
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h);
  const { s, ox, oy } = fitFrame(frame, w, h);
  ctx.save();
  ctx.translate(ox, oy);
  ctx.scale(s, s);
  ctx.translate(-frame.x, -frame.y);
  ctx.beginPath(); ctx.rect(frame.x, frame.y, frame.width, frame.height); ctx.clip();
  for (const e of frame.elements) {
    ctx.save();
    ctx.globalAlpha = (e.opacity ?? 100) / 100;
    if (e.angle) {
      const cx = e.x + e.width / 2, cy = e.y + e.height / 2;
      ctx.translate(cx, cy); ctx.rotate(e.angle); ctx.translate(-cx, -cy);
    }
    if (e.type === "text") {
      const fam = e.fontFamily ?? 1;
      const size = (e.fontSize ?? 20) * (FONT_SCALE[fam] ?? 1);
      const lh = (e.lineHeight ?? 1.25) * (e.fontSize ?? 20);
      const lines = (e.text ?? "").split("\n");
      ctx.font = `${size}px ${FONTS[fam] ?? FONTS[1]}`;
      ctx.fillStyle = e.strokeColor ?? "#1e1e1e";
      ctx.textAlign = e.textAlign === "center" ? "center" : e.textAlign === "right" ? "right" : "left";
      ctx.textBaseline = "alphabetic";
      const x = e.textAlign === "center" ? e.x + e.width / 2 : e.textAlign === "right" ? e.x + e.width : e.x;
      const top = e.y + (e.height - lines.length * lh) / 2;
      lines.forEach((l, i) => ctx.fillText(l, x, top + lh * i + lh * 0.78));
    } else {
      ctx.lineCap = "round"; ctx.lineJoin = "round";
      for (const p of shapes(e)) {
        const path = new Path2D(p.d);
        if (p.fill && p.fill !== "none") { ctx.fillStyle = p.fill; ctx.fill(path); }
        if (p.stroke && p.stroke !== "none") { ctx.strokeStyle = p.stroke; ctx.lineWidth = p.strokeWidth; ctx.stroke(path); }
      }
    }
    ctx.restore();
  }
  ctx.restore();
}

const DIAGRAM_CSS = `.d-ink{stroke:#1e1e1e;fill:none;stroke-width:2.2;stroke-linecap:round;stroke-linejoin:round}
.d-txt{font-family:Caveat,'Segoe Print',cursive;fill:#1e1e1e}.d-step.off{opacity:.08}.d-step.ghost{opacity:.18}
.d-fill-a{fill:#ffd8a8;stroke:none}.d-fill-b{fill:#a5d8ff;stroke:none}.d-fill-c{fill:#b2f2bb;stroke:none}`;

/** The bundled sample's drawn diagram (an SVG), as a picture. */
async function drawDiagram(ctx: CanvasRenderingContext2D, step: number) {
  const svg = renderToStaticMarkup(createElement(Diagram, { upTo: step }))
    .replace("<svg ", `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" preserveAspectRatio="xMidYMid meet" `)
    .replace(/(<svg[^>]*>)/, `$1<style>${DIAGRAM_CSS}</style><rect x="-1000" y="-1000" width="3000" height="3000" fill="#fff"/>`);
  const img = new Image();
  img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
  await img.decode();
  ctx.drawImage(img, 0, 0, W, H);
}

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = []; let line = "";
  for (const w of text.split(/\s+/)) {
    const t = line ? line + " " + w : w;
    if (line && ctx.measureText(t).width > max) { out.push(line); line = w; } else line = t;
  }
  if (line) out.push(line);
  return out;
}

/** No slide for this step: the ON SCREEN note as a clean title card. */
function drawNote(ctx: CanvasRenderingContext2D, script: Script, step: number) {
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, H);
  const s = script.sentences.find(x => x.step === step);
  const text = s?.screen || script.title;
  ctx.fillStyle = "#1e1e1e"; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.font = `700 84px Caveat, 'Segoe Print', cursive`;
  const lines = wrap(ctx, text, W - 320);
  lines.forEach((l, i) => ctx.fillText(l, W / 2, H / 2 + (i - (lines.length - 1) / 2) * 100));
}

/** PNG of what the viewer sees at `step`: the matching slide, the sample diagram, or the note. */
export async function stepPng(script: Script, view: SlideView, step: number): Promise<Uint8Array> {
  await fontsReady();
  const { c, ctx } = canvas();
  const fi = view.frameForStep.get(step);
  if (view.slides && fi !== undefined && fi >= 0) drawFrame(ctx, view.slides.frames[fi]);
  else if (!view.slides && script.title === "1.3 What is an API?") await drawDiagram(ctx, step);
  else drawNote(ctx, script, step);
  return png(c);
}

/** Round camera bubble: an alpha mask (white circle on black) and a ring drawn around it. */
export async function bubblePngs(size: number): Promise<{ mask: Uint8Array; ring: Uint8Array }> {
  const m = canvas(size, size);
  m.ctx.fillStyle = "#000"; m.ctx.fillRect(0, 0, size, size);
  m.ctx.fillStyle = "#fff"; m.ctx.beginPath(); m.ctx.arc(size / 2, size / 2, size / 2 - 1, 0, Math.PI * 2); m.ctx.fill();
  const r = canvas(size, size);
  r.ctx.strokeStyle = "#fff"; r.ctx.lineWidth = 8;
  r.ctx.shadowColor = "rgba(0,0,0,.35)"; r.ctx.shadowBlur = 6;
  r.ctx.beginPath(); r.ctx.arc(size / 2, size / 2, size / 2 - 5, 0, Math.PI * 2); r.ctx.stroke();
  return { mask: await png(m.c), ring: await png(r.c) };
}
