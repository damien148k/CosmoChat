// Étape 2 : le spectrogramme.
// Le temps défile horizontalement, la fréquence monte verticalement (grave en bas),
// la couleur dit l'intensité. C'est l'image que l'on peut montrer à un modèle
// capable de voir, pour qu'il repère lui-même les motifs.

import { spectrum, WINDOW, SAMPLE_RATE } from "./analysis.js";

const COLS = 360;   // colonnes gardées (≈ 17 s à une colonne par 46 ms)
const ROWS = 128;   // bandes de fréquence (échelle log, 40 Hz → 10 kHz)

export class Spectrogram {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.off = document.createElement("canvas");
    this.off.width = COLS; this.off.height = ROWS;
    this.octx = this.off.getContext("2d");
    this.octx.fillStyle = "#000"; this.octx.fillRect(0, 0, COLS, ROWS);
    this.color = [127, 216, 255];
    // Bornes des bandes, en bins de FFT, échelle logarithmique.
    const fMin = 40, fMax = 10000;
    this.bands = [];
    for (let r = 0; r <= ROWS; r++) {
      const f = fMin * Math.pow(fMax / fMin, r / ROWS);
      this.bands.push(Math.max(1, Math.min(WINDOW / 2 - 1, Math.round((f / SAMPLE_RATE) * WINDOW))));
    }
    this.column = this.octx.createImageData(1, ROWS);
  }

  setColor(hex) {
    const n = parseInt(hex.slice(1), 16);
    this.color = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  /** Ajoute une colonne à partir d'une fenêtre d'échantillons. */
  push(samples, offset) {
    const sp = spectrum(samples, offset);
    const d = this.column.data;
    const [cr, cg, cb] = this.color;
    for (let r = 0; r < ROWS; r++) {
      let e = 0, lo = this.bands[r], hi = Math.max(this.bands[r] + 1, this.bands[r + 1]);
      for (let b = lo; b < hi; b++) e = Math.max(e, sp[b]);
      // dB → 0..1 ; la fenêtre de Hann et l'amplitude ≤ 1 donnent un max ≈ (N/4)²
      const db = 10 * Math.log10(e / (WINDOW * WINDOW / 16) + 1e-12);
      const v = Math.max(0, Math.min(1, (db + 75) / 75));
      const y = ROWS - 1 - r;
      const k = y * 4;
      // Palette : noir → couleur de l'astre → blanc
      const t = v < 0.6 ? v / 0.6 : 1, w = v < 0.6 ? 0 : (v - 0.6) / 0.4;
      d[k] = cr * t + (255 - cr) * w;
      d[k + 1] = cg * t + (255 - cg) * w;
      d[k + 2] = cb * t + (255 - cb) * w;
      d[k + 3] = 255;
    }
    this.octx.drawImage(this.off, 1, 0, COLS - 1, ROWS, 0, 0, COLS - 1, ROWS);
    this.octx.putImageData(this.column, COLS - 1, 0);
  }

  draw() {
    const { canvas, ctx } = this;
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth, h = canvas.clientHeight;
    if (!w || !h) return;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) { canvas.width = w * dpr; canvas.height = h * dpr; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.off, 0, 0, w, h);
    // Repères de fréquence
    ctx.font = "10px ui-monospace, monospace";
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (const f of [100, 1000, 10000]) {
      const r = (Math.log(f / 40) / Math.log(10000 / 40)) * ROWS;
      const y = h - (r / ROWS) * h;
      ctx.fillRect(0, y, 14, 1);
      ctx.fillText(f >= 1000 ? `${f / 1000}k` : `${f}`, 18, y + 3);
    }
  }

  /** Image compacte (JPEG, base64) à envoyer à un modèle qui voit. */
  toImage() {
    const c = document.createElement("canvas");
    c.width = 480; c.height = 240;
    const x = c.getContext("2d");
    x.imageSmoothingEnabled = false;
    x.drawImage(this.off, 0, 0, c.width, c.height);
    x.font = "12px sans-serif";
    x.fillStyle = "#fff";
    x.fillText("temps →", c.width - 60, c.height - 6);
    x.save(); x.translate(12, 70); x.rotate(-Math.PI / 2); x.fillText("fréquence ↑", 0, 0); x.restore();
    return c.toDataURL("image/jpeg", 0.7).split(",")[1];
  }
}
