// Cosmos Chat — petit serveur sans dépendance (Node 18+)
// Sert l'interface et relaie la conversation vers un "interprète" :
// un modèle open source local (Ollama), un service compatible OpenAI, ou Claude.
// Sans interprète, il bascule en "mode rêve" : des réponses générées localement.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.js";
import { buildSystemPrompt } from "./lib/prompt.js";
import { dreamReply } from "./lib/dream.js";
import { resolveProvider } from "./lib/providers.js";

loadEnv();

const PORT = Number(process.env.PORT || 3000);

// L'interprète est choisi au démarrage. En mode rêve, on réessaie de temps en temps :
// si tu lances Ollama après le serveur, il sera détecté tout seul.
let provider = null;
let checkedAt = 0;
async function getProvider() {
  if (!provider || (provider.name === "reve" && Date.now() - checkedAt > 10_000)) {
    const before = provider?.name;
    provider = await resolveProvider();
    checkedAt = Date.now();
    if (before && before !== provider.name) console.log(`  ✦ Nouvel interprète : ${provider.label}`);
  }
  return provider;
}
const PUBLIC_DIR = join(fileURLToPath(new URL(".", import.meta.url)), "public");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json",
  ".ico": "image/x-icon",
};

async function serveStatic(req, res) {
  const url = new URL(req.url, "http://x");
  let path = decodeURIComponent(url.pathname);
  if (path === "/") path = "/index.html";
  const file = normalize(join(PUBLIC_DIR, path));
  if (!file.startsWith(PUBLIC_DIR)) return send(res, 403, "Interdit");
  try {
    const data = await readFile(file);
    res.writeHead(200, { "Content-Type": MIME[extname(file)] || "application/octet-stream" });
    res.end(data);
  } catch {
    send(res, 404, "Ce coin du cosmos est vide.");
  }
}

function send(res, status, text) {
  res.writeHead(status, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function readBody(req, limit = 200_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > limit) { reject(new Error("Message trop long")); req.destroy(); }
      else chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function handleChat(req, res) {
  let payload;
  try {
    payload = JSON.parse(await readBody(req));
  } catch (e) {
    return send(res, 400, "Requête illisible : " + e.message);
  }
  const { body, signal, messages } = payload || {};
  if (!body || !signal || !Array.isArray(messages) || messages.length === 0) {
    return send(res, 400, "Il manque l'astre, son signal ou les messages.");
  }
  // On ne garde que les 20 derniers échanges, nettoyés.
  const clean = messages.slice(-20).map((m) => ({
    role: m.role === "assistant" ? "assistant" : "user",
    content: String(m.content || "").slice(0, 4000),
  })).filter((m) => m.content);

  const p = await getProvider();
  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Cosmos-Mode": p.name,
  });

  if (!p.stream) {
    // Mode rêve : on "tape" la réponse mot par mot pour l'effet.
    const text = dreamReply(body, signal, clean);
    for (const word of text.split(/(\s+)/)) {
      res.write(word);
      await new Promise((r) => setTimeout(r, 25));
    }
    return res.end();
  }

  try {
    await p.stream(buildSystemPrompt(body, signal), clean, (text) => res.write(text));
  } catch (e) {
    console.error(e.message);
    const hint = p.name === "ollama" ? " Ollama est-il toujours lancé ?" : " Vérifie ta configuration ou réessaie.";
    res.write(`\n[${e.message.startsWith("interférence") ? e.message : "le signal s'est perdu dans le vide interstellaire"}.${hint}]`);
  }
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "GET" && req.url === "/api/status") {
    const p = await getProvider();
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ mode: p.name, label: p.label, model: p.model, warning: p.warning || p.reason || null }));
  }
  if (req.method === "GET") return serveStatic(req, res);
  send(res, 405, "Méthode inconnue dans cette galaxie.");
});

server.listen(PORT, async () => {
  const p = await getProvider();
  console.log(`\n  ✦ Cosmos Chat écoute sur http://localhost:${PORT}`);
  console.log(`  ✦ Interprète : ${p.label}`);
  if (p.warning) console.log(`  ⚠ ${p.warning}`);
  if (p.reason) console.log(`  ✦ (${p.reason} : les astres répondront avec des phrases locales)`);
  console.log("");
});
