import { CATALOG, byId } from "./catalog.js";
import { SignalState, SignalGenerator } from "./signal.js";
import { startSky, setBeacon } from "./sky.js";

const $ = (id) => document.getElementById(id);
const STORE_KEY = "cosmos-chat:v1";

const SUGGESTIONS = [
  "Que ressens-tu en ce moment ?",
  "Que penses-tu de la Terre ?",
  "Raconte-moi ton plus vieux souvenir.",
  "Que veut dire ce signal ?",
  "Tu te sens seul·e là-haut ?",
  "Donne-moi un conseil d'astre.",
];

const OPENING = "[Connexion établie. Un humain vient de capter ton signal depuis la Terre. Présente-toi en quelques phrases, à ta façon.]";

// ---------- État ----------
const app = {
  current: null,          // astre actif
  states: new Map(),      // id -> SignalState (l'humeur persiste quand on change d'astre)
  histories: loadHistories(),
  busy: false,
  scopeGen: null,
  ring: new Float32Array(2048),
  ringPos: 0,
  audio: null,
};

function loadHistories() {
  try { return JSON.parse(localStorage.getItem(STORE_KEY)) || {}; } catch { return {}; }
}
function saveHistories() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(app.histories)); } catch {}
}

// ---------- Mode (Claude ou rêve) ----------
fetch("/api/status").then((r) => r.json()).then(({ mode, model }) => {
  const el = $("mode");
  el.classList.add(mode);
  el.textContent = mode === "claude" ? `interprète : Claude` : "mode rêve";
  el.title = mode === "claude" ? `Modèle : ${model}` : "Ajoute ANTHROPIC_API_KEY dans .env pour que Claude interprète les signaux.";
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
  if (!app.states.has(body.id)) {
    const st = new SignalState(body);
    app.states.set(body.id, st);
  }
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
  app.scopeGen = new SignalGenerator(st, 22050);
  if (app.audio) app.audio.gen = new SignalGenerator(st, app.audio.ctx.sampleRate);
  setBeacon(body.color);

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

// ---------- Oscilloscope & lectures ----------
const scope = $("scope");
const sctx = scope.getContext("2d");
let lastFrame = performance.now();
let levelAcc = 0, levelN = 0, levelTimer = 0, readoutTimer = 0;

function frame(now) {
  const dt = Math.min(100, now - lastFrame);
  lastFrame = now;
  const body = app.current;
  if (body && app.scopeGen) {
    const st = stateFor(body);
    st.tick(now, dt);
    // On génère exactement le temps écoulé, à 22 050 Hz.
    const n = Math.floor((dt / 1000) * 22050);
    for (let i = 0; i < n; i++) {
      const v = app.scopeGen.next();
      app.ring[app.ringPos] = v;
      app.ringPos = (app.ringPos + 1) % app.ring.length;
      levelAcc += v * v; levelN++;
    }
    levelTimer += dt;
    if (levelTimer > 450) {
      st.pushLevel(Math.sqrt(levelAcc / Math.max(1, levelN)));
      levelAcc = 0; levelN = 0; levelTimer = 0;
    }
    readoutTimer += dt;
    if (readoutTimer > 300) { updateReadouts(st); readoutTimer = 0; }
    drawScope(body.color, st.intensity);
  }
  requestAnimationFrame(frame);
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

function updateReadouts(st) {
  const s = st.snapshot();
  $("r-freq").textContent = s.frequency;
  $("r-int").style.width = s.intensity + "%";
  $("r-int-v").textContent = s.intensity + "%";
  $("r-reg").style.width = s.regularity + "%";
  $("r-reg-v").textContent = s.regularity + "%";
  $("r-glyph").textContent = s.glyph;
  $("receiver").style.boxShadow = `0 0 ${40 + s.intensity}px -30px ${st.body.color} inset`;
}

// ---------- Audio ----------
$("listen").addEventListener("click", async () => {
  const btn = $("listen");
  if (app.audio) {
    app.audio.ctx.close();
    app.audio = null;
    btn.setAttribute("aria-pressed", "false");
    return;
  }
  const ctx = new (window.AudioContext || window.webkitAudioContext)();
  const node = ctx.createScriptProcessor(2048, 0, 1);
  const gain = ctx.createGain();
  gain.gain.value = 0;
  gain.gain.linearRampToValueAtTime(0.28, ctx.currentTime + 1.5);
  app.audio = { ctx, node, gain, gen: app.current ? new SignalGenerator(stateFor(app.current), ctx.sampleRate) : null };
  node.onaudioprocess = (e) => {
    const out = e.outputBuffer.getChannelData(0);
    const gen = app.audio?.gen;
    for (let i = 0; i < out.length; i++) out[i] = gen ? gen.next() : 0;
  };
  node.connect(gain).connect(ctx.destination);
  await ctx.resume();
  btn.setAttribute("aria-pressed", "true");
});

$("perturb").addEventListener("click", () => {
  if (!app.current) return;
  stateFor(app.current).trigger();
});

// ---------- Chat ----------
function history() {
  const id = app.current.id;
  return (app.histories[id] ||= []);
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
    meta.textContent = `${m.signal.glyph} · ${m.signal.frequency} · intensité ${m.signal.intensity}%`;
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

async function converse(text, { hidden = false } = {}) {
  if (app.busy || !app.current || !text.trim()) return;
  app.busy = true;
  $("send").disabled = true;
  const body = app.current;
  const st = stateFor(body);
  const signal = st.snapshot();
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

  const reply = { role: "assistant", content: "", signal };
  const el = messageEl(reply);
  el.classList.add("cursor");

  try {
    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        body: { name: body.name, type: body.type, distance: body.distance, voice: body.voice, facts: body.facts, id: body.id },
        signal,
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
select(byId(location.hash.slice(1)) ? location.hash.slice(1) : "vela");
requestAnimationFrame(frame);
