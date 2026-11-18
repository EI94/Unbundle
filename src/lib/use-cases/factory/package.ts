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
 * **(9b) `CONTESTO.md`, facoltativo** (docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.4, D8): i fatti «Per tutti» che Lateral
 * Space ha confermato sul cliente, che `loadAgentContext` porta (mai un fatto «Solo Lateral Space», mai una citazione), con
 * i nomi coperti come negli altri file. C'è solo quando ci sono fatti da scrivere: senza, i file e l'impronta sono quelli di
 * prima della 9b, e un pacchetto senza contesto non diventa una versione nuova. Con il contesto l'impronta comprende anche
 * le sue sezioni (non l'intestazione, che porta versione e giorno).
 *
 * Modulo puro: import relativi `.ts`.
 */
import { createHash } from "node:crypto";
import type { PackageFile } from "../../db/use-case-hub-factory-ddl.ts";
import { formatContestoMd, type AgentContext, type AgentFact } from "../../context/work/agent-text.ts";

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
  /**
   * (9b) Il contesto del cliente per il caso, solo da `loadAgentContext` (fatti «Per tutti», senza citazioni). Assente o
   * null: nessun `CONTESTO.md`, come prima della 9b (archivio di «Contesto» non pronto).
   */
  context?: AgentContext | null;
  /**
   * (9b) Vero se l'archivio c'è ma il contesto non si è letto (un errore del database): il pacchetto non si salva, perché
   * senza `CONTESTO.md` nascerebbe una versione nuova e il suo avviso a chi costruisce. Si riprova.
   */
  contextUnavailable?: boolean;
}

/** (9b) I file facoltativi del pacchetto: `CONTESTO.md`, solo con fatti «Per tutti» da scrivere (§2.4). */
export const PACKAGE_OPTIONAL_FILES = ["CONTESTO.md"] as const;
export type PackageOptionalFile = (typeof PACKAGE_OPTIONAL_FILES)[number];
/** I file di una versione: i tre di sempre (il CHECK della 0030) e, quando c'è, `CONTESTO.md`. */
export type PackageFiles = Record<PackageFile, string> & Partial<Record<PackageOptionalFile, string>>;

/**
 * (9b) Da quando contano le novità del contesto per l'ultimo pacchetto (`contextDeltaSince`, §2.3, §2.5): dalla sua nascita
 * se ha `CONTESTO.md`; null (contano tutti i fatti) se non ce l'ha o se non c'è un pacchetto. La stessa regola per la riga
 * del brief e per quella del dossier.
 */
export function packageContextSince(latest: { createdAt: string; files: Partial<Record<string, string>> } | null): Date | null {
  if (!latest || typeof latest.files["CONTESTO.md"] !== "string") return null;
  const at = new Date(latest.createdAt);
  return Number.isNaN(at.getTime()) ? null : at;
}

/** Le due (o tre) parti del pacchetto che contano per l'impronta. */
export interface PackageContent {
  /** PACCHETTO.md senza intestazione. */
  body: string;
  brief: string;
  /** (9b) Le sezioni di CONTESTO.md, senza l'intestazione (codice, versione, giorno); null senza fatti da scrivere. */
  contesto: string | null;
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
 * rossi», «ROSSI»), tranne un nome di battesimo scritto tutto maiuscolo: «LUNA» nel titolo di una famiglia di
 * agenti resta anche se una persona si chiama Luna.
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

/**
 * (9b) Il contesto del cliente con i nomi coperti, come i testi degli altri file: le righe di «In breve», le frasi dei
 * fatti, gli impegni con il loro ruolo, le domande con a chi chiederle. Fonti, date e conti restano. Lo usano
 * `CONTESTO.md` e lo strato `contesto` della CLI e dell'MCP del caso.
 */
export function redactAgentContext(ctx: AgentContext, names: readonly string[]): AgentContext {
  const tokens = nameTokens(names);
  const given = givenNames(names);
  const hide = (text: string) => redact(text, tokens, given);
  const fact = (f: AgentFact): AgentFact => ({ ...f, statement: hide(f.statement) });
  return {
    brief: ctx.brief.map(hide),
    caseFacts: ctx.caseFacts.map(fact),
    rules: ctx.rules.map(fact),
    words: ctx.words.map(fact),
    commitments: ctx.commitments.map((c) => ({ ...c, statement: hide(c.statement), role: c.role === null ? null : hide(c.role) })),
    questions: ctx.questions.map((q) => ({ ...q, question: hide(q.question), askWhom: q.askWhom === null ? null : hide(q.askWhom) })),
    since: ctx.since,
  };
}

/**
 * (9b) Le sezioni di `CONTESTO.md` senza l'intestazione (il titolo con codice e versione, la riga con il giorno): la parte
 * che conta per l'impronta. null senza fatti «Per tutti» da scrivere.
 */
function contestoSections(ctx: AgentContext, code: string): string | null {
  const file = formatContestoMd(ctx, { code, version: 1, day: "" });
  if (file === null) return null;
  // Il file è «titolo, riga d'apertura, sezioni», separati da una riga vuota; nessuna riga ha un a capo dentro.
  return file.replace(/\n$/, "").split("\n\n").slice(2).join("\n\n");
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

/**
 * Le parti del pacchetto che contano per l'impronta: il testo di PACCHETTO.md senza intestazione, il brief e (9b) le
 * sezioni di CONTESTO.md, se ci sono fatti «Per tutti» da scrivere.
 */
export function packageContent(source: PackageSource): PackageContent {
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
    : ["## Cosa serve ancora (dalla scheda)", "Nessuna esigenza aperta in «Cosa serve» della scheda."];

  const body = [scheda.join("\n"), valore.join("\n"), risposte.join("\n"), serve.join("\n")].join("\n\n");

  const summary = clean(source.texts.comeCambia ?? source.texts.oggi, L.briefChars, t, g);
  const limits = clean(source.texts.limiti, 400, t, g);
  const brief = [`# ${source.code} · ${oneLine(title)}`, "", [summary ? oneLine(summary) : null, limits ? `Limiti: ${oneLine(limits)}` : null].filter(Boolean).join(" ")]
    .join("\n")
    .trimEnd();
  const contesto = source.context ? contestoSections(redactAgentContext(source.context, source.namesToHide), source.code) : null;
  return { body, brief, contesto };
}

/**
 * L'impronta del contenuto: SHA-256 del testo e del brief, senza versione né giorno. (9b) Con `CONTESTO.md` anche le sue
 * sezioni (`body\n\0\nbrief\n\0\ncontesto`); senza, l'impronta di prima della 9b, così un pacchetto senza contesto non
 * diventa una versione nuova.
 */
export function packageHash(content: { body: string; brief: string; contesto?: string | null }): string {
  const text = content.contesto ? `${content.body}\n\u0000\n${content.brief}\n\u0000\n${content.contesto}` : `${content.body}\n\u0000\n${content.brief}`;
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** L'impronta di un pacchetto importato (fatto a mano): PACCHETTO.md e BRIEF.md, senza VERSIONE (numero e giorno). */
export function packageFilesHash(files: Record<PackageFile, string>): string {
  return createHash("sha256").update(`${files["PACCHETTO.md"]}\n\u0000\n${files["BRIEF.md"]}`, "utf8").digest("hex");
}

/** I tre file di una versione e (9b) `CONTESTO.md`, quando ci sono fatti «Per tutti» da scrivere. */
export function packageFiles(source: PackageSource, info: PackageVersionInfo, content = packageContent(source)): PackageFiles {
  const k = `k${info.version}`;
  const day = dayLabel(info.day) ?? info.day;
  const files: PackageFiles = {
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
  if (content.contesto && source.context) {
    const contesto = formatContestoMd(redactAgentContext(source.context, source.namesToHide), { code: source.code, version: info.version, day: info.day });
    if (contesto) files["CONTESTO.md"] = contesto;
  }
  return files;
}
