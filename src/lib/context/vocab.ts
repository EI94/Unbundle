/**
 * Il vocabolario di «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §3.2; rilascio 9b,
 * RILASCIO-9b-COSTRUZIONE.md §3.4): gli elenchi dei valori delle tabelle `context_*` (drizzle/0038 e 0041, gli stessi dei
 * CHECK) e i limiti. Nessuna regola qui: le regole stanno nei
 * moduli puri accanto (`visibility.ts`, `scan.ts`, `read/reconcile.ts`), le scritture in `src/lib/db/queries/context-*.ts`.
 * Modulo puro: nessun import, si può importare anche dai componenti client.
 */

// ─── Fatti, sezioni, visibilità ──────────────────────────────────────

/** Le sette sezioni della Memoria, nell'ordine fisso della pagina. */
export const CONTEXT_SECTIONS = ["azienda", "persone", "lavoro", "sistemi", "obiettivi", "regole", "parole"] as const;
export type ContextSection = (typeof CONTEXT_SECTIONS)[number];
/** «Per tutti» (`tutti`) o «Solo Lateral Space» (`ls`). */
export const CONTEXT_VISIBILITIES = ["tutti", "ls"] as const;
export type ContextVisibility = (typeof CONTEXT_VISIBILITIES)[number];
/** «detto» negli appunti, o «dedotto» dal modello. */
export const BASES = ["detto", "dedotto"] as const;
export type Basis = (typeof BASES)[number];

// ─── Fonti ───────────────────────────────────────────────────────────

/** (9b) `risposta`: le risposte di un referente a una richiesta, come fonte (una per richiesta, il testo letto dal vivo). */
export const SOURCE_KINDS = ["appunti", "trascrizione", "documento", "risposta"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];
/** (9b) `cli`: `unbundle nota` e `unbundle impara`; `rispondi`: le risposte del referente da `/rispondi`. */
export const SOURCE_ORIGINS = ["web", "granola", "claude", "cli", "rispondi"] as const;
export type SourceOrigin = (typeof SOURCE_ORIGINS)[number];
/**
 * (9b) `external_id` di una fonte nata da `unbundle impara` (origine `cli`): «impara:» e l'id della fonte. Distingue una
 * cosa imparata costruendo da un appunto mandato con `unbundle nota` (stessa origine).
 */
export const LEARNED_SOURCE_PREFIX = "impara:";
export const READ_STATUSES = ["da_leggere", "in_lettura", "letto", "non_letto"] as const;
export type ReadStatus = (typeof READ_STATUSES)[number];
export const READ_REASONS = ["ok_mancante", "rifiuto", "tempo", "errore", "limite", "vuoto"] as const;
export type ReadReason = (typeof READ_REASONS)[number];
/** Quanti passaggi degli appunti la lettura non ha riportato, per motivo. */
export type SkippedCounts = { persone?: number; sanitari?: number; altri_clienti?: number; clienti_del_cliente?: number };

export const FACT_KINDS = ["fatto", "decisione"] as const;
export type FactKind = (typeof FACT_KINDS)[number];
export const FACT_STATUSES = ["attivo", "superato", "ritirato"] as const;
export type FactStatus = (typeof FACT_STATUSES)[number];
export const FACT_ORIGINS = ["fonte", "manuale"] as const;
export type FactOrigin = (typeof FACT_ORIGINS)[number];

// ─── Proposte ────────────────────────────────────────────────────────

export const PROPOSAL_KINDS = ["nuovo", "cambia", "conferma", "conflitto", "decisione", "impegno", "domanda"] as const;
export type ProposalKind = (typeof PROPOSAL_KINDS)[number];
export const PROPOSAL_STATUSES = ["aperta", "confermata", "scartata", "superata"] as const;
export type ProposalStatus = (typeof PROPOSAL_STATUSES)[number];
export const PROPOSAL_ISSUES = ["lungo", "nome_persona", "data_nascita", "codice_fiscale", "contatto"] as const;
export type ProposalIssue = (typeof PROPOSAL_ISSUES)[number];
/**
 * Un'entità citata da una proposta (`context_proposals.entities`). `refId`: per `unita`, `obiettivo` e `use_case`, la
 * riga che Unbundle ha già (`departments.id`, `strategic_goals.id`, `use_cases.id`), trovata negli elenchi alla lettura.
 */
export type ProposalEntity = { name: string; type: EntityType; refId?: string };
/** Un collegamento tra due entità della stessa proposta, per nome (`context_proposals.relations`). */
export type ProposalRelation = { from: string; verb: RelationVerb; to: string };

// ─── Impegni e domande ───────────────────────────────────────────────

export const COMMITMENT_PARTIES = ["nostra", "cliente"] as const;
export type CommitmentParty = (typeof COMMITMENT_PARTIES)[number];
export const COMMITMENT_STATUSES = ["aperto", "fatto", "annullato"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];
export const QUESTION_STATUSES = ["aperta", "chiusa", "ritirata"] as const;
export type QuestionStatus = (typeof QUESTION_STATUSES)[number];
export const QUESTION_ORIGINS = ["fonte", "manuale", "chiedi"] as const;
export type QuestionOrigin = (typeof QUESTION_ORIGINS)[number];

// ─── Mappa ───────────────────────────────────────────────────────────

export const ENTITY_TYPES = ["ruolo", "unita", "processo", "sistema", "dato", "fornitore", "obiettivo", "use_case"] as const;
export type EntityType = (typeof ENTITY_TYPES)[number];
/** Le entità che Unbundle ha già: il modello può citare solo quelle degli elenchi che riceve. */
export const LINKED_ENTITY_TYPES = ["unita", "obiettivo", "use_case"] as const satisfies readonly EntityType[];
export const RELATION_VERBS = ["usa", "gestisce", "decide", "dipende_da", "alimenta", "fornisce", "riguarda"] as const;
export type RelationVerb = (typeof RELATION_VERBS)[number];

// ─── Storia ──────────────────────────────────────────────────────────

/** (9b) `cli`: la CLI della fabbrica; `rispondi`: la pagina del referente. */
export const CONTEXT_CHANNELS = ["web", "claude", "granola", "cron", "cli", "rispondi"] as const;
export type ContextChannel = (typeof CONTEXT_CHANNELS)[number];
export const CONTEXT_EVENT_ACTIONS = [
  "fonte_aggiunta", "fonte_aggiornata", "fonte_letta", "fonte_tolta", "testo_cancellato", "documento_tolto",
  "proposte_confermate", "proposte_scartate", "conflitto_risolto",
  "fatto_confermato", "fatto_cambiato", "fatto_riconfermato", "fatto_ritirato", "fatto_scritto",
  "visibilita_cambiata", "sezione_cambiata",
  "impegno_aggiunto", "impegno_chiuso", "impegno_riaperto", "domanda_aggiunta", "domanda_chiusa",
  // (9b) La notte segna i fatti da verificare; `unbundle impara`; i legami con «Cosa serve»; «Cerca una persona»; uno use
  // case legato o slegato sul posto da «Modifica» (`detail.use_case`: lo strato `contesto` con `--dal` li conta).
  "fatti_da_verificare", "cosa_imparata", "richiesta_dalla_call", "richiesta_chiusa", "richiesta_scartata", "persona_tolta",
  "use_case_aggiunto", "use_case_tolto",
] as const;
export type ContextEventAction = (typeof CONTEXT_EVENT_ACTIONS)[number];

// ─── «Cosa serve» (9b) ───────────────────────────────────────────────

/**
 * Un fatto che risponde a una richiesta di «Cosa serve» (`context_need_links`, drizzle/0041): `proposta` alla lettura,
 * `aperta` alla conferma di un fatto «Per tutti», `usata` con «Chiudi con questo», `scartata` con «Non risponde».
 */
export const NEED_LINK_STATUSES = ["proposta", "aperta", "usata", "scartata"] as const;
export type NeedLinkStatus = (typeof NEED_LINK_STATUSES)[number];

// ─── Granola ─────────────────────────────────────────────────────────

export const GRANOLA_CONNECTION_STATUSES = ["attiva", "da_ricollegare"] as const;
export type GranolaConnectionStatus = (typeof GRANOLA_CONNECTION_STATUSES)[number];
export const GRANOLA_DECISIONS = ["entrata", "fuori", "bloccata"] as const;
export type GranolaDecision = (typeof GRANOLA_DECISIONS)[number];
export type GranolaDecidedBy = "regola" | "persona";

// ─── Limiti ──────────────────────────────────────────────────────────

export const CONTEXT_LIMITS = Object.freeze({
  titleMin: 3, titleMax: 200,
  bodyMin: 20, bodyMax: 300_000,          // caratteri di un appunto
  participantsMax: 500, linkMax: 500,
  statementMin: 3, statementMax: 200, proposalStatementMax: 400,
  quoteMax: 400, quoteAsked: 300,          // al modello se ne chiedono 300
  roleLabelMax: 80, questionMax: 200,
  proposalsPerCall: 25,                    // proposte per chiamata al modello
  partChars: 100_000, partsMax: 3,         // un appunto lungo si legge in al massimo 3 parti
  memoryFactsInPrompt: 600, useCasesInPrompt: 200, openItemsInPrompt: 50,
  readAttemptsMax: 3, readLeaseSeconds: 180,
  readsPerDayWorkspace: 200,
  askMin: 3, askMax: 300, asksPerHourUser: 30, asksPerDayWorkspace: 300, askSnippets: 24, askSnippetChars: 600,
  briefLines: 6, briefLineChars: 160, briefMinItems: 3, briefMinMinutes: 10,
  noveltiesShown: 5, seenVisitMinutes: 30,
  uploadMaxBytes: 4 * 1024 * 1024,         // il limite vero di una funzione Vercel è 4,5 MB a richiesta
  documentTextMax: 100_000,
  retentionMonths: 12,
  confirmMax: 75,
  // (9b) «Contesto nel lavoro» (RILASCIO-9b-COSTRUZIONE.md §3.4).
  staleMonths: 6,                          // un fatto non riconfermato da 6 mesi è «da verificare»
  noveltyDays: 14,                         // «Nuovo» e «Cambiato» nella scheda dello use case
  caseFactsMax: 40,                        // i fatti di uno use case nella scheda, nel dossier e in CONTESTO.md
  agentRulesMax: 25, agentWordsMax: 25,    // «Regole e vincoli» e «Parole del cliente» per gli agenti
  agentLineChars: 220,                     // una riga di CONTESTO.md e dello strato `contesto`
  promptBlockMaxChars: 4000,               // il blocco «Contesto» nei prompt della chat e dei generatori
  chatFacts: 8,                            // i fatti della chat, con le parole dell'ultimo messaggio
  needsInPrompt: 50,                       // le richieste aperte di «Cosa serve» nella lettura
  learnMin: 10, learnMax: 200, learnsPerDayWorkspace: 30, // `unbundle impara`
  cliNoteMaxBytes: 600 * 1024,             // `unbundle nota`
  personTermMin: 3, personTermMax: 80,     // «Cerca una persona»
  weeklyDueDays: 7,                        // gli impegni in scadenza nel riepilogo del lunedì
});
