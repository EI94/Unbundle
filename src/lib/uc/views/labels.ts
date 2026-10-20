/**
 * Vocabolario dell'interfaccia dei Casi d'uso: una sola fonte per le parole
 * (DESIGN §2.6). Tipi di voce, priorità, privacy, usi, relazioni, provenienze,
 * stati dei file, ruoli, fasi del caso, stato del via allo sviluppo e le parole
 * dello use case.
 *
 * Le etichette degli stati della voce restano in `semaforo.ts` (`STATUS_LABEL`)
 * e quelle degli stati del caso in `case-state.ts` (`CASE_STATUS_LABEL`), con
 * i testi di §2.6. I gruppi degli stati delle domande sono in `status-groups.ts`.
 *
 * Modulo puro e senza dipendenze di Node: si usa anche nei componenti client.
 */
import type {
  AnswerKind,
  CaseRole,
  CaseStatus,
  Confidence,
  DatasetStatus,
  FilePersonalData,
  ItemKind,
  LinkRelation,
  Perimeter,
  Phase,
  Priority,
  PrivacyClass,
  ScanStatus,
  SemaforoColor,
  SourceBasis,
  SourceKind,
} from "../vocab.ts";

// ── Parole (§2.6) ─────────────────────────────────────────────────────

/**
 * Le parole dell'interfaccia, una per cosa. «Voce» resta solo nel filtro di
 * Lateral Space «Mostra: Tutto il catalogo»; «gate», «template», must/should/
 * could, «A.8» e gli articoli non compaiono (`copy-guard.ts`).
 */
export const WORDS = {
  domanda: "domanda",
  domande: "Domande",
  argomento: "argomento",
  aPosto: "a posto",
  via: "Via allo sviluppo",
  daVerificare: "Da verificare",
  inVerificaCliente: "In verifica",
  attivita: "Attività",
  schedaPrivacy: "Scheda privacy",
  dopoSchedaPrivacy: "Si apre dopo la scheda privacy",
  passo: "passo",
  tappe: "Tappe",
  prossimaTappa: "Prossima tappa",
  schemaDiPartenza: "Schema di partenza",
  nelContratto: "Nel contratto",
  fuoriContratto: "Fuori contratto",
  indispensabile: "Indispensabile",
  utile: "Utile",
  facoltativa: "Facoltativa",
  nonSiApplica: "Non si applica",
  partireSenzaRisposta: "Partire senza risposta",
  proponiPartireSenzaRisposta: "Proponi di partire senza risposta",
  soluzioneProvvisoria: "Soluzione provvisoria",
  valoreDiPartenza: "Valore di partenza",
  provaSulPassato: "Prova sul passato",
  approvataDalCliente: "Approvata dal cliente",
  chiRisponde: "Chi risponde",
  datoPersonale: "Dato personale",
} as const;

/**
 * Parole dello use case (DESIGN §2.6, `docs/use-case/DESIGN.md`): «use case»
 * per l'idea, «dossier» e «Realizzazione» per ciò che si costruisce. «Caso
 * d'uso» non compare nella navigazione, nella pagina Use case e nella
 * campanella. Le usa WP10.
 */
export const USE_CASE_WORDS = {
  useCase: "use case",
  useCaseTitle: "Use case",
  dossier: "dossier",
  realizzazione: "Realizzazione",
  avviaRealizzazione: "Avvia la realizzazione",
  apriDossier: "Apri il dossier",
  schedaUseCase: "la scheda dello use case",
} as const;

/** Chi firma il via allo sviluppo (§2.6). */
export const SIGNERS_TEXT = "Firmano il responsabile Lateral Space e il responsabile del cliente.";

// ── Articoli davanti ai giorni ────────────────────────────────────────

/** Articolo o preposizione articolata davanti a un giorno («il 3 ott», «del 3 ott», «dal 3 ott»). */
export type DayArticle = "il" | "del" | "dal" | "al" | "nel" | "sul";

const ELIDED_ARTICLE: Readonly<Record<DayArticle, string>> = { il: "l'", del: "dell'", dal: "dall'", al: "all'", nel: "nell'", sul: "sull'" };

/**
 * Un giorno già formattato (`formatDayIt`, «3 ott») con il suo articolo. Davanti
 * a 1, 8 e 11 l'articolo si elide: «l'1 ott», «dell'8 ott», «dall'11 ott»; «il
 * 18 ott» resta com'è.
 */
export function dayWithArticle(article: DayArticle, day: string): string {
  return /^(?:1|8|11)(?!\d)/.test(day) ? `${ELIDED_ARTICLE[article]}${day}` : `${article} ${day}`;
}

// ── Ruoli (§2.6) ──────────────────────────────────────────────────────

/** Sostituisce `CASE_ROLE_LABEL` di `people.ts` e `SIGNATURE_ROLE_LABEL` di `progress.ts`. */
export const ROLE_LABEL: Readonly<Record<CaseRole | "referente", string>> = {
  ls_lead: "Responsabile Lateral Space",
  ls_analista: "Analista",
  ls_sviluppatore: "Sviluppatore",
  owner_cliente: "Responsabile del cliente",
  approvatore_privacy: "Approvatore privacy",
  ai_board: "AI Board",
  osservatore: "Osservatore",
  referente: "Referente",
};

// ── Fasi e stato del caso (§2.6) ──────────────────────────────────────

/** Le 5 fasi del caso, in ordine. «In pausa» e «Chiuso» sono stati, non fasi. */
export const CASE_PHASES = ["preparazione", "sviluppo", "prova", "rodaggio", "in_uso"] as const;
export type CasePhase = (typeof CASE_PHASES)[number];

export const CASE_PHASE_LABEL: Readonly<Record<CasePhase, string>> = {
  preparazione: "Preparazione",
  sviluppo: "Sviluppo",
  prova: "Prova",
  rodaggio: "Rodaggio",
  in_uso: "In uso",
};

/** Fase di ogni stato del caso; null per `sospeso` e `chiuso`. */
export const CASE_STATUS_PHASE: Readonly<Record<CaseStatus, CasePhase | null>> = {
  bozza: "preparazione",
  raccolta: "preparazione",
  pronto_sviluppo: "preparazione",
  in_sviluppo: "sviluppo",
  backtest: "prova",
  collaudo: "prova",
  stabilizzazione: "rodaggio",
  in_esercizio: "in_uso",
  misura_roi: "in_uso",
  sospeso: null,
  chiuso: null,
};

/**
 * Fase da mostrare nella striscia delle tappe. Un caso in pausa mostra la fase
 * in cui era; `complete` vale per «Preparazione ✓» (`pronto_sviluppo`).
 */
export function casePhaseOf(status: CaseStatus, statusBeforeSuspension?: CaseStatus | null): { phase: CasePhase; complete: boolean } | null {
  const effective = status === "sospeso" && statusBeforeSuspension ? statusBeforeSuspension : status;
  const phase = CASE_STATUS_PHASE[effective];
  return phase ? { phase, complete: effective === "pronto_sviluppo" } : null;
}

/**
 * Colore del puntino di stato del caso (`StatusDot`), §2.6 «Stati del caso
 * (`CASE_STATUS_LABEL`, `CASE_STATUS_TONE`)». Una pausa non è un errore:
 * grigio. È l'unica fonte: `CASE_STATUS_TONE` di `views/case-shell.ts` (con la
 * pausa ancora rossa) diventa una riesportazione di questa in C1 (WP1).
 */
export const CASE_STATUS_TONE: Readonly<Record<CaseStatus, SemaforoColor>> = {
  bozza: "grigio",
  raccolta: "giallo",
  pronto_sviluppo: "verde",
  in_sviluppo: "blu",
  backtest: "blu",
  collaudo: "blu",
  stabilizzazione: "blu",
  in_esercizio: "verde",
  misura_roi: "blu",
  sospeso: "grigio",
  chiuso: "grigio",
};

// ── Via allo sviluppo (§2.6) ──────────────────────────────────────────

/** Stato del via allo sviluppo: sostituisce la pill «Pronto/Chiuso». */
export const GATE_STATES = ["non_ancora", "si_puo_proporre", "in_attesa_firme", "approvato", "da_riconfermare"] as const;
export type GateState = (typeof GATE_STATES)[number];

export const GATE_STATE_LABEL: Readonly<Record<GateState, string>> = {
  non_ancora: "Non ancora",
  si_puo_proporre: "Si può proporre",
  in_attesa_firme: "In attesa delle firme",
  approvato: "Approvato",
  da_riconfermare: "Da riconfermare",
};

/** «Approvato il 3 ott» («l'8 ott») con la data già formattata (`formatDayIt`), le altre come da tabella. */
export function gateStateLabel(state: GateState, approvedOn?: string | null): string {
  return state === "approvato" && approvedOn ? `Approvato ${dayWithArticle("il", approvedOn)}` : GATE_STATE_LABEL[state];
}

// ── Catalogo ──────────────────────────────────────────────────────────

export const KIND_LABEL: Readonly<Record<ItemKind, { one: string; many: string }>> = {
  entita: { one: "Entità", many: "Entità" },
  campo: { one: "Campo", many: "Campi" },
  kpi: { one: "KPI", many: "KPI" },
  decisione: { one: "Decisione", many: "Decisioni" },
  parametro: { one: "Parametro", many: "Parametri" },
  vincolo_rigido: { one: "Vincolo rigido", many: "Vincoli rigidi" },
  vincolo_morbido: { one: "Vincolo morbido", many: "Vincoli morbidi e preferenze" },
  obiettivo: { one: "Obiettivo", many: "Obiettivi" },
  incertezza: { one: "Incertezza", many: "Incertezze" },
  uscita: { one: "Uscita", many: "Uscite" },
  formula: { one: "Formula", many: "Formule" },
  regola: { one: "Regola", many: "Regole" },
  fonte: { one: "Fonte", many: "Fonti" },
  controllo_qualita: { one: "Controllo di qualità", many: "Controlli di qualità" },
  domanda: { one: "Domanda", many: "Domande" },
  documento: { one: "Documento", many: "Documenti" },
};

/** Ordine dei tipi nei filtri e nei riepiloghi: prima le domande, poi il modello. */
export const KIND_ORDER: readonly ItemKind[] = [
  "domanda",
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
  "documento",
];

/** Elementi del modello («Variabili del modello»), nell'ordine del prototipo. */
export const MODEL_VARIABLE_KINDS: readonly ItemKind[] = ["decisione", "parametro", "vincolo_rigido", "vincolo_morbido", "obiettivo", "incertezza", "uscita"];

/** Priorità in parole (§2.6): must/should/could restano solo nei filtri ed export. */
export const PRIORITY_LABEL: Readonly<Record<Priority, string>> = { must: WORDS.indispensabile, should: WORDS.utile, could: WORDS.facoltativa };

export const PRIVACY_LABEL: Readonly<Record<PrivacyClass, string>> = {
  escluso_sanitario: "Sanitario: mai",
  personale_equipaggio: "Personale equipaggio",
  personale: "Personale",
  riservato_azienda: "Riservato azienda",
  nessuna: "Nessuna",
};

/** A cosa serve una voce (`serves_for`). */
export const PHASE_LABEL: Readonly<Record<Phase, string>> = {
  baseline: WORDS.valoreDiPartenza,
  modello: "Modello",
  backtest: WORDS.provaSulPassato,
  monitoraggio: "Monitoraggio",
  roi: "ROI",
};

export const PERIMETER_LABEL: Readonly<Record<Perimeter, string>> = { in_contratto: WORDS.nelContratto, evoluzione: WORDS.fuoriContratto };

/** Relazione letta dalla voce di partenza (`out`) e da quella di arrivo (`in`). */
export const RELATION_LABEL: Readonly<Record<LinkRelation, { out: string; in: string }>> = {
  usa: { out: "Usa", in: "Usata da" },
  deriva_da: { out: "Deriva da", in: "Da cui derivano" },
  alimentato_da: { out: "Alimentata da", in: "Alimenta" },
  vincola: { out: "Vincola", in: "Vincolata da" },
  controlla: { out: "Controlla", in: "Controllata da" },
  precisa: { out: "Precisa", in: "Precisata dalla domanda" },
  dipende_da: { out: "Dipende da", in: "Da cui dipendono" },
  sostituisce: { out: "Sostituisce", in: "Sostituita da" },
};

export const SOURCE_KIND_LABEL: Readonly<Record<SourceKind, string>> = {
  referente: "Referente",
  lateral_space: "Lateral Space",
  documento: "Documento",
  sistema: "Sistema",
  import: "Import",
  ai_proposta: "Proposta AI",
  dichiarato_in_call: "Dichiarato in call",
};

export const ANSWER_KIND_LABEL: Readonly<Record<AnswerKind, string>> = {
  valore: "Valore",
  conferma: "Conferma",
  correzione: "Correzione",
  non_so: "Non lo so",
  delega: "Delega a un collega",
  proposta_na: "Proposta «non si applica»",
  risposta_chiarimento: "Risposta al chiarimento",
};

export const SOURCE_BASIS_LABEL: Readonly<Record<SourceBasis, string>> = {
  sistema: "Dal sistema",
  documento: "Da un documento",
  stima_a_memoria: "Stima a memoria",
  calcolo: "Calcolo",
};

export const CONFIDENCE_LABEL: Readonly<Record<Confidence, string>> = { certo: "Certo", stima: "È una stima", da_verificare: "Da verificare" };

export const SCAN_STATUS_LABEL: Readonly<Record<ScanStatus, string>> = { in_quarantena: "In controllo", pulito: "Controllato", rifiutato: "Rifiutato" };

export const DATASET_STATUS_LABEL: Readonly<Record<DatasetStatus, string>> = {
  ricevuto: "Ricevuto",
  profilato: "Profilato",
  in_verifica: "In verifica",
  validato: "Validato",
  rifiutato: "Rifiutato",
  scaduto: "Scaduto",
};

export const FILE_PERSONAL_DATA_LABEL: Readonly<Record<FilePersonalData, string>> = {
  no: "Nessun dato personale",
  pseudonimizzati: "Dati pseudonimizzati",
  identificativi: "Dati identificativi",
  sconosciuto: "Dati personali da verificare",
};

/** Testo leggibile di un token: «fuori_foundation» → «Fuori foundation». */
export function humanizeToken(token: string): string {
  const t = token.replace(/_/g, " ").trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : token;
}

const AVAILABILITY_LABEL: Readonly<Record<string, string>> = {
  oggi_export: "Export disponibile oggi",
  dopo_a8: "Dopo la scheda privacy",
  da_chiedere: "Da chiedere",
  da_costruire: "Da costruire",
  fuori_foundation: WORDS.fuoriContratto,
};

/** Disponibilità di un dato: le note del template restano nei dettagli. */
export function availabilityLabel(token: string): string {
  const known = AVAILABILITY_LABEL[token];
  if (known) return known;
  if (token.startsWith("con_api")) return "Con accesso via API";
  return humanizeToken(token);
}

/** Nomi brevi dei blocchi (§3.4, «Etichetta breve»): niente articoli né «A.8». */
const BLOCKER_LABEL: Readonly<Record<string, string>> = {
  a8: WORDS.schedaPrivacy,
  decisione_board: "Decisione dell'AI Board",
  fuori_foundation: WORDS.fuoriContratto,
  accesso_sistema: "Accesso al sistema",
  costi_art_8_4: "Costi da approvare",
  sanitario: "Dati sanitari: mai",
};

/** Nome di un blocco dalla sua chiave (quando l'etichetta del caso non c'è). */
export function blockerLabel(key: string): string {
  return BLOCKER_LABEL[key] ?? humanizeToken(key);
}

/** Sistema di una fonte (`src.<sistema>.<oggetto>`). */
export function sourceSystem(key: string): string | null {
  const parts = key.split(".");
  return parts[0] === "src" && parts.length >= 3 ? parts[1] : null;
}

/** Eventi della storia di una domanda: senza «voce» (§2.6), il soggetto è la domanda stessa. */
const EVENT_LABEL: Readonly<Record<string, string>> = {
  "voce.creata": "Aggiunta al catalogo",
  "voce.modificata": "Modificata",
  "voce.classe_privacy_cambiata": "Classe privacy cambiata",
  "voce.stato_cambiato": "Stato cambiato",
  "voce.stato_importato": "Stato iniziale importato",
  "voce.assegnata": "Assegnata a chi risponde",
  "voce.na_proposta": "Proposta «non si applica»",
  "voce.na_firmata": "Firma su «non si applica»",
  "voce.na_respinta": "«Non si applica» respinta",
  "voce.deroga_firmata": "Firma su «partire senza risposta»",
  "voce.ripiego_firmato": "Firma sulla soluzione provvisoria",
  "risposta.inviata": "Risposta ricevuta",
  "risposta.letta_personale": "Valore personale letto",
  "risposta.cancellata_privacy": "Valore cancellato per privacy",
  "validazione.registrata": "Controllo registrato",
  "commento.creato": "Commento aggiunto",
  "chiarimento.richiesto": "Chiarimento chiesto",
  "chiarimento.risolto": "Chiarimento chiuso",
  "file.caricato": "File caricato",
  "file.rifiutato": "File rifiutato",
  "file.revisionato": "File revisionato",
  "file.scaricato": "File scaricato",
  "file.cancellato": "File cancellato",
  "blocco.attivato": "Blocco attivato",
  "blocco.sciolto": "Blocco sciolto",
  "blocco.riattivato": "Blocco riattivato",
  "richiesta.inviata": "Richiesta inviata",
  "richiesta.revocata": "Richiesta revocata",
  "delega.creata": "Delega a un collega",
  "seed.applicato": "Stato di partenza caricato",
  "seed.valore_omesso": "Valore già dichiarato, non caricato",
};

export function eventLabel(type: string): string {
  return EVENT_LABEL[type] ?? humanizeToken(type.replace(".", " "));
}

const EVENT_ACTOR_LABEL: Readonly<Record<string, string>> = { utente: "Persona con account", referente: "Referente", sistema: "Sistema", mcp: "Claude via MCP" };

export function eventActorLabel(type: string): string {
  return EVENT_ACTOR_LABEL[type] ?? humanizeToken(type);
}
