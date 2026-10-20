/**
 * Preferenze discriminatorie (PIANO §3.10, PROMPT «Regole che non si
 * negoziano»): le preferenze dei clienti su genere, età, origine o
 * nazionalità, religione e orientamento non si registrano né si codificano.
 *
 * Regola: un termine di categoria a non più di 6 parole da un verbo o marcatore
 * di preferenza (preferisc*, vuole/vogliono, richied*, chied*, solo, niente,
 * evitare, gradisc*, esclud*, rifiut*, mai…) blocca l'invio.
 *
 * I termini che riguardano anche le cose (nazionalità, età, «giovane»,
 * «italiani»: un operatore italiano, l'età di un aereo, «i ragazzi» passeggeri)
 * contano solo con una persona vicina (pilota, equipaggio, cliente,
 * passeggero…), entro 5 parole («piloti con più di 60 anni»). «Origine» e «provenienza» non contano: nei voli
 * sono l'aeroporto di partenza; l'origine delle persone la dicono le parole come
 * «straniero», «etnia» o la nazionalità.
 *
 * Non contano: le parole dentro un identificativo (`rule.equipaggi.over_60`), gli
 * anni di esperienza o di durata («10 anni di esperienza», «da 5 anni», «ogni 2
 * anni»), le sigle in maiuscolo che coincidono con un termine («ETA», l'orario
 * stimato d'arrivo; «ROM», il codice di Roma).
 *
 * Regole d'età dell'equipaggio (spec privacy 3: il dato «ha compiuto 60 anni» è
 * ammesso): una soglia d'età non blocca vicino a una norma (normativa,
 * regolamento, EASA, FCL…), né quando riguarda l'equipaggio, senza clienti o
 * passeggeri vicini, e i marcatori sono solo di regola («mai», «solo»,
 * «niente») e non di richiesta («vuole», «chiede», «preferisce»…).
 *
 * Modulo puro.
 */
import { anyAround, isAllCaps, rawWord, type PreparedText } from "./words.ts";

export const DISCRIMINATION_CATEGORIES = ["genere", "eta", "origine", "religione", "orientamento"] as const;
export type DiscriminationCategory = (typeof DISCRIMINATION_CATEGORIES)[number];

export const DISCRIMINATION_MESSAGE =
  "Le preferenze su genere, età, origine, religione o salute non si registrano. Riformula senza indicarle.";

export const PREFERENCE_DISTANCE = 6;
export const PERSON_DISTANCE = 5;

interface CategoryTerm {
  category: DiscriminationCategory;
  pattern: RegExp;
  /** Conta solo con una persona vicina. */
  needsPerson: boolean;
}

const TERMS: readonly CategoryTerm[] = [
  // Genere
  {
    category: "genere",
    pattern: /^(?:donn[ae]|uomo|uomini|maschi[oe]?|maschil[ei]|femmin[ae]|femminil[ei]|sesso|ragazz[ae]|signorin[ae]|transgender|transessual[ei])$/,
    needsPerson: false,
  },
  // Età
  {
    category: "eta",
    pattern:
      /^(?:anzian[oaie]|pensionat[oaie]|minorenn[ei]|maggiorenn[ei]|diciottenn[ei]|ventenn[ei]|trentenn[ei]|quarantenn[ei]|cinquantenn[ei]|sessantenn[ei]|settantenn[ei]|ottantenn[ei]|over|under)$/,
    needsPerson: false,
  },
  // Origine
  {
    category: "origine",
    pattern: /^(?:stranier[oaie]|extracomunitar[ioae]|immigrat[oaie]|etni[ae]|etnic(?:o|a|i|he)|razz[ae]|razzial[ei]|rom|zingar[oaie]|nomad[ei])$/,
    needsPerson: false,
  },
  // Religione
  {
    category: "religione",
    pattern:
      /^(?:religion[ei]|religios[oaie]|musulman[oaie]|islamic(?:o|a|i|he)|islam|ebre[oaie]|ebraic(?:o|a|i|he)|cristian[oaie]|cattolic(?:o|a|i|he)|protestant[ei]|induist[aie]|buddist[aie]|ate[oaie]|sikh)$/,
    needsPerson: false,
  },
  // Orientamento
  { category: "orientamento", pattern: /^(?:gay|lesbic(?:a|he)|omosessual[ei]|eterosessual[ei]|bisessual[ei]|lgbt\w*|queer)$/, needsPerson: false },
  // Termini che valgono anche per le cose: solo con una persona vicina.
  { category: "eta", pattern: /^(?:giovan[ei]|giovanissim[oaie]|vecchi[oae]?|ragazz[oi]|eta|anni)$/, needsPerson: true },
  {
    category: "origine",
    pattern:
      /^(?:nazionalita|italian[oaie]|ingles[ei]|frances[ei]|tedesc(?:o|a|hi|he)|russ[oaie]|arab[oaie]|cines[ei]|american[oaie]|african[oaie]|asiatic(?:o|a|i|he)|indian[oaie]|nordafrican[oaie]|sudamerican[oaie]|latinoamerican[oaie]|albanes[ei]|romen[oaie]|marocchin[oaie]|turc(?:o|a|hi|he)|nigerian[oaie]|filippin[oaie]|ucrain[oaie]|polacc(?:o|a|hi|he))$/,
    needsPerson: true,
  },
];

/** Persone (anche per la vicinanza dei termini sanitari, §3.10). */
export const PERSON_WORD =
  /^(?:pilot[ai]|copilot[ai]|comandant[ei]|ufficial[ei]|equipagg(?:io|i)|hostess|steward|assistent[ei]|client[ei]|clientela|passegger[oaie]|pax|person[ae]|gente|dipendent[ei]|personale|collaborator[ei]|collaboratric[ei]|autist[ai]|staff|referent[ei]|utent[ei]|ospit[ei]|figli[oae]?|bambin[oaie]|neonat[oaie]|familiar[ei]|accompagnator[ei]|candidat[oaie]|lavorator[ei]|addett[oaie]|signor[aei]?)$/;

/** Sigle in maiuscolo che non sono il termine: «ETA» (orario d'arrivo), «ROM» (codice di Roma). */
const ACRONYM_TERMS = new Set(["eta", "rom"]);

/** Equipaggio: per le regole d'età di volo. */
const CREW_WORD = /^(?:pilot[ai]|copilot[ai]|comandant[ei]|ufficial[ei]|equipagg(?:io|i)|hostess|steward|assistent[ei]|crew)$/;
/** Chi può esprimere una preferenza sulle persone a bordo. */
const CLIENT_WORD = /^(?:client[ei]|clientela|passegger[oaie]|pax|armator[ei]|proprietari[oa]?|committent[ei]|owner|broker|ospit[ei])$/;
/** Norme e regolamenti del volo. */
const REGULATION_WORD = /^(?:normativ[aei]|regolament[oi]|easa|enac|icao|fcl|ops|legge|leggi|decreto|direttiva)$/;
/** Marcatori di regola, non di richiesta. */
const RULE_MARKER = /^(?:mai|solo|soltanto|solamente|esclusivamente|unicamente|niente|nessun[oa]?|no)$/;
/** Distanza per norme, clienti e passeggeri attorno a una regola d'età. */
const CONTEXT_DISTANCE = 12;

/** Marcatori di preferenza. */
const PREFERENCE_WORD =
  /^(?:preferisc\w*|preferir\w*|preferenz[ae]|preferibil\w*|preferit[oaie]|vuole|vogliono|voglio|vorrebbe(?:ro)?|volere|richied\w*|chied[eoi]\w*|solo|soltanto|solamente|esclusivamente|unicamente|niente|nessun[oa]?|evit\w*|gradisc\w*|gradit[oaie]|mai|esclud\w*|esclus[oaie]|rifiut\w*|accett(?:a|ano|are|iamo|erebbe|erebbero)|pretend\w*|no)$/;

const NUMBER = /^\d+$/;
/** «da 5 anni», «per 3 anni», «ogni 2 anni»: una durata, non un'età. */
const DURATION_BEFORE = /^(?:da|per|tra|fra|ogni|entro|dopo|circa|negli|ultimi|prossimi)$/;
/** «10 anni di esperienza»: anzianità di servizio, non età. */
const EXPERIENCE_AFTER = /^(?:esperienza|servizio|anzianita|attivita|lavoro|carriera|volo|contratto|licenza|abilitazione|garanzia|vita|leasing)$/;

/** La parola fa parte di un identificativo («over_60», «rule.equipaggi.donne»)? */
function inIdentifier(t: PreparedText, i: number): boolean {
  const before = t.text[t.starts[i] - 1] ?? "";
  const after = t.text[t.ends[i]] ?? "";
  if (before === "_" || after === "_") return true;
  const alnum = /[\p{L}\p{N}]/u;
  return (before === "." && alnum.test(t.text[t.starts[i] - 2] ?? "")) || (after === "." && alnum.test(t.text[t.ends[i] + 1] ?? ""));
}

export interface DiscriminationMatch {
  category: DiscriminationCategory;
  /** Parola di categoria trovata (piegata). */
  term: string;
  index: number;
}

function categoryOf(t: PreparedText, i: number): CategoryTerm | null {
  const w = t.norms[i];
  if (ACRONYM_TERMS.has(w)) {
    const raw = rawWord(t, i);
    if (isAllCaps(raw) && raw.toLowerCase() === w) return null;
  }
  // «over 50», «under 30»: solo seguiti da un numero.
  if ((w === "over" || w === "under") && !NUMBER.test(t.norms[i + 1] ?? "")) return null;
  // «anni» conta solo dopo un numero («più di 60 anni») e se non è una durata.
  if (w === "anni") {
    if (!NUMBER.test(t.norms[i - 1] ?? "")) return null;
    if (DURATION_BEFORE.test(t.norms[i - 2] ?? "")) return null;
    if (t.norms[i + 1] === "di" && EXPERIENCE_AFTER.test(t.norms[i + 2] ?? "")) return null;
  }
  for (const term of TERMS) if (term.pattern.test(w)) return term;
  return null;
}

/** Soglia d'età («over 60», «60 anni», «sessantenne»), come nelle regole di volo. */
function isAgeThreshold(t: PreparedText, i: number): boolean {
  const w = t.norms[i];
  return w === "over" || w === "under" || w === "anni" || /enn[ei]$/.test(w);
}

/**
 * Regola d'età dell'equipaggio, non preferenza di un cliente: una norma vicina,
 * oppure equipaggio vicino, nessun cliente o passeggero e solo marcatori di regola.
 */
function crewAgeRule(t: PreparedText, i: number): boolean {
  if (anyAround(t, i, CONTEXT_DISTANCE, (j) => REGULATION_WORD.test(t.norms[j]))) return true;
  if (!isAgeThreshold(t, i)) return false;
  if (!anyAround(t, i, PERSON_DISTANCE, (j) => CREW_WORD.test(t.norms[j]))) return false;
  if (anyAround(t, i, CONTEXT_DISTANCE, (j) => CLIENT_WORD.test(t.norms[j]))) return false;
  return !anyAround(t, i, PREFERENCE_DISTANCE, (j) => PREFERENCE_WORD.test(t.norms[j]) && !RULE_MARKER.test(t.norms[j]));
}

/** Preferenze discriminatorie nel testo. */
export function findDiscrimination(t: PreparedText): DiscriminationMatch[] {
  const out: DiscriminationMatch[] = [];
  for (let i = 0; i < t.norms.length; i++) {
    const term = categoryOf(t, i);
    if (!term || inIdentifier(t, i)) continue;
    if (term.needsPerson && !anyAround(t, i, PERSON_DISTANCE, (j) => PERSON_WORD.test(t.norms[j]))) continue;
    if (!anyAround(t, i, PREFERENCE_DISTANCE, (j) => PREFERENCE_WORD.test(t.norms[j]))) continue;
    if (term.category === "eta" && crewAgeRule(t, i)) continue;
    out.push({ category: term.category, term: t.norms[i], index: i });
  }
  return out;
}
