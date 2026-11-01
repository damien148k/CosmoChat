// Cosmos Chat — petit serveur sans dépendance (Node 18+)
// Sert l'interface et relaie la conversation vers l'API Claude.
// Sans clé API, il bascule en "mode rêve" : des réponses générées localement.

import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { loadEnv } from "./lib/env.js";
import { buildSystemPrompt } from "./lib/prompt.js";
import { dreamReply } from "./lib/dream.js";

loadEnv();

const PORT = Number(process.env.PORT || 3000);
const API_KEY = process.env.ANTHROPIC_API_KEY || "";
const API_URL = process.env.COSMOS_API_URL || "https://api.anthropic.com/v1/messages";
const MODEL = process.env.COSMOS_MODEL || "claude-sonnet-5-5";
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

  res.writeHead(200, {
    "Content-Type": "text/plain; charset=utf-8",
    "Cache-Control": "no-cache",
    "X-Cosmos-Mode": API_KEY ? "claude" : "reve",
  });

  if (!API_KEY) {
    // Mode rêve : on "tape" la réponse lettre par lettre pour l'effet.
    const text = dreamReply(body, signal, clean);
    for (const word of text.split(/(\s+)/)) {
      res.write(word);
      await new Promise((r) => setTimeout(r, 25));
    }
    return res.end();
  }

  try {
    const upstream = await fetch(API_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 700,
        stream: true,
        system: buildSystemPrompt(body, signal),
        messages: clean,
      }),
    });

    if (!upstream.ok || !upstream.body) {
      const err = await upstream.text();
      console.error("Erreur API Claude", upstream.status, err);
      res.write(`\n[interférence ${upstream.status} : la transmission a été brouillée. Vérifie ta clé API ou réessaie.]`);
      return res.end();
    }

    // Relais du flux SSE : on n'envoie au navigateur que le texte.
    const decoder = new TextDecoder();
    let buffer = "";
    for await (const chunk of upstream.body) {
      buffer += decoder.decode(chunk, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) !== -1) {
        const event = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const dataLine = event.split("\n").find((l) => l.startsWith("data:"));
        if (!dataLine) continue;
        try {
          const data = JSON.parse(dataLine.slice(5).trim());
          if (data.type === "content_block_delta" && data.delta?.type === "text_delta") {
            res.write(data.delta.text);
          } else if (data.type === "error") {
            res.write(`\n[interférence : ${data.error?.message || "inconnue"}]`);
          }
        } catch { /* fragment incomplet, on ignore */ }
      }
    }
    res.end();
  } catch (e) {
    console.error(e);
    res.write("\n[le signal s'est perdu dans le vide interstellaire… réessaie]");
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return handleChat(req, res);
  if (req.method === "GET" && req.url === "/api/status") {
    res.writeHead(200, { "Content-Type": "application/json" });
    return res.end(JSON.stringify({ mode: API_KEY ? "claude" : "reve", model: API_KEY ? MODEL : null }));
  }
  if (req.method === "GET") return serveStatic(req, res);
  send(res, 405, "Méthode inconnue dans cette galaxie.");
});

server.listen(PORT, () => {
  console.log(`\n  ✦ Cosmos Chat écoute sur http://localhost:${PORT}`);
  console.log(API_KEY
    ? `  ✦ Interprète : Claude (${MODEL})\n`
    : "  ✦ Pas de clé ANTHROPIC_API_KEY : mode rêve (réponses locales)\n");
});
