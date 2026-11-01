// Les "interprètes" possibles : qui traduit le signal en mots ?
//
// - ollama : un modèle open source qui tourne sur ton ordinateur (gratuit)
// - openai : n'importe quel service compatible OpenAI (Groq, OpenRouter, LM Studio…)
// - claude : l'API Claude d'Anthropic (payante)
// - reve   : réponses générées localement, sans aucun modèle
//
// COSMOS_PROVIDER=auto (par défaut) choisit dans cet ordre :
// clé Claude > service compatible OpenAI configuré > Ollama s'il tourne > mode rêve.

const DEFAULTS = {
  claude: "claude-sonnet-5-5",
  ollama: "mistral",
  openai: "llama-3.1-8b-instant",
};

export async function resolveProvider(env = process.env) {
  const wanted = (env.COSMOS_PROVIDER || "auto").toLowerCase();
  const ollamaUrl = (env.OLLAMA_URL || "http://localhost:11434").replace(/\/$/, "");

  if (wanted === "claude" || (wanted === "auto" && env.ANTHROPIC_API_KEY)) {
    if (!env.ANTHROPIC_API_KEY) return dream("COSMOS_PROVIDER=claude mais ANTHROPIC_API_KEY est vide");
    return claude(env);
  }
  if (wanted === "openai" || (wanted === "auto" && env.OPENAI_BASE_URL)) {
    if (!env.OPENAI_BASE_URL) return dream("COSMOS_PROVIDER=openai mais OPENAI_BASE_URL est vide");
    const model = env.COSMOS_MODEL || DEFAULTS.openai;
    return openaiCompatible({
      name: "openai",
      label: model,
      model,
      baseUrl: env.OPENAI_BASE_URL.replace(/\/$/, ""),
      apiKey: env.OPENAI_API_KEY,
    });
  }
  if (wanted === "ollama" || wanted === "auto") {
    const model = env.COSMOS_MODEL || DEFAULTS.ollama;
    const check = await checkOllama(ollamaUrl, model);
    if (check.ok) {
      return openaiCompatible({ name: "ollama", label: `${model} (local)`, model, baseUrl: `${ollamaUrl}/v1`, warning: check.warning });
    }
    if (wanted === "ollama") return dream(check.reason);
  }
  return dream("aucun interprète trouvé (ni clé API, ni Ollama)");
}

async function checkOllama(url, model) {
  try {
    const r = await fetch(`${url}/api/tags`, { signal: AbortSignal.timeout(1500) });
    if (!r.ok) return { ok: false, reason: `Ollama répond ${r.status} sur ${url}` };
    const { models = [] } = await r.json();
    const names = models.map((m) => m.name);
    const has = names.some((n) => n === model || n.split(":")[0] === model);
    return {
      ok: true,
      warning: has ? null : `le modèle « ${model} » n'est pas installé : lance \`ollama pull ${model}\``,
    };
  } catch {
    return { ok: false, reason: `Ollama ne répond pas sur ${url} (est-il lancé ?)` };
  }
}

function dream(reason) {
  return { name: "reve", label: "mode rêve", model: null, reason, stream: null };
}

/** Lit un flux SSE et appelle onData(objet JSON) pour chaque événement "data:". */
async function readSSE(body, onData) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, idx).trim();
      buffer = buffer.slice(idx + 1);
      if (!line.startsWith("data:")) continue;
      const raw = line.slice(5).trim();
      if (raw === "[DONE]") return;
      try { onData(JSON.parse(raw)); } catch { /* ligne incomplète */ }
    }
  }
}

async function failIfBad(upstream, who) {
  if (upstream.ok && upstream.body) return;
  const err = await upstream.text().catch(() => "");
  console.error(`Erreur ${who}`, upstream.status, err.slice(0, 500));
  throw new Error(`interférence ${upstream.status} : ${who} a brouillé la transmission`);
}

function claude(env) {
  const model = env.COSMOS_MODEL || DEFAULTS.claude;
  const url = env.COSMOS_API_URL || "https://api.anthropic.com/v1/messages";
  return {
    name: "claude",
    label: `Claude (${model})`,
    model,
    async stream(system, messages, write) {
      const upstream = await fetch(url, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": env.ANTHROPIC_API_KEY,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({ model, max_tokens: 700, stream: true, system, messages }),
      });
      await failIfBad(upstream, "Claude");
      await readSSE(upstream.body, (data) => {
        if (data.type === "content_block_delta" && data.delta?.type === "text_delta") write(data.delta.text);
        else if (data.type === "error") write(`\n[interférence : ${data.error?.message || "inconnue"}]`);
      });
    },
  };
}

function openaiCompatible({ name, label, model, baseUrl, apiKey, warning }) {
  return {
    name,
    label,
    model,
    warning,
    async stream(system, messages, write) {
      const headers = { "content-type": "application/json" };
      if (apiKey) headers.authorization = `Bearer ${apiKey}`;
      const upstream = await fetch(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers,
        body: JSON.stringify({
          model,
          max_tokens: 700,
          temperature: 0.9,
          stream: true,
          messages: [{ role: "system", content: system }, ...messages],
        }),
      });
      await failIfBad(upstream, name === "ollama" ? "Ollama" : "le service");
      await readSSE(upstream.body, (data) => {
        const text = data.choices?.[0]?.delta?.content;
        if (text) write(text);
      });
    },
  };
}
