// Étape 1 : traitement du signal, pour de vrai.
// Transformée de Fourier, périodicité, sursauts… Tout tourne dans le navigateur
// et produit des mesures honnêtes que l'on décrit ensuite au modèle de langage.
//
// Étape 3 : « la langue de l'astre ». Le signal est découpé en tranches, chaque
// tranche devient une lettre d'un alphabet de 16 signes. On y cherche ensuite
// des motifs, un vocabulaire, une entropie. Pas d'entraînement ici (ça demande
// des données et du calcul), mais une vraie transcription symbolique.

export const SAMPLE_RATE = 22050;
export const WINDOW = 4096;          // taille d'une transformée de Fourier
export const BLOCK = 1024;           // taille d'une « lettre » (≈ 46 ms)

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

/** FFT radix-2 en place (re, im de longueur n, puissance de 2). */
export function fft(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr; im[b] = im[a] - ti;
        re[a] += tr; im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr; cr = ncr;
      }
    }
  }
}

const hann = new Float32Array(WINDOW);
for (let i = 0; i < WINDOW; i++) hann[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (WINDOW - 1));

/** Spectre de puissance (WINDOW/2 bins) d'une fenêtre d'échantillons. */
export function spectrum(samples, offset = 0) {
  const re = new Float32Array(WINDOW), im = new Float32Array(WINDOW);
  for (let i = 0; i < WINDOW; i++) re[i] = (samples[offset + i] || 0) * hann[i];
  fft(re, im);
  const out = new Float32Array(WINDOW / 2);
  for (let i = 0; i < WINDOW / 2; i++) out[i] = re[i] * re[i] + im[i] * im[i];
  return out;
}

export const binFreq = (bin) => (bin * SAMPLE_RATE) / WINDOW;

/** Statistiques d'un spectre : pic, centroïde, étalement, planéité (bruit vs note). */
function spectralStats(mag) {
  let total = 0, peak = 1, peakV = 0, logSum = 0, centroid = 0;
  for (let i = 1; i < mag.length; i++) {
    total += mag[i];
    centroid += i * mag[i];
    logSum += Math.log(mag[i] + 1e-12);
    if (mag[i] > peakV) { peakV = mag[i]; peak = i; }
  }
  const n = mag.length - 1;
  centroid = total > 0 ? centroid / total : 0;
  let spread = 0;
  for (let i = 1; i < mag.length; i++) spread += (i - centroid) ** 2 * mag[i];
  spread = total > 0 ? Math.sqrt(spread / total) : 0;
  const flatness = total > 0 ? Math.exp(logSum / n) / (total / n) : 1;
  // Part de l'énergie dans le pic (± 3 bins) : une note pure concentre tout.
  let peakE = 0;
  for (let i = Math.max(1, peak - 3); i <= Math.min(mag.length - 1, peak + 3); i++) peakE += mag[i];
  return { peak, centroid, spread, flatness: clamp(flatness, 0, 1), peakShare: total > 0 ? peakE / total : 0 };
}

/** Autocorrélation d'une enveloppe : trouve la période dominante et sa force. */
function periodicity(env, envRate) {
  const n = env.length;
  let mean = 0;
  for (const v of env) mean += v;
  mean /= n;
  const x = env.map((v) => v - mean);
  let e0 = 0;
  for (const v of x) e0 += v * v;
  if (e0 < 1e-9) return { period: 0, strength: 0 };
  const minLag = Math.round(envRate * 0.03);   // 30 ms
  const maxLag = Math.floor(n / 2);
  let best = 0, bestLag = 0;
  for (let lag = minLag; lag < maxLag; lag++) {
    let s = 0;
    for (let i = 0; i + lag < n; i++) s += x[i] * x[i + lag];
    s /= e0;
    if (s > best) { best = s; bestLag = lag; }
  }
  return { period: bestLag / envRate, strength: clamp(best, 0, 1) };
}

const ALPHABET = "ᚠᚢᚦᚨᚱᚲᚷᚹᚺᚾᛁᛃᛇᛈᛉᛊ"; // 16 lettres : 4 niveaux × 4 timbres
export const alphabet = [...ALPHABET];

/**
 * Analyse complète d'un tampon d'échantillons (Float32Array à 22 050 Hz).
 * Retourne des mesures, la transcription en lettres, et les motifs trouvés.
 */
export function analyse(samples) {
  const n = samples.length;
  // --- niveau, crête
  let sum2 = 0, peakAbs = 0;
  for (let i = 0; i < n; i++) { const v = samples[i]; sum2 += v * v; if (Math.abs(v) > peakAbs) peakAbs = Math.abs(v); }
  const rms = Math.sqrt(sum2 / n);
  const crest = rms > 0 ? peakAbs / rms : 0;

  // --- spectre moyen sur plusieurs fenêtres + dérive du pic (chirp ?)
  const frames = Math.max(1, Math.floor((n - WINDOW) / (WINDOW / 2)) + 1);
  const avg = new Float32Array(WINDOW / 2);
  const peaks = [];
  for (let f = 0; f < frames; f++) {
    const sp = spectrum(samples, f * (WINDOW / 2));
    let pk = 1;
    for (let i = 1; i < sp.length; i++) { avg[i] += sp[i] / frames; if (sp[i] > sp[pk]) pk = i; }
    peaks.push(pk);
  }
  const st = spectralStats(avg);
  let drift = 0;
  if (peaks.length > 2) {
    // Pente de la fréquence du pic au fil du temps, en octaves par seconde.
    const first = binFreq(peaks[0]) + 1, last = binFreq(peaks[peaks.length - 1]) + 1;
    drift = Math.log2(last / first) / ((frames * WINDOW) / 2 / SAMPLE_RATE);
  }

  // --- enveloppe par blocs, sursauts, périodicité
  const nb = Math.floor(n / BLOCK);
  const env = new Array(nb);
  const cents = new Array(nb);
  for (let b = 0; b < nb; b++) {
    let s = 0, zc = 0, prev = samples[b * BLOCK];
    for (let i = 0; i < BLOCK; i++) {
      const v = samples[b * BLOCK + i];
      s += v * v;
      if ((v >= 0) !== (prev >= 0)) zc++;
      prev = v;
    }
    env[b] = Math.sqrt(s / BLOCK);
    cents[b] = zc; // taux de passages par zéro ≈ hauteur du timbre
  }
  const sortedEnv = [...env].sort((a, b) => a - b);
  const median = sortedEnv[Math.floor(nb / 2)] || 0;
  const bursts = env.filter((v) => v > median * 3 + 1e-4).length;
  const silence = env.filter((v) => v < median * 0.2).length;
  const per = periodicity(env, SAMPLE_RATE / BLOCK);

  // --- transcription en lettres (étape 3)
  const maxEnv = Math.max(...env, 1e-6);
  const maxZc = Math.max(...cents, 1);
  let text = "";
  for (let b = 0; b < nb; b++) {
    const level = clamp(Math.floor(Math.sqrt(env[b] / maxEnv) * 4), 0, 3);
    const timbre = clamp(Math.floor((cents[b] / maxZc) * 4), 0, 3);
    text += ALPHABET[level * 4 + timbre];
  }
  const lang = language(text);

  return {
    rms, crest,
    dominantHz: binFreq(st.peak),
    centroidHz: binFreq(st.centroid),
    bandwidthHz: binFreq(st.spread) * 2,
    flatness: st.flatness,
    tonality: st.peakShare,
    driftOctPerSec: drift,
    periodSec: per.period,
    periodicity: per.strength,
    burstRatio: bursts / nb,
    silenceRatio: silence / nb,
    text, ...lang,
  };
}

/** Étape 3 : statistiques de « langue » sur la transcription. */
function language(text) {
  const chars = [...text];
  const counts = new Map();
  for (const c of chars) counts.set(c, (counts.get(c) || 0) + 1);
  let entropy = 0;
  for (const v of counts.values()) { const p = v / chars.length; entropy -= p * Math.log2(p); }
  const grams = new Map();
  for (let i = 0; i + 3 <= chars.length; i++) {
    const g = chars.slice(i, i + 3).join("");
    grams.set(g, (grams.get(g) || 0) + 1);
  }
  const motifs = [...grams.entries()].filter(([, v]) => v > 1).sort((a, b) => b[1] - a[1]).slice(0, 3);
  return {
    vocabulary: counts.size,
    entropy,                                   // 0 = une seule lettre répétée, 4 = chaos complet
    motifs: motifs.map(([g, v]) => ({ motif: g, count: v })),
    repetition: motifs.length ? motifs[0][1] / Math.max(1, grams.size) : 0,
  };
}

/** Vecteur de caractéristiques (étape 4) pour le détecteur. */
export function features(a) {
  return [
    Math.log10(a.dominantHz + 1), Math.log10(a.centroidHz + 1), Math.log10(a.bandwidthHz + 1),
    a.flatness, a.tonality, clamp(a.driftOctPerSec, -8, 8), Math.log10(a.periodSec + 0.01),
    a.periodicity, a.burstRatio, a.silenceRatio, Math.log10(a.crest + 1), a.entropy / 4, a.repetition,
  ];
}
export const FEATURE_COUNT = 13;

/** Résumé lisible (pour l'humain, et pour le modèle). */
export function describe(a) {
  const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${v.toFixed(0)} Hz`);
  const lines = [];
  lines.push(`fréquence dominante ${hz(a.dominantHz)}, centroïde ${hz(a.centroidHz)}, largeur de bande ${hz(a.bandwidthHz)}`);
  lines.push(a.flatness > 0.5 ? "spectre plat : c'est du bruit, un souffle" : a.tonality > 0.5 ? "spectre très concentré : une note presque pure" : "spectre mixte, quelques composantes nettes dans un fond de bruit");
  if (Math.abs(a.driftOctPerSec) > 0.8) lines.push(`la hauteur ${a.driftOctPerSec > 0 ? "monte" : "descend"} vite (${Math.abs(a.driftOctPerSec).toFixed(1)} octave/s) : un glissement, un chirp`);
  if (a.periodicity > 0.5) lines.push(`battement régulier toutes les ${(a.periodSec * 1000).toFixed(0)} ms (${(1 / a.periodSec).toFixed(1)} par seconde), régularité ${(a.periodicity * 100).toFixed(0)} %`);
  else if (a.periodicity > 0.25) lines.push(`vague périodicité autour de ${(a.periodSec * 1000).toFixed(0)} ms`);
  else lines.push("aucune période nette : pas de battement");
  if (a.burstRatio > 0.05) lines.push(`sursauts : ${(a.burstRatio * 100).toFixed(0)} % du temps est occupé par des éclats bien au-dessus du niveau médian`);
  if (a.silenceRatio > 0.3) lines.push(`silences : ${(a.silenceRatio * 100).toFixed(0)} % du temps presque muet`);
  if (a.crest > 6) lines.push(`facteur de crête élevé (${a.crest.toFixed(1)}) : des pics très brefs`);
  return lines;
}
