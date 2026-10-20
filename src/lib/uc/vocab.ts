/**
 * Vocabolari della sezione «Casi d'uso»: una sola fonte per i valori ammessi.
 *
 * Da qui nascono i tipi TypeScript, le CHECK del DDL (`ddl.ts`, quindi la
 * migrazione 0018 e il self-heal) e i controlli lato server. Un valore nuovo si
 * aggiunge solo qui: il DDL aggiorna la CHECK con nome stabile
 * (`DROP CONSTRAINT IF EXISTS` + `ADD … NOT VALID` + `VALIDATE CONSTRAINT`).
 *
 * Modulo puro: nessun import, sintassi solo cancellabile (niente `enum`).
 */

// ── Caso ──────────────────────────────────────────────────────────────

/** Stati del caso, nell'ordine logico dello stepper di Avanzamento. */
export const CASE_STATUSES = [
  "bozza",
  "raccolta",
  "pronto_sviluppo",
  "in_sviluppo",
  "backtest",
  "collaudo",
  "stabilizzazione",
  "in_esercizio",
  "misura_roi",
  "sospeso",
  "chiuso",
] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

/** Ruoli di caso, sopra i ruoli del workspace (non li sostituiscono). */
export const CASE_ROLES = [
  "ls_lead",
  "ls_analista",
  "ls_sviluppatore",
  "owner_cliente",
  "approvatore_privacy",
  "ai_board",
  "osservatore",
] as const;
export type CaseRole = (typeof CASE_ROLES)[number];

/** Ruoli assegnabili solo a utenti Lateral Space. */
export const LS_CASE_ROLES = ["ls_lead", "ls_analista", "ls_sviluppatore"] as const satisfies readonly CaseRole[];
/** Ruoli assegnabili solo a utenti che non sono di Lateral Space. */
export const CLIENT_CASE_ROLES = ["owner_cliente", "approvatore_privacy", "ai_board"] as const satisfies readonly CaseRole[];
/** Ruoli assegnabili a entrambi. */
export const SHARED_CASE_ROLES = ["osservatore"] as const satisfies readonly CaseRole[];

export const DATA_MODES = ["solo_sintetici", "pseudonimizzati", "reali"] as const;
export type DataMode = (typeof DATA_MODES)[number];

// ── Template ──────────────────────────────────────────────────────────

export const TEMPLATE_STATUSES = ["bozza", "pubblicato", "ritirato"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

// ── Voci del catalogo ─────────────────────────────────────────────────

export const ITEM_KINDS = [
  "entita",
  "campo",
  "kpi",
  "decisione",
  "parametro",
  "vincolo_rigido",
  "vincolo_morbido",
  "obiettivo",
  "incertezza",
  "uscita",
  "formula",
  "regola",
  "fonte",
  "controllo_qualita",
  "domanda",
  "documento",
] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];

export const ITEM_SECTIONS = ["kpi", "modello_dati", "regole", "documenti_dataset"] as const;
export type ItemSection = (typeof ITEM_SECTIONS)[number];

export const ITEM_STATUSES = [
  "da_chiedere",
  "chiesta",
  "mancante",
  "parziale",
  "in_verifica",
  "validata",
  "non_applicabile",
  "bloccata",
] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

/** Classi privacy, dalla più restrittiva alla meno restrittiva. */
export const PRIVACY_CLASSES = [
  "escluso_sanitario",
  "personale_equipaggio",
  "personale",
  "riservato_azienda",
  "nessuna",
] as const;
export type PrivacyClass = (typeof PRIVACY_CLASSES)[number];

/** Classi i cui valori stanno solo cifrati (`uc_answers.value_encrypted`). */
export const PERSONAL_PRIVACY_CLASSES = ["personale", "personale_equipaggio"] as const satisfies readonly PrivacyClass[];
/** Classe che non ammette alcun valore, nemmeno cifrato. */
export const HEALTH_PRIVACY_CLASS = "escluso_sanitario" as const satisfies PrivacyClass;

export const PRIORITIES = ["must", "should", "could"] as const;
export type Priority = (typeof PRIORITIES)[number];

/** Usi della voce (`serves_for`). */
export const PHASES = ["baseline", "modello", "backtest", "monitoraggio", "roi"] as const;
export type Phase = (typeof PHASES)[number];

export const PERIMETERS = ["in_contratto", "evoluzione"] as const;
export type Perimeter = (typeof PERIMETERS)[number];

/** Le 8 leve di valore, nell'ordine delle icone della testata. */
export const LEVERS = [
  "tempo",
  "output",
  "qualita",
  "nuove_capacita",
  "decisioni",
  "costi",
  "ricavi",
  "rischio",
] as const;
export type Lever = (typeof LEVERS)[number];

export const VALUE_VISIBILITY = ["tutti_i_ruoli_del_caso", "owner_e_ls", "solo_ls"] as const;
export type ValueVisibility = (typeof VALUE_VISIBILITY)[number];

export const LINK_RELATIONS = [
  "usa",
  "deriva_da",
  "alimentato_da",
  "vincola",
  "controlla",
  "precisa",
  "dipende_da",
  "sostituisce",
] as const;
export type LinkRelation = (typeof LINK_RELATIONS)[number];

/**
 * Tipi di risposta. `azioni_universali` della specifica non è un tipo: sono le
 * azioni sempre presenti («Non lo so», delega, «Non si applica»).
 */
export const RESPONSE_TYPES = [
  "numero",
  "valuta",
  "percentuale",
  "durata",
  "data",
  "intervallo",
  "si_no",
  "scelta",
  "scelta_multipla",
  "testo",
  "codice",
  "tabella",
  "file",
  "dataset",
  "conferma_regola",
  "conferma_formula",
  "collegamento_sistema",
  "data_ora",
  "conferma_valore",
  "caso_prova",
] as const;
export type ResponseType = (typeof RESPONSE_TYPES)[number];

/** Da dove viene il blocco di una voce (`uc_item_blockers.origin`). */
export const ITEM_BLOCKER_ORIGINS = ["template", "scope", "manuale"] as const;
export type ItemBlockerOrigin = (typeof ITEM_BLOCKER_ORIGINS)[number];

// ── Blocchi e gate ────────────────────────────────────────────────────

export const BLOCKER_STATUSES = ["attivo", "sciolto", "permanente"] as const;
export type BlockerStatus = (typeof BLOCKER_STATUSES)[number];

/** Chiavi dei blocchi noti nell'MVP. La colonna accetta altre chiavi `^[a-z0-9_]+$`. */
export const BLOCKER_KEYS = [
  "a8",
  "fuori_foundation",
  "decisione_board",
  "accesso_sistema",
  "costi_art_8_4",
  "sanitario",
] as const;
export type BlockerKey = (typeof BLOCKER_KEYS)[number];

export const GATE_KEYS = ["G1", "G2", "G3", "G4"] as const;
export type GateKey = (typeof GATE_KEYS)[number];

export const GATE_DECISIONS = ["proposto", "approvato", "respinto", "approvato_con_riserva"] as const;
export type GateDecision = (typeof GATE_DECISIONS)[number];

/** Regola con cui si calcola l'insieme delle voci richieste dal gate. */
export const GATE_POLICY_SCOPES = ["request_modules", "letterale", "unione"] as const;
export type GatePolicyScope = (typeof GATE_POLICY_SCOPES)[number];

// ── Referenti, richieste e link ───────────────────────────────────────

export const CONTACT_CHANNELS = ["email", "whatsapp_manuale", "entrambi"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

export const REQUEST_STATUSES = [
  "bozza",
  "inviata",
  "aperta",
  "in_corso",
  "completata",
  "scaduta",
  "revocata",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Stati in cui un link può essere valido (oltre a scadenza, revoca ed epoca). */
export const LIVE_REQUEST_STATUSES = ["inviata", "aperta", "in_corso", "completata"] as const satisfies readonly RequestStatus[];

export const REQUEST_PURPOSES = ["raccolta", "approvazioni"] as const;
export type RequestPurpose = (typeof REQUEST_PURPOSES)[number];

export const REQUEST_CHANNELS = ["email", "link_manuale"] as const;
export type RequestChannel = (typeof REQUEST_CHANNELS)[number];

export const REQUEST_ITEM_STATES = ["da_fare", "bozza", "inviata", "delegata", "non_so", "riassegnata"] as const;
export type RequestItemState = (typeof REQUEST_ITEM_STATES)[number];

/** Stati che contano come «richiesta attiva» della voce (al massimo una per voce). */
export const ACTIVE_REQUEST_ITEM_STATES = ["da_fare", "bozza", "inviata"] as const satisfies readonly RequestItemState[];

export const TOKEN_ISSUED_FOR = ["invio", "promemoria", "copia", "delega"] as const;
export type TokenIssuedFor = (typeof TOKEN_ISSUED_FOR)[number];

// ── Risposte e verifiche ──────────────────────────────────────────────

export const ANSWER_KINDS = [
  "valore",
  "conferma",
  "correzione",
  "non_so",
  "delega",
  "proposta_na",
  "risposta_chiarimento",
] as const;
export type AnswerKind = (typeof ANSWER_KINDS)[number];

export const ANSWER_SOURCE_KINDS = [
  "referente",
  "lateral_space",
  "documento",
  "sistema",
  "import",
  "ai_proposta",
  "dichiarato_in_call",
] as const;
export type SourceKind = (typeof ANSWER_SOURCE_KINDS)[number];

export const SOURCE_BASIS = ["sistema", "documento", "stima_a_memoria", "calcolo"] as const;
export type SourceBasis = (typeof SOURCE_BASIS)[number];

export const CONFIDENCE = ["certo", "stima", "da_verificare"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const ANSWER_DEVICES = ["mobile", "desktop"] as const;
export type AnswerDevice = (typeof ANSWER_DEVICES)[number];

export const VALIDATION_KINDS = ["automatica", "umana"] as const;
export type ValidationKind = (typeof VALIDATION_KINDS)[number];

export const VALIDATION_OUTCOMES = ["ok", "avviso", "errore"] as const;
export type ValidationOutcome = (typeof VALIDATION_OUTCOMES)[number];

export const COMMENT_VISIBILITIES = ["interno_ls", "condiviso"] as const;
export type CommentVisibility = (typeof COMMENT_VISIBILITIES)[number];

export const COMMENT_KINDS = ["commento", "chiarimento_richiesto", "risposta_chiarimento"] as const;
export type CommentKind = (typeof COMMENT_KINDS)[number];

// ── File e dataset ────────────────────────────────────────────────────

export const STORAGE_ZONES = ["standard", "personale"] as const;
export type StorageZone = (typeof STORAGE_ZONES)[number];

export const FILE_PERSONAL_DATA = ["no", "pseudonimizzati", "identificativi", "sconosciuto"] as const;
export type FilePersonalData = (typeof FILE_PERSONAL_DATA)[number];

export const SCAN_STATUSES = ["in_quarantena", "pulito", "rifiutato"] as const;
export type ScanStatus = (typeof SCAN_STATUSES)[number];

export const DATASET_STATUSES = ["ricevuto", "profilato", "in_verifica", "validato", "rifiutato", "scaduto"] as const;
export type DatasetStatus = (typeof DATASET_STATUSES)[number];

// ── Mappe, misure, ROI, versioni, prove ───────────────────────────────

export const MAP_KINDS = [
  "processo_as_is",
  "processo_to_be",
  "flusso_dati",
  "sistemi",
  "incastri",
  "soluzione",
  "esempio",
] as const;
export type MapKind = (typeof MAP_KINDS)[number];

export const MAP_SOURCES = ["template", "claude", "manuale", "import"] as const;
export type MapSource = (typeof MAP_SOURCES)[number];

export const KPI_PHASES = ["baseline", "backtest", "esercizio"] as const;
export type KpiPhase = (typeof KPI_PHASES)[number];

export const RECORDED_BY = ["utente", "mcp", "sistema"] as const;
export type RecordedBy = (typeof RECORDED_BY)[number];

export const PROVISIONAL_STATUSES = ["provvisorio", "confermato"] as const;
export type ProvisionalStatus = (typeof PROVISIONAL_STATUSES)[number];

export const ROI_STATUSES = ["stima", "baseline", "backtest", "misurato"] as const;
export type RoiStatus = (typeof ROI_STATUSES)[number];

export const ROI_SCENARIOS = ["prudente", "base", "ottimistico"] as const;
export type RoiScenario = (typeof ROI_SCENARIOS)[number];

export const CATALOG_VERSION_REASONS = ["gate", "correzione", "aggiornamento_template"] as const;
export type CatalogVersionReason = (typeof CATALOG_VERSION_REASONS)[number];

export const TEST_CASE_KINDS = ["sintetico", "pseudonimizzato"] as const;
export type TestCaseKind = (typeof TEST_CASE_KINDS)[number];

export const TEST_CASE_RESULTS = ["superato", "fallito", "non_eseguito"] as const;
export type TestCaseResult = (typeof TEST_CASE_RESULTS)[number];

export const MODEL_RUN_KINDS = ["backtest", "casi_prova", "esercizio"] as const;
export type ModelRunKind = (typeof MODEL_RUN_KINDS)[number];

// ── Notifiche e audit ─────────────────────────────────────────────────

export const NOTIFICATION_STATUSES = ["in_coda", "inviata", "errore", "annullata"] as const;
export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[number];

/** Canali della coda. Nell'MVP si usano solo `email` e `in_app`. */
export const NOTIFICATION_CHANNELS = ["email", "in_app", "slack", "webhook"] as const;
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

export const EVENT_ACTOR_TYPES = ["utente", "referente", "sistema", "mcp"] as const;
export type EventActorType = (typeof EVENT_ACTOR_TYPES)[number];

// ── Interfaccia ───────────────────────────────────────────────────────

/** Colori del semaforo. La corrispondenza stato → colore sta in `semaforo.ts`. */
export const SEMAFORO_COLORS = ["verde", "blu", "giallo", "rosso", "grigio", "lucchetto"] as const;
export type SemaforoColor = (typeof SEMAFORO_COLORS)[number];

// ── Utilità ───────────────────────────────────────────────────────────

/** Vero se `value` è uno dei valori del vocabolario. Restringe il tipo. */
export function isVocab<const T extends readonly string[]>(vocab: T, value: unknown): value is T[number] {
  return typeof value === "string" && (vocab as readonly string[]).includes(value);
}
