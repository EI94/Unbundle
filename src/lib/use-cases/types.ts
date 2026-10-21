/**
 * Tipi condivisi dell'area «Use case» (docs/use-case/DESIGN.md §3.4, §3.6, §3.7, §9.1).
 *
 * Solo tipi, e gli elenchi di valori da cui nascono: nessuna regola. Le regole stanno
 * nei moduli puri (`phase.ts`, `quarter.ts`, `decisions.ts`…), le scritture in
 * `service.ts`. Modulo puro: nessun import, nessun `server-only`, si può importare
 * anche dai componenti client.
 */

// ─── Fase e sotto-stato (§3.4) ───────────────────────────────────────

/** Le cinque fasi, nell'ordine in cui le vive uno use case. */
export const PHASES = ["da_valutare", "approvato", "in_realizzazione", "realizzato", "chiuso"] as const;
export type Phase = (typeof PHASES)[number];

/** I sotto-stati di ogni fase. A schermo: una pillola sola, «Fase · sotto-stato». */
export const SUB_STATES = {
  da_valutare: ["nuova", "possibile_doppione", "serve_info", "valutata", "rimandata", "da_rivedere"],
  approvato: ["trimestre", "piu_avanti"],
  in_realizzazione: ["dossier", "senza_dossier"],
  realizzato: ["realizzato", "diffusa"],
  chiuso: ["non_avviato", "doppione", "archiviato"],
} as const satisfies Record<Phase, readonly string[]>;

export type SubStateOf<P extends Phase> = (typeof SUB_STATES)[P][number];
export type SubState = { [P in Phase]: SubStateOf<P> }[Phase];

/** Tono della pillola: puntino più parola, mai solo colore. */
export type PhaseTone = "grigio" | "giallo" | "blu" | "verde";

// ─── Colonne di oggi che la fase legge ───────────────────────────────

/** `use_cases.status`: ciclo di vita. */
export type LifecycleStatus = "draft" | "proposed" | "accepted" | "in_progress" | "implemented" | "rejected";

/** `use_cases.portfolio_review_status`: revisione. */
export type ReviewStatus = "needs_inputs" | "in_review" | "scored" | "archived";

// ─── Origine e tipo (§3.2, §3.3) ─────────────────────────────────────

/** `use_cases.origin` (0020): «AI Adoption · dal basso» o «AI Transformation · dall'alto». */
export const ORIGINS = ["adoption", "transformation"] as const;
export type Origin = (typeof ORIGINS)[number];

/** Tipo nell'area: `use_case_ai` o `NULL` è «Da costruire», `best_practice` è «Da diffondere». */
export const KINDS = ["da_costruire", "da_diffondere"] as const;
export type UseCaseKind = (typeof KINDS)[number];

/** Valori di `use_cases.portfolio_kind` scritti dall'area. */
export type PortfolioKind = "use_case_ai" | "best_practice";

// ─── «Quando» e data di revisione (§3.6) ─────────────────────────────

/** Le tre scelte di «Quando». «Più avanti» salva `target_quarter = NULL`. */
export const WHEN_CHOICES = ["questo_trimestre", "prossimo_trimestre", "piu_avanti"] as const;
export type WhenChoice = (typeof WHEN_CHOICES)[number];

/** Trimestre come si salva in `target_quarter` (CHECK `^[0-9]{4}-Q[1-4]$`), es. `2027-Q1`. */
export type QuarterCode = `${number}-Q${1 | 2 | 3 | 4}`;

/** Una scelta di «Quando» oppure un trimestre esplicito (il MCP del team accetta anche `2027-Q3`). */
export type WhenInput = WhenChoice | QuarterCode;

/** Data di calendario `AAAA-MM-GG` (fuso Europe/Rome), es. `review_by`. */
export type IsoDate = `${number}-${number}-${number}`;

// ─── Decisioni (§3.7) ────────────────────────────────────────────────

/** Motivi di «Archivia», salvati in `intake.archiveReason` (con `duplicato` per «Doppione di…»). */
export const ARCHIVE_REASONS = ["superato", "ritirato", "fuori_perimetro", "altro"] as const;
export type ArchiveReason = (typeof ARCHIVE_REASONS)[number];

/**
 * Una decisione di §3.7. «Quando» ha la sua funzione (`setWhen`), «Avvia la
 * realizzazione» crea il dossier (`recordRealizationStarted`): nessuna delle due è qui.
 * Non esiste «Cancella».
 */
export type Decision =
  | {
      type: "approva";
      quando: WhenInput;
      /** Casella «Mostralo ai colleghi» per una scheda nascosta alla ricerca. */
      showToColleagues?: boolean;
      /** Facoltativa (D17): assente non cambia, vuota la toglie. Si salva con la decisione. */
      publicNote?: string | null;
    }
  | { type: "rimanda"; reviewBy: IsoDate; publicNote?: string | null }
  | { type: "serve_info"; publicNote: string }
  | {
      type: "non_avviare";
      publicNote: string | null;
      /** PATCH REST `status = rejected`: nota non obbligatoria, per non rompere i client (§9.3). */
      legacy?: boolean;
    }
  | { type: "doppione"; ofCode: string; publicNote?: string | null }
  | { type: "archivia"; reason: ArchiveReason; publicNote?: string | null }
  | { type: "riapri" }
  | { type: "segna_diffusa" }
  | { type: "segna_realizzato" }
  /** Solo Lateral Space, con la sezione Casi d'uso spenta per il workspace. */
  | { type: "segna_in_realizzazione" };

export type DecisionType = Decision["type"];

// ─── Canali e origini dei dati (§8, §9.1, §10.3) ─────────────────────

/** Da dove arriva una scrittura del servizio. */
export const CHANNELS = [
  "pagina",
  "mcp_team",
  "connettore",
  "rest",
  "slack",
  "web",
  "corsi",
  "ai_readiness",
  "activity_mapping",
  "script",
  "ai",
] as const;
export type Channel = (typeof CHANNELS)[number];

/** Canale di una riga di Storia: in più `altro`, per un `source` che il trigger non conosce. */
export type EventChannel = Channel | "altro";

/** Valori di `use_cases.source` (varchar: i nuovi non cambiano lo schema). */
export const USE_CASE_SOURCES = [
  "manual",
  "web_proposed",
  "claude_connector",
  "claude_mcp",
  "slack_proposed",
  "ai_readiness_assessment",
  "learning",
  "activity_mapping",
  "team_mcp",
] as const;
export type UseCaseSource = (typeof USE_CASE_SOURCES)[number];

// ─── Costo e input di creazione (§5, §8, §9.4) ───────────────────────

/** Fascia del costo di realizzazione (`cost_band`, 1-5). */
export type CostBand = 1 | 2 | 3 | 4 | 5;

/**
 * Costo del team: un importo una tantum oppure una fascia, mai entrambi (DESIGN §5.4,
 * CHECK della 0020). Le due varianti si escludono anche per tsc: un oggetto con tutti e
 * due i campi non compila. Si distinguono con `cost.eurOnce !== undefined`, non con `in`.
 */
export type CostInput = { eurOnce: number; band?: never } | { band: CostBand; eurOnce?: never } | null;

/**
 * Una scheda nuova, da qualunque canale. È il solo tipo dell'area con il proponente:
 * lo scrive solo l'INSERT di `service.ts` e non torna mai indietro nelle letture
 * (DESIGN §11, §12.5 test 1). `art15-4.source.test.ts` ammette il campo solo qui dentro.
 */
export interface NewUseCaseInput {
  /** Id deciso prima dell'INSERT (MCP del team: `reserved_ids`, riusati a ogni ripresa). */
  id?: string;
  source: UseCaseSource;
  kind: UseCaseKind;
  /** Assente: la predefinita del canale e di chi scrive (§8). */
  origin?: Origin;
  title: string;
  /** «Problema» (colonna `description`). */
  description: string | null;
  flowDescription?: string | null;
  humanInTheLoop?: string | null;
  guardrails?: string | null;
  /** «Impatto atteso» (colonna `business_case`). */
  businessCase?: string | null;
  dataRequirements?: string | null;
  sustainabilityImpact?: string | null;
  aiLab?: string | null;
  /** `intake.area`. */
  area?: string | null;
  /** «Urgenza» (colonna `timeline`, «Dettagli» di §6.2): il modulo completo, solo «Da costruire». */
  timeline?: string | null;
  /** Activity mapping nasce `draft`; ogni altro canale `proposed`. */
  status?: Extract<LifecycleStatus, "draft" | "proposed">;
  /** Assente: nascosta solo se l'origine è `transformation` (§8.6). */
  hiddenFromSearch?: boolean;
  /** Valutazione iniziale facoltativa (modulo completo, solo revisori). */
  valueEurYear?: number | null;
  cost?: CostInput;
  /** Chi propone: email, id utente, id Slack o etichetta. `NULL` per il pannello rapido. */
  proposedBy?: string | null;
}

// ─── Errori del servizio (§9.1) ──────────────────────────────────────

export const SERVICE_ERRORS = [
  "permesso_mancante",
  "non_trovato",
  "versione_superata",
  "transizione_non_ammessa",
  "dati_non_validi",
  "area_spenta",
  "riprova",
] as const;
export type ServiceError = (typeof SERVICE_ERRORS)[number];

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: ServiceError; message: string; fieldErrors?: Record<string, string> };
