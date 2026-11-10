/**
 * Il pacchetto di uno use case per l'Agent Factory (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2):
 * i tre file di `casi/<id>/unbundle/` nel repository del caso, che il team e i coding agent leggono e non
 * cambiano mai.
 *
 * - `PACCHETTO.md`: la scheda (oggi, come cambia, persone nel ciclo, limiti, dati), benefici e costi con le
 *   stime del team, le risposte del referente con il loro stato, cosa serve ancora.
 * - `BRIEF.md`: il titolo e due righe, per il brief di `unbundle context` (al massimo 300 token in tutto).
 * - `VERSIONE`: «k<n> · <codice> · <giorno> · generato da Unbundle».
 *
 * **Niente nomi di persona né e-mail, mai.** I testi della scheda li scrivono le persone: qui si coprono le
 * e-mail, i numeri di telefono e i nomi che Unbundle conosce (persone del workspace, referenti), con «una
 * persona». I ruoli restano. Un nome che Unbundle non conosce non si può riconoscere: per questo il pacchetto
 * si rilegge nella scheda «Impostazione» prima di approvare il progetto.
 *
 * **Una versione nuova nasce solo se il contenuto cambia:** l'impronta è sul contenuto (non sul numero di
 * versione né sul giorno), e la tabella non accetta due versioni con la stessa impronta.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { createHash } from "node:crypto";
import type { PackageFile } from "../../db/use-case-hub-factory-ddl.ts";

/** Quello che serve al pacchetto, già letto con i permessi di chi lo genera (`queries/use-case-factory.ts`). */
export interface PackageSource {
  code: string;
  title: string;
  /** «use case AI», «best practice»… (l'etichetta della scheda). */
  kindLabel: string | null;
  /** L'origine della scheda, per esempio «adoption». */
  origin: string | null;
  /** Il trimestre approvato, per esempio «T1 2027». */
  targetQuarter: string | null;
  texts: {
    oggi: string | null;
    comeCambia: string | null;
    persone: string | null;
    limiti: string | null;
    dati: string | null;
  };
  /** Le voci di «Benefici e costi», con le stime del team. */
  benefits: ReadonlyArray<{ label: string; lever: string; eurYear: number | null; confidence: string | null }>;
  /** «Avvio 12.000 €, poi 600 € all'anno», o null se i costi non sono ancora stimati. */
  costText: string | null;
  /** Le risposte del referente, con la domanda (il titolo dell'esigenza) e il loro stato. */
  answers: ReadonlyArray<{ question: string; answer: string; on: string | null; status: string }>;
  /** Le esigenze di «Cosa serve» ancora aperte, con il loro stato. */
  openNeeds: ReadonlyArray<{ title: string; status: string }>;
  /** I nomi che Unbundle conosce e che non devono uscire: persone del workspace, referenti. */
  namesToHide: readonly string[];
  /** Vero se chi genera il pacchetto non vede «Cosa serve»: risposte ed esigenze restano fuori, e il pacchetto lo dice. */
  needsHidden?: boolean;
}

export interface PackageVersionInfo {
  version: number;
  /** Il giorno di Roma, `AAAA-MM-GG`. */
  day: string;
}

export const PACKAGE_LIMITS = Object.freeze({
  briefChars: 700,
  textChars: 2000,
  answerChars: 1200,
  maxBenefits: 20,
  maxAnswers: 30,
  maxNeeds: 40,
});

const PERSONA = "una persona";

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
/**
 * Un candidato numero di telefono: cifre con spazi, trattini, barre, punti o parentesi in mezzo, il «+» o una
 * parentesi davanti. È un telefono se ha almeno 9 cifre e non è un importo con i punti delle migliaia
 * («1.200.000 €»): `isPhone`.
 */
const PHONE_CANDIDATE = /(?<![\d,])(?:\+|\()?\d[\d ().\/-]{7,}\d(?![\d]|[.,]\d)/g;

function isPhone(candidate: string): boolean {
  const digits = candidate.replace(/\D/g, "");
  if (digits.length < 9 || digits.length > 15) return false;
  // Gruppi da tre cifre separati solo da punti: un importo, non un telefono.
  if (/^\d{1,3}(\.\d{3})+$/.test(candidate)) return false;
  return true;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * I nomi da coprire, dal più lungo: prima il nome intero («Mario Rossi»), poi le sue parti di almeno 3 lettere
 * («Mario», «Rossi»), qualunque sia la maiuscola con cui sono salvati.
 */
export function nameTokens(names: readonly string[]): string[] {
  const out = new Set<string>();
  for (const raw of names) {
    const name = raw.replace(/\s+/g, " ").trim();
    if (name.length < 3 || name.includes("@")) continue;
    out.add(name);
    for (const part of name.split(" ")) if (part.length >= 3 && /\p{L}/u.test(part)) out.add(part);
  }
  return [...out].sort((a, b) => b.length - a.length);
}

/** I nomi di battesimo (la prima parte di ogni nome): solo per loro una parola tutta maiuscola resta. */
export function givenNames(names: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const raw of names) {
    const first = raw.replace(/\s+/g, " ").trim().split(" ")[0] ?? "";
    if (first.length >= 3 && !first.includes("@")) out.add(first.toLowerCase());
  }
  return out;
}

/**
 * Copre e-mail, telefoni e nomi conosciuti. I nomi si cercano senza badare a maiuscole e minuscole («mario
 * rossi», «ROSSI»), tranne un nome di battesimo scritto tutto maiuscolo: «ROSA» nel titolo di una famiglia di
 * agenti resta anche se una persona si chiama Rosa.
 */
export function redact(text: string, tokens: readonly string[], given: ReadonlySet<string> = new Set()): string {
  let out = text.replace(EMAIL, PERSONA).replace(PHONE_CANDIDATE, (m) => (isPhone(m) ? "[numero]" : m));
  for (const token of tokens) {
    out = out.replace(new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegExp(token)}(?![\\p{L}\\p{N}])`, "giu"), (m) =>
      given.has(m.toLowerCase()) && m === m.toUpperCase() && m !== m.toLowerCase() ? m : PERSONA,
    );
  }
  return out;
}

function clean(text: string | null | undefined, max: number, tokens: readonly string[], given: ReadonlySet<string> = new Set()): string | null {
  if (!text) return null;
  const flat = text.replace(/\r\n?/g, "\n").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  if (!flat) return null;
  const covered = redact(flat, tokens, given);
  return covered.length > max ? `${covered.slice(0, max - 1).trimEnd()}…` : covered;
}

/** Una riga di elenco su una riga sola (i ritorni a capo diventano spazi). */
const oneLine = (text: string) => text.replace(/\s*\n\s*/g, " ");

const EUR = new Intl.NumberFormat("it-IT", { maximumFractionDigits: 0, useGrouping: "always" });

function dayLabel(day: string | null): string | null {
  if (!day || !/^\d{4}-\d{2}-\d{2}/.test(day)) return null;
  return `${day.slice(8, 10)}/${day.slice(5, 7)}/${day.slice(0, 4)}`;
}

/** Le due parti del pacchetto che contano per l'impronta: il testo di PACCHETTO.md senza intestazione e il brief. */
export function packageContent(source: PackageSource): { body: string; brief: string } {
  const L = PACKAGE_LIMITS;
  const t = nameTokens(source.namesToHide);
  const g = givenNames(source.namesToHide);
  const title = clean(source.title, 200, t, g) ?? source.code;
  const line = (label: string, text: string | null) => (text ? `- **${label}:** ${oneLine(text)}` : null);
  const kind = [source.kindLabel, source.origin ? `origine «${source.origin}»` : null, source.targetQuarter ? `approvato per il **${source.targetQuarter}**` : null]
    .filter(Boolean)
    .join(" · ");

  const scheda = [
    "## La scheda",
    `- **Titolo:** ${oneLine(title)}`,
    kind ? `- **Tipo:** ${kind}` : null,
    line("Oggi", clean(source.texts.oggi, L.textChars, t, g)),
    line("Come cambia (dalla scheda)", clean(source.texts.comeCambia, L.textChars, t, g)),
    line("Persone nel ciclo (dalla scheda)", clean(source.texts.persone, L.textChars, t, g)),
    line("Limiti (dalla scheda)", clean(source.texts.limiti, L.textChars, t, g)),
    line("Dati (dalla scheda)", clean(source.texts.dati, L.textChars, t, g)),
  ].filter((x): x is string => x !== null);

  const benefits = source.benefits.slice(0, L.maxBenefits);
  const valore = ["## Benefici e costi (stime del team, «ipotesi»)"];
  if (benefits.length) {
    valore.push("| Voce | Leva | € all'anno |", "|---|---|---|");
    for (const b of benefits) {
      const label = oneLine(clean(b.label, 200, t, g) ?? "Voce").replace(/\|/g, "/");
      valore.push(`| ${label} | ${b.lever.replace(/\|/g, "/")} | ${b.eurYear === null ? "da misurare" : EUR.format(Math.round(b.eurYear))} |`);
    }
  } else {
    valore.push("Benefici non ancora stimati nella scheda.");
  }
  valore.push("", source.costText ? `Costi: ${oneLine(source.costText)}.` : "Costi di avvio e ricorrenti: non ancora stimati nella scheda (li dà l'impostazione).");

  const hidden = source.needsHidden === true;
  const answers = hidden ? [] : source.answers.slice(0, L.maxAnswers);
  const risposte = hidden
    ? ["## Le risposte del referente", "Le porta nel pacchetto chi vede «Cosa serve» sulla scheda: chiedi a chi valuta lo use case di aggiornarlo."]
    : answers.length
    ? [
        "## Le risposte del referente",
        ...answers.map((a, i) => {
          const q = oneLine(clean(a.question, 200, t, g) ?? "Domanda");
          const when = dayLabel(a.on);
          return `${i + 1}. **${q}** (${[when, a.status].filter(Boolean).join(", ")}) ${oneLine(clean(a.answer, L.answerChars, t, g) ?? "")}`.trimEnd();
        }),
      ]
    : ["## Le risposte del referente", "Nessuna risposta ancora."];

  const needs = hidden ? [] : source.openNeeds.slice(0, L.maxNeeds);
  const serve = hidden
    ? ["## Cosa serve ancora (dalla scheda)", "Lo porta nel pacchetto chi vede «Cosa serve» sulla scheda."]
    : needs.length
    ? ["## Cosa serve ancora (dalla scheda)", ...needs.map((n) => `- ${oneLine(clean(n.title, 300, t, g) ?? "Esigenza")} (${n.status})`)]
    : ["## Cosa serve ancora (dalla scheda)", "Niente: «Cosa serve» è completo."];

  const body = [scheda.join("\n"), valore.join("\n"), risposte.join("\n"), serve.join("\n")].join("\n\n");

  const summary = clean(source.texts.comeCambia ?? source.texts.oggi, L.briefChars, t, g);
  const limits = clean(source.texts.limiti, 400, t, g);
  const brief = [`# ${source.code} · ${oneLine(title)}`, "", [summary ? oneLine(summary) : null, limits ? `Limiti: ${oneLine(limits)}` : null].filter(Boolean).join(" ")]
    .join("\n")
    .trimEnd();
  return { body, brief };
}

/** L'impronta del contenuto: SHA-256 del testo e del brief, senza versione né giorno. */
export function packageHash(content: { body: string; brief: string }): string {
  return createHash("sha256").update(`${content.body}\n\u0000\n${content.brief}`, "utf8").digest("hex");
}

/** L'impronta di un pacchetto importato (fatto a mano): PACCHETTO.md e BRIEF.md, senza VERSIONE (numero e giorno). */
export function packageFilesHash(files: Record<PackageFile, string>): string {
  return createHash("sha256").update(`${files["PACCHETTO.md"]}\n\u0000\n${files["BRIEF.md"]}`, "utf8").digest("hex");
}

/** I tre file di una versione. */
export function packageFiles(source: PackageSource, info: PackageVersionInfo, content = packageContent(source)): Record<PackageFile, string> {
  const k = `k${info.version}`;
  const day = dayLabel(info.day) ?? info.day;
  return {
    "PACCHETTO.md": [
      `# Pacchetto del caso ${source.code} (${k})`,
      "",
      `Sola lettura. Generato da Unbundle il ${day} dalla scheda: si aggiorna da Unbundle, mai a mano.`,
      "Nessun nome di persona: ruoli. Le cifre sono stime del team, non misure.",
      "",
      content.body,
      "",
    ].join("\n"),
    "BRIEF.md": `${content.brief}\n`,
    VERSIONE: `${k} · ${source.code} · ${info.day} · generato da Unbundle\n`,
  };
}
