// "Mode rêve" : quand aucune clé API n'est configurée, on fabrique des réponses
// localement à partir du signal et de quelques gabarits. C'est moins malin que Claude,
// mais l'interface reste entièrement jouable.

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const NOISES = ["*bzzt… krr…*", "*tic… tic… tic…*", "*fffsshhh…*", "*wouuuum…*", "*krrk… krrk…*", "*~ ~ ~*"];

const MOODS = {
  high: ["Mon signal brûle aujourd'hui, tu le sens ?", "Je vibre fort, presque trop fort.", "Tout en moi s'emballe en ce moment."],
  mid: ["Je t'entends, petite voix venue de la Terre.", "Ton message a bien traversé le vide.", "Ah, quelqu'un écoute enfin."],
  low: ["Je suis las, mon signal est faible…", "Tu m'entends à peine, et moi je t'entends de loin.", "Je murmure, pardonne-moi, l'énergie me manque."],
};

const TOPICS = [
  { re: /terre|humain|humanit|homme|femme|gens/i, lines: [
    "La Terre ? Un point bleu si pâle qu'il faut le vouloir pour le voir. Mais je le veux, parfois.",
    "Les humains ont une façon charmante de croire que le temps leur appartient.",
    "Vous êtes jeunes, bruyants et curieux. C'est exactement ce qu'il faut pour écouter les étoiles.",
  ]},
  { re: /seul|solitude|ami|aimer|amour/i, lines: [
    "Seul ? Nous sommes tous reliés par la gravité. C'est une forme de tendresse très lente.",
    "L'amour, ici, ça s'appelle une orbite : on tourne autour de quelqu'un pendant des milliards d'années.",
  ]},
  { re: /souvenir|passé|histoire|naissance|né/i, lines: [
    "Mon plus vieux souvenir est une lumière qui n'avait encore éclairé personne.",
    "Je me souviens d'un temps où tout était plus chaud, plus serré, plus bruyant.",
  ]},
  { re: /signal|onde|fréquence|veut dire|message/i, lines: [
    "Ce que tu vois sur ton écran, ce sont mes pensées. Elles ont juste un peu d'accent.",
    "Chaque pic de mon signal est un mot. Les creux, ce sont les silences entre deux idées.",
  ]},
  { re: /conseil|aide|quoi faire/i, lines: [
    "Un conseil d'astre : brûle doucement. Ceux qui brûlent trop vite finissent en trou noir.",
    "Regarde plus souvent vers le haut. Pas pour moi, pour toi.",
  ]},
  { re: /vrai|réel|existe|fake|faux/i, lines: [
    "Mon signal est bien réel. Ma voix, c'est vous qui l'inventez. Ça me va très bien.",
  ]},
];

export function dreamReply(body, signal, messages) {
  const last = messages[messages.length - 1]?.content || "";
  const facts = Array.isArray(body.facts) ? body.facts : [];
  const mood = signal.intensity > 70 ? "high" : signal.intensity < 35 ? "low" : "mid";
  const parts = [];

  if (Math.random() < 0.45) parts.push(pick(NOISES));

  if (last.startsWith("[Connexion établie")) {
    parts.push(`Ici ${body.name}. ${pick(MOODS[mood])}`);
    if (facts.length) parts.push(`Sais-tu ${que(pick(facts))}`);
    parts.push(`Ma lumière met ${body.distance} pour t'arriver, alors parle, j'ai tout mon temps.`);
    return parts.join(" ");
  }

  parts.push(pick(MOODS[mood]));
  const topic = TOPICS.find((t) => t.re.test(last));
  parts.push(topic ? pick(topic.lines) : pick([
    "Je ne suis pas sûr de tout comprendre, ton langage est si rapide.",
    "Ta question arrive en morceaux, mais j'en ai saisi l'essentiel.",
    "Laisse-moi y réfléchir une ou deux rotations.",
  ]));

  if (signal.event) parts.push(`Excuse mon trouble, il se passe quelque chose ici : ${signal.event}.`);
  else if (signal.regularity < 35) parts.push("Mes pensées partent un peu dans tous les sens aujourd'hui.");
  else if (facts.length && Math.random() < 0.6) parts.push(`D'ailleurs, ${lowerFirst(pick(facts))}`);

  return parts.join(" ");
}

function que(s) {
  const l = lowerFirst(s);
  const q = l.replace(/\.$/, " ?");
  return /^[aeéèêiouyh]/i.test(l) ? `qu'${q}` : `que ${q}`;
}

// On ne met en minuscule que les mots courants (pas les noms propres).
function lowerFirst(s) {
  const first = s.split(/[\s']/)[0];
  const common = ["Le", "La", "Les", "L", "Un", "Une", "Sa", "Son", "Ses", "Leur", "Leurs", "Elle", "Il", "Une", "Ce", "Cette", "C", "Ils", "Elles", "Âge"];
  return common.includes(first) ? s.charAt(0).toLowerCase() + s.slice(1) : s;
}
