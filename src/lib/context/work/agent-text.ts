/**
 * Il contesto del cliente per i coding agent (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md §2.4, §2.5): il file
 * `CONTESTO.md` del pacchetto, lo strato `contesto` di `unbundle context` e di `get_case_context`, la riga del brief, e i
 * testi di `unbundle contesto`, `nota` e `impara`. Dicono «caso», come il pacchetto e il brief di oggi.
 *
 * - **Solo «Per tutti» (D1).** I fatti li porta `loadAgentContext` (src/lib/db/queries/context-work.ts), che non legge mai
 *   un fatto «Solo Lateral Space», nemmeno quando chiede Lateral Space.
 * - **Mai nomi né citazioni.** Qui non arriva nessuna citazione. I nomi che Unbundle conosce li copre chi scrive il
 *   pacchetto e lo strato (`redact` di `factory/package.ts`), come per gli altri file.
 * - **Corto.** Ogni riga al massimo 220 caratteri; le sezioni vuote non si scrivono.
 *
 * Modulo puro: import relativi `.ts`.
 */
import type { SourceLabelKind } from "../labels.ts";
import { cut } from "../normalize.ts";
import { CONTEXT_LIMITS, type CommitmentParty, type ContextSection } from "../vocab.ts";

/** Da dove viene un fatto, per gli agenti: lo stesso tipo della pagina (`factSourceLabel`). */
export type AgentSourceKind = SourceLabelKind;

/**
 * Un fatto «Per tutti» per gli agenti. `source`: il tipo della fonte («call», «documento», «referente», «costruzione»,
 * «manuale», «senza_fonte»); `on`: il giorno della fonte (`AAAA-MM-GG`), o quello dell'ultima conferma per un fatto senza
 * una fonte con la data.
 */
export interface AgentFact {
  statement: string;
  section: ContextSection;
  source: AgentSourceKind;
  on: string;
}

/** Il contesto di un caso per gli agenti (`loadAgentContext`): sempre e solo «Per tutti». */
export interface AgentContext {
  /** Le righe di «In breve» (al massimo 6). */
  brief: string[];
  /** I fatti legati allo use case (al massimo 40), per sezione e dal più recente. */
  caseFacts: AgentFact[];
  /** «Regole e vincoli» del cliente che non sono già tra quelli dello use case (al massimo 25). */
  rules: AgentFact[];
  /** «Parole del cliente» che non sono già tra quelli dello use case (al massimo 25). */
  words: AgentFact[];
  /** Gli impegni aperti dello use case, per parte e ruolo (mai per persona). `dueOn`: `AAAA-MM-GG`. */
  commitments: Array<{ statement: string; party: CommitmentParty; role: string | null; dueOn: string | null }>;
  /** Le domande aperte dello use case. */
  questions: Array<{ question: string; askWhom: string | null }>;
  /**
   * Con `since`: da quando (`AAAA-MM-GG`) e quanti fatti sono nuovi, cambiati o tolti per chi legge il caso, anche sul posto
   * (allargati o legati sono nuovi, ristretti o slegati tolti); i fatti qui sopra sono solo i nuovi e i cambiati.
   */
  since: { from: string; added: number; changed: number; retired: number } | null;
}

/** I testi per gli agenti: «caso», persone per ruolo, nessuna chiave interna. */
export const AGENT_CONTEXT_TEXT = Object.freeze({
  /** `CONTESTO.md` (§2.4). */
  file: Object.freeze({
    title: (code: string, version: number) => `# Contesto del cliente per ${code} (k${version})`,
    lead: (day: string) =>
      `Sola lettura: lo scrive Unbundle con i fatti che Lateral Space ha confermato. Le persone sono indicate per ruolo. Aggiornato il ${day}.`,
    brief: "## In breve",
    caseFacts: "## Che cosa tocca questo caso",
    rules: "## Regole e vincoli",
    words: "## Parole del cliente",
  }),
  /** Lo strato `contesto` (§2.5). */
  layer: Object.freeze({
    title: (code: string) => `Contesto del cliente per ${code}`,
    brief: "In breve",
    caseFacts: "Che cosa tocca questo caso",
    rules: "Regole e vincoli",
    words: "Parole del cliente",
    commitments: "Impegni aperti",
    questions: "Domande aperte",
    ours: "nostro",
    theirs: "del cliente",
    due: (date: string) => `entro il ${date}`,
    askWhom: (role: string) => `da chiedere a: ${role}`,
    since: (date: string, parts: string) => `Dal ${date}: ${parts}.`,
    sinceNothing: (date: string) => `Dal ${date}: niente di nuovo nel contesto.`,
    added: (n: number) => (n === 1 ? "1 fatto nuovo" : `${n} fatti nuovi`),
    changed: (n: number) => (n === 1 ? "1 cambiato" : `${n} cambiati`),
    retired: (n: number) => (n === 1 ? "1 tolto" : `${n} tolti`),
    empty: "Ancora niente nella memoria del cliente per questo caso.",
    footer: "I fatti li conferma Lateral Space. Se un fatto non torna, dillo alla persona: non correggerlo nel repository.",
  }),
  /** Da dove viene un fatto, tra parentesi dopo la frase. */
  source: Object.freeze({
    call: (date: string) => `call del ${date}`,
    callWord: "call",
    documento: (date: string) => `documento del ${date}`,
    documentoWord: "documento",
    referente: (date: string) => `risposta del referente del ${date}`,
    referenteWord: "risposta del referente",
    costruzione: (date: string) => `imparato costruendo il ${date}`,
    costruzioneWord: "imparato costruendo",
    manuale: "scritto a mano",
    senzaFonte: "senza fonte",
  }),
  /** La riga del brief (§2.5). */
  briefLine: Object.freeze({
    delta: (n: number, version: number, code: string) => `Contesto: ${n} novità dopo il pacchetto k${version} (unbundle context ${code} --contesto).`,
    facts: (n: number, code: string) => `Contesto: ${n === 1 ? "1 fatto" : `${n} fatti`} sul cliente (unbundle context ${code} --contesto).`,
  }),
  /** `unbundle contesto <ID> "domanda"` (§2.5). */
  ask: Object.freeze({
    answer: "Risposta:",
    sources: "Fonti:",
    source: (n: number, kind: string, where: string, excerpt: string) => `[${n}] ${kind} · ${where} · ${excerpt}`,
    unknown: "Non lo sappiamo ancora.",
    searchOnly: "Per una risposta scritta serve l'ok del cliente ai fornitori di AI. Ecco che cosa ho trovato:",
    nothing: "Non ho trovato niente su questo.",
    limit: "Troppe domande in poco tempo: riprova tra qualche minuto.",
  }),
  /** `unbundle nota` (§2.5). */
  note: Object.freeze({
    saved: (link: string) => `Appunti salvati: li leggo adesso. Le proposte arrivano in «Da confermare»: ${link}`,
    duplicate: (link: string) => `Questi appunti ci sono già: ${link}`,
    savedNoConsent: "Appunti salvati. Per leggerli con l'AI serve l'ok del cliente ai fornitori: si registra da Unbundle.",
    lsOnly: "Gli appunti li aggiunge solo Lateral Space.",
    tooBig: "Il file è troppo grande per la CLI, o non è testo: usa «Aggiungi appunti» sul web.",
  }),
  /** `unbundle impara` (§2.5). */
  learn: Object.freeze({
    saved: "Salvato come proposta: Lateral Space la controlla prima che entri nella memoria del cliente.",
    known: "Lo sappiamo già: ho chiesto di riconfermarlo.",
    alreadyProposed: "È già tra le proposte da confermare.",
    needYes: "Serve il sì della persona: chiedilo, poi ripeti con --si.",
    tooShort: "Scrivi una frase di almeno 10 caratteri: una cosa per volta.",
    tooLong: "Al massimo 200 caratteri: una cosa per volta.",
    limit: "Per oggi le cose imparate sono tante: riprova domani o scrivile sul web.",
  }),
  /** Senza la 0041 (`contextWorkReady` falso): `nota` e `impara` rispondono 503. */
  unavailable: "Unbundle non risponde: riprova tra qualche minuto.",
});

const T = AGENT_CONTEXT_TEXT;
const LINE_MAX = CONTEXT_LIMITS.agentLineChars;
const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Una riga: spazi ridotti a uno, al massimo 220 caratteri (con «…»). */
function clip(line: string): string {
  const flat = String(line ?? "").replace(/\s+/g, " ").trim();
  return flat.length <= LINE_MAX ? flat : `${cut(flat, LINE_MAX - 1).trimEnd()}…`;
}

/** `AAAA-MM-GG` come «14/11/2026», o "" se non è un giorno. */
export function slashDay(iso: string | null | undefined): string {
  const match = ISO_DAY.exec(String(iso ?? "").slice(0, 10));
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "";
}

/** «call del 14/11/2026», «risposta del referente del …», «imparato costruendo il …», «scritto a mano», «senza fonte». */
export function agentSourcePhrase(fact: Pick<AgentFact, "source" | "on">): string {
  const day = slashDay(fact.on);
  const S = T.source;
  switch (fact.source) {
    case "call":
      return day ? S.call(day) : S.callWord;
    case "documento":
      return day ? S.documento(day) : S.documentoWord;
    case "referente":
      return day ? S.referente(day) : S.referenteWord;
    case "costruzione":
      return day ? S.costruzione(day) : S.costruzioneWord;
    case "manuale":
      return S.manuale;
    default:
      return S.senzaFonte;
  }
}

const factLine = (fact: AgentFact) => clip(`- ${fact.statement.replace(/\s+/g, " ").trim()} (${agentSourcePhrase(fact)})`);
const briefLines = (brief: readonly string[]) =>
  brief
    .map((line) => String(line ?? "").replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .slice(0, CONTEXT_LIMITS.briefLines)
    .map((line) => clip(`- ${line}`));

/** I fatti di `CONTESTO.md` e dello strato, nell'ordine e con i tetti del piano. */
function factSections(ctx: Pick<AgentContext, "caseFacts" | "rules" | "words">) {
  return {
    caseFacts: ctx.caseFacts.slice(0, CONTEXT_LIMITS.caseFactsMax).map(factLine),
    rules: ctx.rules.slice(0, CONTEXT_LIMITS.agentRulesMax).map(factLine),
    words: ctx.words.slice(0, CONTEXT_LIMITS.agentWordsMax).map(factLine),
  };
}

/**
 * `CONTESTO.md` (§2.4): «In breve», i fatti dello use case, «Regole e vincoli», «Parole del cliente». Le sezioni vuote non
 * si scrivono. null quando non c'è nessun fatto «Per tutti» da scrivere (D8): senza fatti il pacchetto resta quello di
 * prima, anche se «In breve» ha delle righe. `day`: il giorno del pacchetto, `AAAA-MM-GG`.
 */
export function formatContestoMd(ctx: AgentContext, i: { code: string; version: number; day: string }): string | null {
  const facts = factSections(ctx);
  if (facts.caseFacts.length === 0 && facts.rules.length === 0 && facts.words.length === 0) return null;
  const F = T.file;
  const sections: Array<[string, string[]]> = [
    [F.brief, briefLines(ctx.brief)],
    [F.caseFacts, facts.caseFacts],
    [F.rules, facts.rules],
    [F.words, facts.words],
  ];
  const body = sections.filter(([, lines]) => lines.length > 0).map(([heading, lines]) => [heading, ...lines].join("\n"));
  return `${[F.title(i.code, i.version), F.lead(i.day), ...body].join("\n\n")}\n`;
}

/** Un impegno: «Inviare l'esportazione · del cliente · Responsabile amministrativo · entro il 25/11/2026». */
function commitmentLine(c: AgentContext["commitments"][number]): string {
  const L = T.layer;
  const due = slashDay(c.dueOn);
  const parts = [c.statement.replace(/\s+/g, " ").trim(), c.party === "nostra" ? L.ours : L.theirs, c.role?.trim() || null, due ? L.due(due) : null];
  return clip(`- ${parts.filter((part): part is string => Boolean(part)).join(" · ")}`);
}

/** Una domanda: «Chi approva gli acquisti sopra soglia? · da chiedere a: Direzione acquisti». */
function questionLine(q: AgentContext["questions"][number]): string {
  const parts = [q.question.replace(/\s+/g, " ").trim(), q.askWhom?.trim() ? T.layer.askWhom(q.askWhom.trim()) : null];
  return clip(`- ${parts.filter((part): part is string => Boolean(part)).join(" · ")}`);
}

/**
 * Lo strato `contesto` (§2.5), lo stesso testo per la CLI e per l'MCP del caso. Con `since`: in cima «Dal …: 3 fatti
 * nuovi, 1 cambiato, 1 tolto.» e sotto solo i fatti nuovi e cambiati (quelli che `loadAgentContext` porta con `since`),
 * oppure «Dal …: niente di nuovo nel contesto.». Senza niente: «Ancora niente nella memoria del cliente per questo caso.».
 */
export function formatAgentContext(ctx: AgentContext, i: { code: string }): string {
  const L = T.layer;
  const facts = factSections(ctx);
  const head = L.title(i.code);
  const block = (title: string, lines: string[]) => (lines.length > 0 ? [title, ...lines] : []);
  const factBlocks = [...block(L.caseFacts, facts.caseFacts), ...block(L.rules, facts.rules), ...block(L.words, facts.words)];

  if (ctx.since) {
    const day = slashDay(ctx.since.from);
    const parts = [
      ctx.since.added > 0 ? L.added(ctx.since.added) : null,
      ctx.since.changed > 0 ? L.changed(ctx.since.changed) : null,
      ctx.since.retired > 0 ? L.retired(ctx.since.retired) : null,
    ].filter((part): part is string => part !== null);
    if (parts.length === 0) return [head, "", L.sinceNothing(day)].join("\n");
    const lines = [head, "", L.since(day, parts.join(", "))];
    if (factBlocks.length > 0) lines.push("", ...factBlocks, "", L.footer);
    return lines.join("\n");
  }

  const blocks = [
    ...block(L.brief, briefLines(ctx.brief)),
    ...factBlocks,
    ...block(L.commitments, ctx.commitments.map(commitmentLine)),
    ...block(L.questions, ctx.questions.map(questionLine)),
  ];
  if (blocks.length === 0) return [head, "", L.empty].join("\n");
  return [head, "", ...blocks, "", L.footer].join("\n");
}

/**
 * La riga del brief (§2.5), solo quando ci sono novità: «Contesto: 3 novità dopo il pacchetto k2 (unbundle context
 * XX-0012 --contesto).»; senza pacchetto e con fatti «Contesto: 12 fatti sul cliente (…).». `delta`: le righe di
 * `CONTESTO.md` che cambierebbero dall'ultimo pacchetto, o quanti fatti ci sono senza pacchetto (`packageContextDelta` di
 * `factory/package.ts`). null senza niente da dire.
 */
export function contextBriefLine(i: { code: string; delta: number; packageVersion: number | null }): string | null {
  const n = Number.isFinite(i.delta) ? Math.floor(i.delta) : 0;
  if (n <= 0) return null;
  return i.packageVersion !== null && Number.isInteger(i.packageVersion) && i.packageVersion > 0 ? T.briefLine.delta(n, i.packageVersion, i.code) : T.briefLine.facts(n, i.code);
}
