// Titles drawn on a 1920x1080 canvas: the same drawing is the preview and the exported overlay.
import type { Brand, TitleClip } from "./production";
import type { Cue } from "./captions";

export const W = 1920, H = 1080;
const DISPLAY = "'Bricolage Grotesque', 'Segoe UI', system-ui, sans-serif";
const READ = "'Atkinson Hyperlegible', 'Segoe UI', system-ui, sans-serif";

/** Largest font size (down to min) at which text fits in maxW. */
function fit(ctx: CanvasRenderingContext2D, text: string, weight: string, family: string, size: number, maxW: number, min = 28) {
  let s = size;
  for (; s > min; s -= 2) { ctx.font = `${weight} ${s}px ${family}`; if (ctx.measureText(text).width <= maxW) break; }
  ctx.font = `${weight} ${s}px ${family}`;
  return s;
}

function round(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath();
}

/** Readable dark text on a light accent, light text otherwise. */
function inkOn(hex: string) {
  const m = /^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i.exec(hex);
  if (!m) return "#111";
  const [r, g, b] = [1, 2, 3].map(i => parseInt(m[i], 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.5 ? "#16120a" : "#ffffff";
}

/**
 * Draw one title. `k` is how far it has come in (0..1) for the slide-in animation in the
 * preview; the export draws it at k = 1 and FFmpeg fades it in and out.
 */
export function drawTitle(ctx: CanvasRenderingContext2D, t: TitleClip, brand: Brand, k = 1) {
  const accent = brand.accent || "#f4b860";
  const ease = 1 - Math.pow(1 - Math.max(0, Math.min(1, k)), 3);
  ctx.save();
  ctx.globalAlpha = ease;
  ctx.textBaseline = "alphabetic";
  switch (t.kind) {
    case "title": {
      // Lesson title, lower left over the camera: big type on a soft dark band.
      const g = ctx.createLinearGradient(0, H - 520, 0, H);
      g.addColorStop(0, "rgba(8,10,14,0)"); g.addColorStop(1, "rgba(8,10,14,.78)");
      ctx.fillStyle = g; ctx.fillRect(0, H - 520, W, 520);
      const x = 120 - (1 - ease) * 60;
      ctx.fillStyle = "#ffffff";
      fit(ctx, t.text, "700", DISPLAY, 104, W - 240, 48);
      ctx.fillText(t.text, x, H - 250);
      ctx.fillStyle = accent; ctx.fillRect(x, H - 222, 160 * ease, 10);
      if (t.sub) { ctx.fillStyle = "rgba(255,255,255,.86)"; fit(ctx, t.sub, "400", READ, 44, W - 240); ctx.fillText(t.sub, x, H - 150); }
      break;
    }
    case "lower": {
      // Name and course, lower left, with an accent bar.
      const x = 96 - (1 - ease) * 80, y = H - 330;
      ctx.font = `700 54px ${DISPLAY}`; const w1 = ctx.measureText(t.text).width;
      ctx.font = `400 36px ${READ}`; const w2 = ctx.measureText(t.sub).width;
      const w = Math.max(w1, w2) + 72;
      ctx.fillStyle = "rgba(12,15,20,.88)"; round(ctx, x, y, w, 150, 10); ctx.fill();
      ctx.fillStyle = accent; ctx.fillRect(x, y, 12, 150);
      ctx.fillStyle = "#ffffff"; ctx.font = `700 54px ${DISPLAY}`; ctx.fillText(t.text, x + 40, y + 66);
      ctx.fillStyle = "#d6dbe5"; ctx.font = `400 36px ${READ}`; ctx.fillText(t.sub, x + 40, y + 118);
      break;
    }
    case "chapter": {
      // A pill at the top centre: chapter name on the accent colour.
      fit(ctx, t.text, "700", DISPLAY, 60, W - 600);
      const tw = ctx.measureText(t.text).width;
      ctx.font = `500 30px ${READ}`; const lw = ctx.measureText("CHAPTER").width;
      const w = tw + lw + 120, x = (W - w) / 2, y = 60 - (1 - ease) * 40;
      ctx.fillStyle = accent; round(ctx, x, y, w, 100, 50); ctx.fill();
      ctx.fillStyle = inkOn(accent); ctx.globalAlpha = ease * 0.7; ctx.font = `500 30px ${READ}`; ctx.fillText("CHAPTER", x + 50, y + 62);
      ctx.globalAlpha = ease; fit(ctx, t.text, "700", DISPLAY, 60, W - 600); ctx.fillText(t.text, x + 70 + lw, y + 70);
      break;
    }
    case "term": {
      // Key term card, upper right.
      const w = 620, x = W - w - 80 + (1 - ease) * 60, y = 90;
      ctx.font = `400 34px ${READ}`;
      const words = (t.sub || "").split(/\s+/); const lines: string[] = []; let line = "";
      for (const wd of words) { const tt = line ? line + " " + wd : wd; if (line && ctx.measureText(tt).width > w - 80) { lines.push(line); line = wd; } else line = tt; }
      if (line) lines.push(line);
      const h = 150 + lines.length * 46;
      ctx.fillStyle = "rgba(255,255,255,.97)"; round(ctx, x, y, w, h, 16); ctx.fill();
      ctx.strokeStyle = accent; ctx.lineWidth = 6; round(ctx, x, y, w, h, 16); ctx.stroke();
      ctx.fillStyle = "#6b6b6b"; ctx.font = `700 26px ${READ}`; ctx.fillText("KEY TERM", x + 40, y + 52);
      ctx.fillStyle = "#16120a"; fit(ctx, t.text, "700", DISPLAY, 56, w - 80); ctx.fillText(t.text, x + 40, y + 116);
      ctx.fillStyle = "#3b3b3b"; ctx.font = `400 34px ${READ}`; lines.forEach((l, i) => ctx.fillText(l, x + 40, y + 166 + i * 46));
      break;
    }
    case "outro": {
      // Full-screen end card.
      ctx.fillStyle = "rgba(12,15,20,.9)"; ctx.fillRect(0, 0, W, H);
      ctx.textAlign = "center";
      ctx.fillStyle = accent; ctx.font = `500 34px ${READ}`; ctx.fillText("UP NEXT", W / 2, H / 2 - 110);
      ctx.fillStyle = "#ffffff"; fit(ctx, t.text, "700", DISPLAY, 96, W - 300, 48); ctx.fillText(t.text, W / 2, H / 2 + 0);
      if (t.sub) { ctx.fillStyle = "rgba(255,255,255,.75)"; fit(ctx, t.sub, "400", READ, 40, W - 300); ctx.fillText(t.sub, W / 2, H / 2 + 80); }
      break;
    }
  }
  ctx.restore();
}

/** A caption as it will look burnt in (preview only; the export uses FFmpeg's subtitles filter). */
export function drawCaption(ctx: CanvasRenderingContext2D, c: Cue, style: "clean" | "bold") {
  ctx.save();
  ctx.font = style === "bold" ? `700 50px Arial, sans-serif` : `600 46px Arial, sans-serif`;
  ctx.textAlign = "center"; ctx.textBaseline = "alphabetic";
  const w = ctx.measureText(c.text).width + 40, y = H - 46;
  if (style === "clean") { ctx.fillStyle = "rgba(0,0,0,.72)"; round(ctx, (W - w) / 2, y - 58, w, 76, 8); ctx.fill(); ctx.fillStyle = "#fff"; ctx.fillText(c.text, W / 2, y); }
  else { ctx.lineWidth = 10; ctx.strokeStyle = "#000"; ctx.lineJoin = "round"; ctx.strokeText(c.text, W / 2, y); ctx.fillStyle = "#fff"; ctx.fillText(c.text, W / 2, y); }
  ctx.restore();
}

/** One title as a transparent 1920x1080 PNG for FFmpeg to lay over the video. */
export async function titlePng(t: TitleClip, brand: Brand): Promise<Uint8Array> {
  try { await Promise.all([document.fonts.load(`700 60px 'Bricolage Grotesque'`), document.fonts.load(`400 30px 'Atkinson Hyperlegible'`)]); } catch { /* offline */ }
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  drawTitle(c.getContext("2d")!, t, brand, 1);
  return new Promise((res, rej) => c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error("Could not draw a title"))), "image/png"));
}

/** Thumbnail background (1920x1080, scaled to 1280x720 on export): the slide, a big title, room for your face. */
export async function thumbnailPng(slide: HTMLImageElement | null, title: string, brand: Brand, corner: "tl" | "tr" | "bl" | "br"): Promise<Uint8Array> {
  try { await document.fonts.load(`700 60px 'Bricolage Grotesque'`); } catch { /* offline */ }
  const c = document.createElement("canvas"); c.width = W; c.height = H;
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#ffffff"; ctx.fillRect(0, 0, W, H);
  if (slide) { ctx.globalAlpha = 0.35; ctx.drawImage(slide, 0, 0, W, H); ctx.globalAlpha = 1; }
  // Title in the half away from the face.
  const left = corner[1] === "r";
  const x = left ? 100 : W / 2 + 40, maxW = W / 2 - 140;
  ctx.fillStyle = "#16120a";
  const words = title.split(/\s+/); const lines: string[] = []; let line = "";
  ctx.font = `800 150px ${DISPLAY}`;
  for (const wd of words) { const tt = line ? line + " " + wd : wd; if (line && ctx.measureText(tt).width > maxW) { lines.push(line); line = wd; } else line = tt; }
  if (line) lines.push(line);
  const size = lines.length > 3 ? 110 : 150;
  ctx.font = `800 ${size}px ${DISPLAY}`;
  const top = H / 2 - (lines.length * size * 1.05) / 2 + size * 0.8;
  lines.forEach((l, i) => ctx.fillText(l, x, top + i * size * 1.05));
  ctx.fillStyle = brand.accent || "#f4b860"; ctx.fillRect(x, top + lines.length * size * 1.05 - size * 0.6, 220, 18);
  return new Promise((res, rej) => c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error("Could not draw the thumbnail"))), "image/png"));
}

/** The Short's header: course name and lesson title over a soft dark band, on a transparent 1080x1920. */
export async function shortHeaderPng(title: string, brand: Brand): Promise<Uint8Array> {
  try { await Promise.all([document.fonts.load(`700 60px 'Bricolage Grotesque'`), document.fonts.load(`700 30px 'Atkinson Hyperlegible'`)]); } catch { /* offline */ }
  const SW = 1080, SH = 1920;
  const c = document.createElement("canvas"); c.width = SW; c.height = SH;
  const ctx = c.getContext("2d")!;
  const g = ctx.createLinearGradient(0, 0, 0, 280);
  g.addColorStop(0, "rgba(8,10,14,.85)"); g.addColorStop(1, "rgba(8,10,14,0)");
  ctx.fillStyle = g; ctx.fillRect(0, 0, SW, 280);
  const accent = brand.accent || "#f4b860";
  ctx.textBaseline = "alphabetic";
  ctx.fillStyle = accent; ctx.font = `700 30px ${READ}`;
  ctx.fillText((brand.course || "").toUpperCase(), 60, 100);
  // Title in up to two lines, shrinking to fit.
  let size = 66, lines: string[] = [];
  for (; size >= 40; size -= 4) {
    ctx.font = `700 ${size}px ${DISPLAY}`;
    lines = []; let line = "";
    for (const wd of title.split(/\s+/)) { const tt = line ? line + " " + wd : wd; if (line && ctx.measureText(tt).width > SW - 120) { lines.push(line); line = wd; } else line = tt; }
    if (line) lines.push(line);
    if (lines.length <= 2 && lines.every(l => ctx.measureText(l).width <= SW - 120)) break;
  }
  ctx.fillStyle = "#ffffff";
  lines.slice(0, 2).forEach((l, i) => ctx.fillText(l, 60, 100 + size * 1.1 * (i + 1)));
  return new Promise((res, rej) => c.toBlob(b => (b ? b.arrayBuffer().then(a => res(new Uint8Array(a)), rej) : rej(new Error("Could not draw the Short header"))), "image/png"));
}
