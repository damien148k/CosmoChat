# ✶ Cosmos Chat

Braque ton antenne vers un astre, écoute son signal… et discute avec lui en langage naturel.

Cosmos Chat est un projet ludique (pas scientifique) : chaque astre émet un signal simulé, inspiré de ses vraies émissions (le pulsar de Vela bat 11 fois par seconde, Jupiter craque en ondes décamétriques, le fond diffus cosmologique souffle…). Claude reçoit les mesures du signal à chaque message (fréquence, intensité, régularité, événement en cours) et les « traduit » en paroles, avec la personnalité de l'astre.

## Lancer

Il faut seulement [Node.js](https://nodejs.org) 18 ou plus. Aucune dépendance à installer.

```bash
cp .env.example .env     # puis colle ta clé ANTHROPIC_API_KEY dedans
npm start                # ou : node server.js
```

Ouvre ensuite http://localhost:3000.

Sans clé API, l'application démarre en **mode rêve** : les astres répondent avec des phrases générées localement. C'est jouable, mais beaucoup moins vivant qu'avec Claude.

## Ce qu'on peut faire

- **Choisir un astre** dans la carte du ciel : Soleil, Jupiter, pulsar de Vela, Sagittarius A*, fond diffus cosmologique, sursaut radio rapide, Saturne, Proxima b, comète Tchouri.
- **Regarder son signal** sur l'oscilloscope, avec ses lectures en direct (fréquence, intensité, régularité, trace décodée).
- **Écouter** le signal : une sonification générée en temps réel dans le navigateur.
- **Perturber** : déclenche un événement cosmique (éruption, glitch, aurore…). Les événements arrivent aussi tout seuls. L'humeur de l'astre en dépend.
- **Discuter** : l'astre parle en premier, puis répond selon l'état de son signal au moment où tu écris. Les conversations sont gardées dans le navigateur.

## Structure

```
server.js            serveur HTTP sans dépendance, relais en streaming vers l'API Claude
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
| `ANTHROPIC_API_KEY` | clé de l'API Claude | (vide : mode rêve) |
| `COSMOS_MODEL` | modèle utilisé | `claude-sonnet-5-5` |
| `PORT` | port du serveur | `3000` |
