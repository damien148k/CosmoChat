# ✶ Cosmos Chat

Braque ton antenne vers un astre, écoute son signal… et discute avec lui en langage naturel.

Cosmos Chat est un projet ludique (pas scientifique) : chaque astre émet un signal simulé, inspiré de ses vraies émissions (le pulsar de Vela bat 11 fois par seconde, Jupiter craque en ondes décamétriques, le fond diffus cosmologique souffle…). Un modèle de langage (open source et gratuit par défaut) reçoit les mesures du signal à chaque message (fréquence, intensité, régularité, événement en cours) et les « traduit » en paroles, avec la personnalité de l'astre.

## Lancer

Il faut seulement [Node.js](https://nodejs.org) 18 ou plus. Aucune dépendance à installer.

```bash
npm start                # ou : node server.js
```

Ouvre ensuite http://localhost:3000.

## Donner une voix aux astres (gratuitement)

L'app a besoin d'un « interprète », un modèle de langage qui traduit le signal en mots. Le plus simple et gratuit : **Ollama**, qui fait tourner des modèles open source sur ton ordinateur.

1. Installe Ollama : https://ollama.com/download
2. Télécharge un modèle (une seule fois) :
   ```bash
   ollama pull mistral
   ```
3. Lance Cosmos Chat : il détecte Ollama tout seul. La pastille en haut à droite affiche `interprète : mistral (local)`.

Quel modèle choisir ?

| Modèle | Taille | Pour qui |
| --- | --- | --- |
| `mistral` (défaut) | ≈ 4 Go | bon français, ordinateur récent avec 8 Go de RAM ou plus |
| `gemma3:4b` | ≈ 3 Go | bon compromis pour un ordinateur moyen |
| `llama3.2:3b` | ≈ 2 Go | ordinateur modeste, réponses plus simples |

Pour changer de modèle : `ollama pull gemma3:4b`, puis `COSMOS_MODEL=gemma3:4b` dans un fichier `.env` (copie `.env.example`).

**Autres options**, à régler dans `.env` :
- un service en ligne compatible OpenAI, dont certains ont une offre gratuite (Groq, OpenRouter…) : `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `COSMOS_MODEL` ;
- l'API Claude (payante) : `ANTHROPIC_API_KEY`.

Sans aucun interprète, l'app tourne en **mode rêve** : les astres répondent avec des phrases toutes faites. C'est jouable, mais beaucoup moins vivant.

## Ce qu'on peut faire

- **Choisir un astre** dans la carte du ciel : Soleil, Jupiter, pulsar de Vela, Sagittarius A*, fond diffus cosmologique, sursaut radio rapide, Saturne, Proxima b, comète Tchouri.
- **Regarder son signal** sur l'oscilloscope, avec ses lectures en direct (fréquence, intensité, régularité, trace décodée).
- **Écouter** le signal : une sonification générée en temps réel dans le navigateur.
- **Perturber** : déclenche un événement cosmique (éruption, glitch, aurore…). Les événements arrivent aussi tout seuls. L'humeur de l'astre en dépend.
- **Discuter** : l'astre parle en premier, puis répond selon l'état de son signal au moment où tu écris. Les conversations sont gardées dans le navigateur.

## Structure

```
server.js            serveur HTTP sans dépendance, relais en streaming vers l'interprète
lib/providers.js     les interprètes : Ollama, service compatible OpenAI, Claude, mode rêve
lib/prompt.js        consigne système : personnalité + mesures du signal
lib/dream.js         réponses locales du mode rêve
public/index.html    l'interface
public/style.css     le style
public/js/catalog.js les astres : personnalités, faits réels, paramètres de signal
public/js/signal.js  synthèse des signaux (visuel + audio) et humeur de l'astre
public/js/sky.js     ciel étoilé animé
public/js/app.js     logique de l'interface et du chat
```

## Ajouter un astre

Ajoute une entrée dans `public/js/catalog.js` : un nom, une couleur, une `voice` (personnalité), quelques `facts`, et un `signal.kind` parmi `drone`, `chorus`, `pulse`, `abyss`, `hiss`, `burst`, `whistle`, `murmur`, `song`.

## Réglages

| Variable | Rôle | Défaut |
| --- | --- | --- |
| `COSMOS_PROVIDER` | `auto`, `ollama`, `openai`, `claude` ou `reve` | `auto` |
| `COSMOS_MODEL` | modèle utilisé | `mistral` (Ollama) |
| `OLLAMA_URL` | adresse d'Ollama | `http://localhost:11434` |
| `OPENAI_BASE_URL`, `OPENAI_API_KEY` | service compatible OpenAI | (vide) |
| `ANTHROPIC_API_KEY` | clé de l'API Claude | (vide) |
| `PORT` | port du serveur | `3000` |

En mode `auto`, l'ordre est : clé Claude, puis service compatible OpenAI, puis Ollama, puis mode rêve.
