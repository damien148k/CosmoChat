import { CATALOG, byId } from "./catalog.js";
import { SignalState, SignalGenerator } from "./signal.js";
import { startSky, setBeacon } from "./sky.js";
import { analyse, describe, SAMPLE_RATE, WINDOW, BLOCK } from "./analysis.js";
import { Detector } from "./classifier.js";
import { Spectrogram } from "./spectrogram.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "cosmos-chat:v1";

const SUGGESTIONS = [
  "Que ressens-tu en ce moment ?",
  "Que penses-tu de la Terre ?",
  "Raconte-moi ton plus vieux souvenir.",
  "Que veut dire ce signal ?",
  "Tu te sens seul·e là-haut ?",
  "Donne-moi un conseil d'astre.",
  "Que vois-tu dans ton spectrogramme ?",
  "Traduis-moi les dernières lettres de ta langue.",
];

const OPENING = "[Connexion établie. Un humain vient de capter ton signal depuis la Terre. Présente-toi en quelques phrases, à ta façon.]";

// ---------- État ----------
const app = {
  current: null,          // astre actif
  states: new Map(),      // id -> SignalState (l'humeur persiste quand on change d'astre)
  histories: loadHistories(),
  busy: false,
  scopeGen: null,
  ring: new Float32Array(2048),          // ce que montre l'oscilloscope
  ringPos: 0,
  buffer: new Float32Array(32768),       // ≈ 1,5 s pour l'analyse (étape 1)
  bufferPos: 0,
  sinceColumn: 0,
  analysis: null,                        // dernière analyse
  verdict: null,                         // dernier avis du détecteur (étape 4)
  file: null,                            // enregistrement déposé { data, pos, name, audioBuffer }
  view: "scope",
  vision: false,                         // l'interprète voit-il les images ?
  audio: null,
};

const spectro = new Spectrogram($("spectro"));
const detector = new Detector();

function loadHistories() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveHistories() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(app.histories)); } catch {}
}

// ---------- Mode (interprète) ----------
fetch("/api/status").then((r) => r.json()).then(({ mode, label, warning, vision }) => {
  const el = $("mode");
  el.classList.add(mode === "reve" ? "reve" : "live");
  el.textContent = mode === "reve" ? "mode rêve" : `interprète : ${label}`;
  el.title = warning || (mode === "reve"
    ? "Lance Ollama (gratuit, open source) ou configure un interprète dans .env pour que les astres parlent vraiment."
    : "Les signaux sont traduits par ce modèle.");
  if (warning) el.classList.add("warn");
  app.vision = Boolean(vision);
  $("send-image").disabled = !app.vision;
  $("send-image").checked = app.vision;
  $("lab-vision").textContent = app.vision
    ? "Ton interprète voit les images : il reçoit ce spectrogramme avec chaque message."
    : mode === "reve"
      ? "En mode rêve, personne ne regarde l'image. Le spectrogramme reste pour tes yeux."
      : "Ce modèle ne voit pas les images. Avec Ollama, essaie un modèle à vision (ex. `ollama pull gemma3:4b`) pour qu'il lise le spectrogramme.";
}).catch(() => { $("mode").textContent = "station hors ligne"; });

// ---------- Carte du ciel ----------
function renderBodies() {
  const ul = $("bodies");
  ul.innerHTML = "";
  for (const b of CATALOG) {
    const li = document.createElement("li");
    const btn = document.createElement("button");
    btn.className = "body-card";
    btn.style.setProperty("--c", b.color);
    btn.setAttribute("aria-current", String(app.current?.id === b.id));
    btn.innerHTML = `<span class="g">${b.glyph}</span><span><span class="n">${b.name}</span><div class="d">${b.tagline}</div></span>`;
    btn.addEventListener("click", () => select(b.id));
    li.appendChild(btn);
    ul.appendChild(li);
  }
}

function stateFor(body) {
  if (!app.states.has(body.id)) app.states.set(body.id, new SignalState(body));
  return app.states.get(body.id);
}

function select(id) {
  const body = byId(id);
  if (!body || app.current?.id === id || app.busy) return;
  app.current = body;
  location.hash = id;

  document.documentElement.style.setProperty("--accent", body.color);
  $("t-glyph").textContent = body.glyph;
  $("t-name").textContent = body.name;
  $("t-meta").textContent = `${body.type} · ${body.distance}`;

  const st = stateFor(body);
  st.onEvent = (evt) => showEvent(evt);
  showEvent(st.event);
  app.scopeGen = new SignalGenerator(st, SAMPLE_RATE);
  spectro.setColor(body.color);
  setBeacon(body.color);
  restartAudio();

  renderBodies();
  renderLog();
  renderChips();

  if (!app.histories[id]?.length) converse(OPENING, { hidden: true });
}

function showEvent(evt) {
  const el = $("event");
  if (!evt) { el.hidden = true; return; }
  el.hidden = false;
  el.textContent = `⚠ ÉVÉNEMENT : ${evt}`;
}

// ---------- Source du signal : simulé, ou enregistrement déposé ----------
function nextSample() {
  const f = app.file;
  if (f) {
    const v = f.data[f.pos];
    f.pos = (f.pos + 1) % f.data.length;
    return v;
  }
  return app.scopeGen.next();
}

$("file").addEventListener("change", async (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await ctx.decodeAudioData(await file.arrayBuffer());
    await ctx.close();
    // Rééchantillonnage en mono à 22 050 Hz, 60 s maximum.
    const seconds = Math.min(60, decoded.duration);
    const off = new OfflineAudioContext(1, Math.ceil(seconds * SAMPLE_RATE), SAMPLE_RATE);
    const src = off.createBufferSource();
    src.buffer = decoded;
    src.connect(off.destination);
    src.start();
    const rendered = await off.startRendering();
    const data = rendered.getChannelData(0).slice();
    let peak = 0;
    for (const v of data) peak = Math.max(peak, Math.abs(v));
    if (peak > 0) for (let i = 0; i < data.length; i++) data[i] /= peak; // on normalise
    app.file = { data, pos: 0, name: file.name, audioBuffer: decoded, seconds };
    $("lab-source").textContent = `enregistrement : ${file.name} (${seconds.toFixed(0)} s, en boucle)`;
    $("unload").hidden = false;
    restartAudio();
  } catch (err) {
    $("lab-source").textContent = `impossible de lire ce fichier (${err.message})`;
  }
  e.target.value = "";
});

$("unload").addEventListener("click", () => {
  app.file = null;
  $("lab-source").textContent = "signal simulé";
  $("unload").hidden = true;
  restartAudio();
});

// ---------- Boucle : génération, oscilloscope, spectrogramme, analyse ----------
const scope = $("scope");
const sctx = scope.getContext("2d");
let lastFrame = performance.now();
let levelAcc = 0, levelN = 0, levelTimer = 0, analysisTimer = 0;

function frame(now) {
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  const body = app.current;
  if (body && app.scopeGen) {
    const st = stateFor(body);
    st.tick(now, dt);
    const n = Math.floor((dt / 1000) * SAMPLE_RATE);
    for (let i = 0; i < n; i++) {
      const v = nextSample();
      app.ring[app.ringPos] = v;
      app.ringPos = (app.ringPos + 1) % app.ring.length;
      app.buffer[app.bufferPos] = v;
      app.bufferPos = (app.bufferPos + 1) % app.buffer.length;
      levelAcc += v * v; levelN++;
      if (++app.sinceColumn >= BLOCK) {
        app.sinceColumn = 0;
        spectro.push(recent(WINDOW), 0);
      }
    }
    levelTimer += dt;
    if (levelTimer > 450) {
      st.pushLevel(Math.sqrt(levelAcc / Math.max(1, levelN)));
      levelAcc = 0; levelN = 0; levelTimer = 0;
    }
    analysisTimer += dt;
    if (analysisTimer > 1000) { analysisTimer = 0; runAnalysis(st); }
    if (app.view === "scope") drawScope(body.color, st.intensity); else spectro.draw();
  }
  requestAnimationFrame(frame);
}

/** Les `len` derniers échantillons, dans l'ordre. */
function recent(len) {
  const out = new Float32Array(len);
  const N = app.buffer.length;
  let p = (app.bufferPos - len + N) % N;
  for (let i = 0; i < len; i++) { out[i] = app.buffer[p]; p = (p + 1) % N; }
  return out;
}

function runAnalysis(st) {
  const a = analyse(recent(app.buffer.length));
  app.analysis = a;
  app.verdict = detector.predict(a);
  renderReadouts(st, a);
  renderLab(a, app.verdict);
}

function drawScope(color, intensity) {
  const dpr = window.devicePixelRatio || 1;
  const w = scope.clientWidth, h = scope.clientHeight;
  if (scope.width !== w * dpr || scope.height !== h * dpr) { scope.width = w * dpr; scope.height = h * dpr; }
  sctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  sctx.clearRect(0, 0, w, h);
  const N = app.ring.length;
  const mid = h / 2;
  for (const [width, alpha, blur] of [[5, 0.18, 14], [1.6, 1, 4]]) {
    sctx.beginPath();
    for (let i = 0; i < N; i++) {
      const v = app.ring[(app.ringPos + i) % N];
      const x = (i / (N - 1)) * w;
      const y = mid - v * (h * 0.45);
      i ? sctx.lineTo(x, y) : sctx.moveTo(x, y);
    }
    sctx.strokeStyle = color;
    sctx.globalAlpha = alpha;
    sctx.lineWidth = width;
    sctx.shadowColor = color;
    sctx.shadowBlur = blur * (0.5 + intensity);
    sctx.stroke();
  }
  sctx.globalAlpha = 1;
  sctx.shadowBlur = 0;
}

document.querySelectorAll("[data-view]").forEach((b) => b.addEventListener("click", () => {
  app.view = b.dataset.view;
  document.querySelectorAll("[data-view]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
  $("scope").hidden = app.view !== "scope";
  $("spectro").hidden = app.view !== "spectro";
}));

// ---------- Lectures & laboratoire ----------
function renderReadouts(st, a) {
  const s = st.snapshot();
  const intensity = Math.round(Math.min(1, a.rms * 2.2) * 100);
  const regularity = Math.round(a.periodicity * 100);
  $("r-freq").textContent = app.file ? hz(a.dominantHz) : s.frequency;
  $("r-int").style.width = intensity + "%";
  $("r-int-v").textContent = intensity + "%";
  $("r-reg").style.width = regularity + "%";
  $("r-reg-v").textContent = regularity + "%";
  $("r-glyph").textContent = s.glyph;
  $("receiver").style.boxShadow = `0 0 ${40 + intensity}px -30px ${st.body.color} inset`;
}

const hz = (v) => (v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${v.toFixed(0)} Hz`);

function renderLab(a, verdict) {
  $("lab-analysis").innerHTML = describe(a).map((l) => `<li>${l}</li>`).join("");
  const runes = [...a.text];
  $("lab-runes").textContent = runes.slice(-48).join("");
  const motifs = a.motifs.map((m) => `« ${m.motif} » ×${m.count}`).join(", ");
  $("lab-lang").textContent = `${a.vocabulary} lettres sur 16 utilisées · entropie ${a.entropy.toFixed(2)} bit · ${a.motifs.length ? "motifs : " + motifs : "aucun motif répété"}`;
  if (verdict) {
    $("lab-detector").innerHTML = verdict.slice(0, 3).map((c, i) =>
      `<div class="verdict ${i ? "" : "top"}"><span>${c.label}</span><span class="bar"><i style="width:${(c.p * 100).toFixed(0)}%"></i></span><b>${(c.p * 100).toFixed(0)}%</b></div>`).join("");
  }
}

detector.onProgress = ({ phase, done, total }) => {
  const el = $("lab-detector");
  if (phase === "prêt") {
    el.innerHTML = `<p class="hint">entraîné sur 126 écoutes · ${(detector.accuracy * 100).toFixed(0)} % de réussite sur ses propres exemples</p>`;
    $("retrain").disabled = false;
    return;
  }
  const label = phase === "écoute" ? "le détecteur écoute les astres" : "le détecteur apprend";
  el.innerHTML = `<p class="hint">${label}… <span class="bar"><i style="width:${((done / total) * 100).toFixed(0)}%"></i></span></p>`;
};

$("retrain").addEventListener("click", () => {
  $("retrain").disabled = true;
  detector.train(CATALOG);
});

if (!detector.ready) {
  $("retrain").disabled = true;
  setTimeout(() => detector.train(CATALOG), 1500);
}

// ---------- Audio ----------
async function startAudio() {
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 1.5);
  gain.connect(ctx.destination);
  if (app.file) {
    const src = ctx.createBufferSource();
    src.buffer = app.file.audioBuffer;
    src.loop = true;
    src.loopEnd = app.file.seconds;
    src.connect(gain);
    src.start();
  } else {
    const node = ctx.createScriptProcessor(2048, 0, 1);
    const gen = new SignalGenerator(stateFor(app.current), ctx.sampleRate);
    node.onaudioprocess = (e) => {
      const out = e.outputBuffer.getChannelData(0);
      for (let i = 0; i < out.length; i++) out[i] = gen.next();
    };
    node.connect(gain);
  }
  app.audio = { ctx };
  await ctx.resume();
  $("listen").setAttribute("aria-pressed", "true");
}

function stopAudio() {
  app.audio?.ctx.close();
  app.audio = null;
  $("listen").setAttribute("aria-pressed", "false");
}

function restartAudio() {
  if (app.audio) { stopAudio(); startAudio(); }
}

$("listen").addEventListener("click", () => (app.audio ? stopAudio() : startAudio()));

$("perturb").addEventListener("click", () => {
  if (!app.current) return;
  stateFor(app.current).trigger();
});

// ---------- Chat ----------
function history() {
  return (app.histories[app.current.id] ||= []);
}

function escapeHtml(s) {
  return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function format(text) {
  return escapeHtml(text)
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[\s(«])\*([^*\n]+?)\*(?=[\s.,!?;:)»…]|$)/g, "$1<em>$2</em>")
    .replace(/\n/g, "<br>");
}

function messageEl(m) {
  const div = document.createElement("div");
  div.className = `msg ${m.role === "user" ? "user" : "astre"}`;
  div.innerHTML = format(m.content);
  if (m.role === "assistant" && m.signal) {
    const meta = document.createElement("span");
    meta.className = "meta";
    const v = m.verdict ? ` · détecteur : ${m.verdict}` : "";
    meta.textContent = `${m.signal.glyph} · ${m.signal.frequency} · intensité ${m.signal.intensity}%${v}`;
    div.appendChild(meta);
  }
  return div;
}

function renderLog() {
  const log = $("log");
  log.innerHTML = "";
  const intro = document.createElement("div");
  intro.className = "msg system";
  intro.textContent = `— antenne pointée vers ${app.current.name} · ${app.current.distance} —`;
  log.appendChild(intro);
  for (const m of history()) if (!m.hidden) log.appendChild(messageEl(m));
  log.scrollTop = log.scrollHeight;
}

function renderChips() {
  const box = $("chips");
  box.innerHTML = "";
  const picks = [...SUGGESTIONS].sort(() => Math.random() - 0.5).slice(0, 4);
  for (const s of picks) {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = s;
    b.addEventListener("click", () => converse(s));
    box.appendChild(b);
  }
}

/** Ce que l'on transmet au modèle, en plus de l'humeur : l'analyse réelle. */
function analysisPayload() {
  const a = app.analysis;
  if (!a) return null;
  return {
    source: app.file ? `enregistrement déposé par l'humain : « ${app.file.name} »` : "signal simulé de l'astre",
    lines: describe(a),
    runes: [...a.text].slice(-60).join(""),
    vocabulary: a.vocabulary,
    entropy: Number(a.entropy.toFixed(2)),
    motifs: a.motifs,
    verdict: app.verdict ? app.verdict.slice(0, 3).map((c) => ({ label: c.label, desc: c.desc, p: Math.round(c.p * 100) })) : null,
  };
}

async function converse(text, { hidden = false } = {}) {
  if (app.busy || !app.current || !text.trim()) return;
  app.busy = true;
  $("send").disabled = true;
  const body = app.current;
  const st = stateFor(body);
  // Au tout début, on laisse une seconde aux instruments pour mesurer quelque chose.
  for (let i = 0; !app.analysis && i < 16; i++) await new Promise((r) => setTimeout(r, 100));
  const signal = st.snapshot();
  const analysis = analysisPayload();
  const image = app.vision && $("send-image").checked ? spectro.toImage() : null;
  const hist = history();
  const log = $("log");

  const userMsg = { role: "user", content: text.trim(), hidden };
  hist.push(userMsg);
  if (!hidden) log.appendChild(messageEl(userMsg));

  const decoding = document.createElement("div");
  decoding.className = "msg system decoding";
  decoding.textContent = `décodage du signal… ${signal.glyph}`;
  log.appendChild(decoding);
  log.scrollTop = log.scrollHeight;

  const top = analysis?.verdict?.[0];
  const reply = { role: "assistant", content: "", signal, verdict: top ? `${top.label} ${top.p}%` : null };
  const el = messageEl(reply);
  el.classList.add("cursor");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: { name: body.name, type: body.type, distance: body.distance, voice: body.voice, facts: body.facts, id: body.id },
        signal,
        analysis,
        image,
        messages: hist.map(({ role, content }) => ({ role, content })),
      }),
    });
    if (!res.ok || !res.body) throw new Error(await res.text());
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let started = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!started) { decoding.remove(); log.appendChild(el); started = true; }
      reply.content += dec.decode(value, { stream: true });
      el.innerHTML = format(reply.content);
      log.scrollTop = log.scrollHeight;
    }
    if (!started) { decoding.remove(); log.appendChild(el); }
  } catch (e) {
    decoding.remove();
    reply.content = `*krrrsh…* (la transmission a échoué : ${e.message || "silence radio"})`;
    log.appendChild(el);
  }

  el.classList.remove("cursor");
  el.replaceWith(messageEl(reply));
  if (reply.content.trim()) hist.push(reply); else hist.pop();
  saveHistories();
  app.busy = false;
  $("send").disabled = false;
  log.scrollTop = log.scrollHeight;
}

// ---------- Composer ----------
const input = $("input");
input.addEventListener("input", () => {
  input.style.height = "auto";
  input.style.height = Math.min(140, input.scrollHeight) + "px";
});
input.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); $("composer").requestSubmit(); }
});
$("composer").addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value;
  if (!text.trim() || app.busy) return;
  input.value = "";
  input.style.height = "auto";
  converse(text);
});

// ---------- Démarrage ----------
startSky($("sky"));
renderBodies();
if (matchMedia("(max-width: 860px)").matches) $("lab").open = false;
select(byId(location.hash.slice(1)) ? location.hash.slice(1) : "vela");
requestAnimationFrame(frame);
