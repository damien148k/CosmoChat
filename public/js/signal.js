// Moteur de signaux : synthèse procédurale d'un "signal cosmique" par astre.
// Le même moteur sert à l'oscilloscope (visuel) et au haut-parleur (audio).
// Tout est inventé mais inspiré des vraies émissions de chaque objet.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

const NATURES = {
  drone: "bourdonnement harmonique avec sursauts balayant les fréquences",
  chorus: "craquements radio décamétriques et salves de sifflements descendants",
  pulse: "impulsions périodiques d'une précision d'horloge atomique",
  abyss: "grondement très grave avec battements et étirement temporel",
  hiss: "souffle thermique quasi uniforme dans toutes les directions",
  burst: "éclairs radio de quelques millisecondes, dispersés en fréquence",
  whistle: "sifflements glissants, montées et descentes mélodiques",
  murmur: "murmure faible noyé dans le bruit, porteuse instable",
  song: "gazouillis magnétique modulé, presque un chant d'oiseau",
};

/** État partagé (humeur du signal) entre plusieurs générateurs. */
export class SignalState {
  constructor(body) {
    this.body = body;
    this.intensity = rand(0.35, 0.7);
    this.regularity = body.signal.kind === "pulse" ? 0.95 : rand(0.4, 0.8);
    this.drift = 0;
    this.event = null;
    this.eventUntil = 0;
    this.nextEventAt = performance.now() + rand(15000, 40000);
    this.levels = Array.from({ length: 12 }, () => rand(0.2, 0.5));
    this.onEvent = null;
  }

  /** Marche aléatoire de l'humeur + déclenchement d'événements. */
  tick(now, dt) {
    const k = dt / 1000;
    this.intensity = clamp(this.intensity + rand(-0.25, 0.25) * k, 0.12, 0.98);
    const targetReg = this.body.signal.kind === "pulse" ? 0.93 : 0.6;
    this.regularity = clamp(this.regularity + (rand(-0.3, 0.3) + (targetReg - this.regularity) * 0.2) * k, 0.05, 0.99);
    this.drift = clamp(this.drift + rand(-0.02, 0.02) * k, -0.05, 0.05);

    if (this.event && now > this.eventUntil) {
      this.event = null;
      this.nextEventAt = now + rand(25000, 60000);
      this.onEvent?.(null);
    }
    if (!this.event && now > this.nextEventAt) this.trigger(now);
    if (this.event) this.intensity = clamp(this.intensity + 0.6 * k, 0, 0.98);
  }

  trigger(now = performance.now()) {
    const evts = this.body.signal.events;
    this.event = evts[Math.floor(Math.random() * evts.length)];
    this.eventUntil = now + rand(10000, 18000);
    this.regularity = clamp(this.regularity - 0.3, 0.05, 1);
    this.onEvent?.(this.event);
  }

  pushLevel(rms) {
    this.levels.push(rms);
    if (this.levels.length > 12) this.levels.shift();
  }

  /** Ce que l'on transmet au LLM pour qu'il "interprète" le signal. */
  snapshot() {
    const s = this.body.signal;
    const f = s.realFreq * (1 + this.drift + (this.event ? 0.03 : 0));
    const fmt = f.toLocaleString("fr-FR", { maximumFractionDigits: f < 10 ? 3 : 1 });
    return {
      nature: NATURES[s.kind],
      frequency: `${fmt} ${s.unit}`,
      intensity: Math.round(this.intensity * 100),
      regularity: Math.round(this.regularity * 100),
      glyph: this.glyph(),
      event: this.event,
    };
  }

  glyph() {
    const bars = "▁▂▃▄▅▆▇█";
    const max = Math.max(...this.levels, 0.0001);
    return this.levels.map((l) => bars[clamp(Math.round((l / max) * 7), 0, 7)]).join("");
  }
}

/** Générateur d'échantillons à un taux donné (stateful : phases, filtres…). */
export class SignalGenerator {
  constructor(state, sampleRate) {
    this.st = state;
    this.sr = sampleRate;
    this.t = 0;
    this.ph = [0, 0, 0, 0];
    this.lp = 0;
    this.lp2 = 0;
    this.nextClick = 0;
    this.chirp = null;
    this.nextChirp = 0;
    this.glide = { f: 600, target: 900 };
  }

  noise() { return Math.random() * 2 - 1; }

  osc(i, freq) {
    this.ph[i] = (this.ph[i] + (freq / this.sr) * TAU) % TAU;
    return Math.sin(this.ph[i]);
  }

  /** Lance un "chirp" : glissement de fréquence de f0 à f1 sur dur secondes. */
  startChirp(f0, f1, dur, amp = 1) {
    this.chirp = { t: 0, f0, f1, dur, amp, ph: 0 };
  }

  runChirp() {
    const c = this.chirp;
    if (!c) return 0;
    c.t += 1 / this.sr;
    if (c.t > c.dur) { this.chirp = null; return 0; }
    const p = c.t / c.dur;
    const f = c.f0 * Math.pow(c.f1 / c.f0, p);
    c.ph += (f / this.sr) * TAU;
    const env = Math.sin(Math.PI * p);
    return Math.sin(c.ph) * env * c.amp;
  }

  next() {
    const { st } = this;
    const sig = st.body.signal;
    const I = st.intensity;
    const R = st.regularity;
    const ev = st.event ? 1 : 0;
    const dt = 1 / this.sr;
    this.t += dt;
    const t = this.t;
    let v = 0;

    switch (sig.kind) {
      case "drone": {
        const am = 0.7 + 0.3 * Math.sin(TAU * 0.2 * t);
        v = (this.osc(0, 110) * 0.5 + this.osc(1, 165.3) * 0.3 + this.osc(2, 220.6) * 0.2) * am;
        this.lp += (this.noise() - this.lp) * 0.05;
        v += this.lp * sig.noise * (1.4 - R);
        if (ev && !this.chirp && Math.random() < 0.0004) this.startChirp(1800, 150, 1.2, 0.7);
        v += this.runChirp();
        break;
      }
      case "chorus": {
        const crackleRate = 0.002 + I * 0.02;
        if (Math.random() < crackleRate) this.lp2 = rand(0.5, 1);
        this.lp2 *= 0.995;
        this.lp += (this.noise() - this.lp) * 0.3;
        v = this.lp * this.lp2 * 1.4;
        if (t > this.nextChirp) {
          this.startChirp(rand(1200, 2500), rand(300, 700), rand(0.05, 0.25), 0.6);
          this.nextChirp = t + rand(0.2, 1.2) / (0.4 + I + ev);
        }
        v += this.runChirp();
        break;
      }
      case "pulse": {
        const period = 1 / (sig.base * (1 + st.drift * 0.1));
        if (t >= this.nextClick) {
          this.clickT = 0;
          const jitter = (1 - R) * period * 0.4 * this.noise();
          this.nextClick = t + period + jitter;
        }
        this.clickT = (this.clickT ?? 1) + dt;
        const env = Math.exp(-this.clickT * 260);
        v = env * (this.osc(0, 1400) * 0.7 + this.noise() * 0.5);
        v += this.noise() * sig.noise * 0.3;
        break;
      }
      case "abyss": {
        const bend = 1 + 0.08 * Math.sin(TAU * 0.05 * t);
        v = this.osc(0, 38 * bend) * 0.6 + this.osc(1, 39.3 * bend) * 0.5 + this.osc(2, 57 * bend) * 0.25;
        v *= 0.7 + 0.3 * Math.sin(TAU * 0.13 * t);
        this.lp += (this.noise() - this.lp) * 0.01;
        v += this.lp * 1.2;
        if (ev) v += this.osc(3, 19 + 6 * Math.sin(TAU * 0.3 * t)) * 0.5;
        break;
      }
      case "hiss": {
        this.lp += (this.noise() - this.lp) * 0.25;
        this.lp2 += (this.lp - this.lp2) * 0.5;
        v = this.lp2 * (0.85 + 0.15 * Math.sin(TAU * 0.07 * t));
        if (ev) v += this.osc(0, 160) * 0.06;
        break;
      }
      case "burst": {
        v = this.noise() * 0.04;
        if (t > this.nextChirp) {
          this.startChirp(rand(3500, 5000), rand(200, 400), rand(0.02, 0.06), 1);
          const quiet = st.event?.startsWith("silence") ? 4 : 1;
          this.nextChirp = t + (ev && !quiet ? rand(0.05, 0.25) : rand(0.6, 3)) * quiet / (0.5 + I);
        }
        v += this.runChirp();
        break;
      }
      case "whistle": {
        const g = this.glide;
        if (Math.abs(g.f - g.target) < 2) g.target = rand(350, 1300) * (ev ? 1.3 : 1);
        g.f += (g.target - g.f) * (0.00004 + (1 - R) * 0.0002);
        v = this.osc(0, g.f) * 0.6 + this.osc(1, g.f * 1.5) * 0.15 + this.osc(2, g.f * 0.5) * 0.2;
        this.lp += (this.noise() - this.lp) * 0.08;
        v += this.lp * sig.noise;
        break;
      }
      case "murmur": {
        this.lp += (this.noise() - this.lp) * 0.04;
        const wob = 1 + 0.02 * Math.sin(TAU * 3 * t) + (1 - R) * 0.05 * Math.sin(TAU * 0.7 * t);
        v = this.lp * 2.2 + this.osc(0, 210 * wob) * 0.18 * (0.5 + 0.5 * Math.sin(TAU * 0.25 * t));
        if (ev && Math.random() < 0.0008) this.startChirp(900, 2400, 0.4, 0.5);
        v += this.runChirp();
        break;
      }
      case "song": {
        const g = this.glide;
        if (Math.random() < 0.0003 + (1 - R) * 0.001) g.target = rand(250, 1100);
        g.f += (g.target - g.f) * 0.0006;
        const fm = Math.sin(TAU * (5 + 20 * I) * t) * 80;
        v = this.osc(0, g.f + fm) * (0.4 + 0.4 * Math.max(0, Math.sin(TAU * 1.3 * t)));
        this.lp += (this.noise() - this.lp) * 0.1;
        v += this.lp * sig.noise;
        if (ev && Math.random() < 0.002) this.startChirp(rand(600, 900), rand(1500, 2500), 0.08, 0.5);
        v += this.runChirp();
        break;
      }
    }
    return clamp(v * (0.25 + I * 0.75), -1, 1);
  }
}
