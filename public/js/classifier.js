// Étape 4 : un détecteur qui apprend.
// Un petit réseau de neurones (une couche cachée) s'entraîne dans le navigateur
// à reconnaître le type de signal à partir des mesures de analysis.js.
// Ses exemples : des signaux synthétisés par signal.js, dont on connaît la nature.
// Ensuite, il donne son avis sur n'importe quel signal, y compris un vrai enregistrement.

import { SignalState, SignalGenerator } from "./signal.js";
import { analyse, features, FEATURE_COUNT, SAMPLE_RATE } from "./analysis.js";

const STORE_KEY = "cosmos-chat:detector:v2";
const HIDDEN = 16;
const SAMPLE_SECONDS = 1.5;

export const CLASSES = [
  { kind: "pulse", label: "pulsar", desc: "battements d'horloge" },
  { kind: "burst", label: "sursaut radio", desc: "éclairs brefs et dispersés" },
  { kind: "hiss", label: "bruit thermique", desc: "souffle uniforme" },
  { kind: "drone", label: "étoile bourdonnante", desc: "harmoniques et sursauts" },
  { kind: "chorus", label: "tempête magnétique", desc: "craquements et sifflements" },
  { kind: "abyss", label: "trou noir", desc: "grondement grave" },
  { kind: "whistle", label: "sifflement d'anneaux", desc: "glissements mélodiques" },
  { kind: "murmur", label: "murmure de planète", desc: "porteuse faible et instable" },
  { kind: "song", label: "chant de comète", desc: "gazouillis modulé" },
];

const rand = () => (Math.random() * 2 - 1) * 0.3;

export class Detector {
  constructor() {
    this.ready = false;
    this.training = false;
    this.onProgress = null;
    this.load();
  }

  load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY));
      if (saved && saved.w1?.length === FEATURE_COUNT * HIDDEN) { Object.assign(this, saved); this.ready = true; }
    } catch { /* on réentraînera */ }
  }

  save() {
    const { w1, b1, w2, b2, mean, std, accuracy } = this;
    try { localStorage.setItem(STORE_KEY, JSON.stringify({ w1, b1, w2, b2, mean, std, accuracy })); } catch {}
  }

  /** Fabrique des exemples : plusieurs humeurs par type de signal, à partir du catalogue. */
  async makeDataset(catalog, perKind = 14) {
    const X = [], Y = [];
    const n = Math.floor(SAMPLE_SECONDS * SAMPLE_RATE);
    let done = 0;
    const total = CLASSES.length * perKind;
    for (const [ci, cls] of CLASSES.entries()) {
      const body = catalog.find((b) => b.signal.kind === cls.kind);
      if (!body) continue;
      for (let k = 0; k < perKind; k++) {
        const st = new SignalState(body);
        st.intensity = 0.15 + Math.random() * 0.8;
        st.regularity = 0.1 + Math.random() * 0.85;
        if (Math.random() < 0.3) st.trigger();
        const gen = new SignalGenerator(st, SAMPLE_RATE);
        const buf = new Float32Array(n);
        for (let i = 0; i < SAMPLE_RATE / 2; i++) gen.next(); // on laisse le signal s'installer
        // Un vrai enregistrement n'est jamais propre : on ajoute un fond de bruit et un gain aléatoires,
        // pour que le détecteur apprenne la forme du signal, pas la propreté de la synthèse.
        const noise = Math.random() * 0.08, gain = 0.4 + Math.random() * 0.6;
        for (let i = 0; i < n; i++) buf[i] = gen.next() * gain + (Math.random() * 2 - 1) * noise;
        X.push(features(analyse(buf)));
        Y.push(ci);
        done++;
        this.onProgress?.({ phase: "écoute", done, total });
        await new Promise((r) => setTimeout(r, 0)); // on laisse respirer l'interface
      }
    }
    return { X, Y };
  }

  async train(catalog) {
    if (this.training) return;
    this.training = true;
    const { X, Y } = await this.makeDataset(catalog);
    // Normalisation
    const F = FEATURE_COUNT;
    const mean = new Array(F).fill(0), std = new Array(F).fill(0);
    for (const x of X) x.forEach((v, i) => (mean[i] += v / X.length));
    for (const x of X) x.forEach((v, i) => (std[i] += (v - mean[i]) ** 2 / X.length));
    for (let i = 0; i < F; i++) std[i] = Math.sqrt(std[i]) || 1;
    const Xn = X.map((x) => x.map((v, i) => (v - mean[i]) / std[i]));

    // Réseau : F -> HIDDEN (tanh) -> C (softmax), descente de gradient toute simple.
    const C = CLASSES.length;
    let w1 = Array.from({ length: F * HIDDEN }, rand), b1 = new Array(HIDDEN).fill(0);
    let w2 = Array.from({ length: HIDDEN * C }, rand), b2 = new Array(C).fill(0);
    const lr = 0.03, epochs = 300, decay = 1e-3; // decay : on freine les poids pour éviter l'arrogance
    for (let ep = 0; ep < epochs; ep++) {
      const order = Xn.map((_, i) => i).sort(() => Math.random() - 0.5);
      for (const idx of order) {
        const x = Xn[idx], y = Y[idx];
        const { h, p } = forward(x, w1, b1, w2, b2);
        // Gradient de la couche de sortie
        const dOut = p.map((v, c) => v - (c === y ? 1 : 0));
        const dH = new Array(HIDDEN).fill(0);
        for (let j = 0; j < HIDDEN; j++) {
          for (let c = 0; c < C; c++) { dH[j] += dOut[c] * w2[j * C + c]; w2[j * C + c] -= lr * (dOut[c] * h[j] + decay * w2[j * C + c]); }
        }
        for (let c = 0; c < C; c++) b2[c] -= lr * dOut[c];
        for (let j = 0; j < HIDDEN; j++) {
          const g = dH[j] * (1 - h[j] * h[j]);
          for (let i = 0; i < F; i++) w1[i * HIDDEN + j] -= lr * (g * x[i] + decay * w1[i * HIDDEN + j]);
          b1[j] -= lr * g;
        }
      }
      if (ep % 20 === 0) {
        this.onProgress?.({ phase: "apprentissage", done: ep, total: epochs });
        await new Promise((r) => setTimeout(r, 0));
      }
    }
    let ok = 0;
    Xn.forEach((x, i) => { const { p } = forward(x, w1, b1, w2, b2); if (argmax(p) === Y[i]) ok++; });
    Object.assign(this, { w1, b1, w2, b2, mean, std, accuracy: ok / Xn.length });
    this.ready = true;
    this.training = false;
    this.save();
    this.onProgress?.({ phase: "prêt", done: 1, total: 1 });
  }

  /** Probabilités par classe, triées. */
  predict(analysis) {
    if (!this.ready) return null;
    const x = features(analysis).map((v, i) => (v - this.mean[i]) / this.std[i]);
    // Température 2 : un avis, pas une certitude.
    const { p } = forward(x, this.w1, this.b1, this.w2, this.b2, 2);
    return CLASSES.map((c, i) => ({ ...c, p: p[i] })).sort((a, b) => b.p - a.p);
  }
}

function forward(x, w1, b1, w2, b2, temperature = 1) {
  const C = CLASSES.length, F = x.length;
  const h = new Array(HIDDEN);
  for (let j = 0; j < HIDDEN; j++) {
    let s = b1[j];
    for (let i = 0; i < F; i++) s += x[i] * w1[i * HIDDEN + j];
    h[j] = Math.tanh(s);
  }
  const z = new Array(C);
  let max = -Infinity;
  for (let c = 0; c < C; c++) {
    let s = b2[c];
    for (let j = 0; j < HIDDEN; j++) s += h[j] * w2[j * C + c];
    z[c] = s / temperature; if (z[c] > max) max = z[c];
  }
  let sum = 0;
  const p = z.map((v) => { const e = Math.exp(v - max); sum += e; return e; }).map((e) => e / sum);
  return { h, p };
}

const argmax = (arr) => arr.reduce((bi, v, i, a) => (v > a[bi] ? i : bi), 0);
