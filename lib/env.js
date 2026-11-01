// Mini chargeur de fichier .env (pour éviter toute dépendance).
import { readFileSync } from "node:fs";

export function loadEnv(path = ".env") {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return; }
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!m || line.trim().startsWith("#")) continue;
    const value = m[2].replace(/^["']|["']$/g, "");
    if (!(m[1] in process.env)) process.env[m[1]] = value;
  }
}
