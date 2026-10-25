/**
 * Vocabolario dell'area «Use case» (docs/use-case/DESIGN.md §3.2, §3.3, §4.7, §6.2,
 * §7.1-7.4, §10.3, §14.1, §14.3).
 *
 * Codici e testi esatti, in un posto solo: le regole (`valuation.ts`, `decisions.ts`) usano
 * i codici, le pagine e `format.ts` i testi. Nessun testo qui nomina «caso d'uso», «wave»,
 * i quadranti inglesi o le parole vietate di §14.5.
 *
 * Modulo puro: solo import di tipi relativi `.ts`.
 */
import type { ArchiveReason, Origin, PortfolioKind, UseCaseKind } from "./types.ts";

// ─── Origine (§3.2) ──────────────────────────────────────────────────

/** Etichetta lunga, chip e colore del punto in matrice. Il chip ha sempre il testo. */
export const ORIGIN_LABEL: Readonly<Record<Origin, { long: string; chip: string; color: "teal" | "indigo" }>> = {
  adoption: { long: "AI Adoption · dal basso", chip: "AI Adoption", color: "teal" },
  transformation: { long: "AI Transformation · dall'alto", chip: "AI Transformation", color: "indigo" },
};

// ─── Tipo (§3.3) ─────────────────────────────────────────────────────

export const KIND_LABEL: Readonly<Record<UseCaseKind, { label: string; icon: "Hammer" | "Megaphone" }>> = {
  da_costruire: { label: "Da costruire", icon: "Hammer" },
  da_diffondere: { label: "Da diffondere", icon: "Megaphone" },
};

/** `best_practice` è «Da diffondere»; `use_case_ai`, `NULL` e ogni altro valore «Da costruire». */
export function kindOf(portfolioKind: string | null | undefined): UseCaseKind {
  return portfolioKind === "best_practice" ? "da_diffondere" : "da_costruire";
}

/** Il valore di `portfolio_kind` che l'area scrive per un tipo. */
export function portfolioKindOf(kind: UseCaseKind): PortfolioKind {
  return kind === "da_diffondere" ? "best_practice" : "use_case_ai";
}

// ─── Valore, costo, zone, rischio (§7.1-7.4) ─────────────────────────

/** Testo di ogni cifra che manca (Valore, Costo, zona). */
export const NOT_ESTIMATED_LABEL = "da stimare";

/** Il Valore in parola (§7.1). Senza punteggio: `NOT_ESTIMATED_LABEL`. */
export const VALUE_WORDS = ["alto", "medio", "basso"] as const;
export type ValueWord = (typeof VALUE_WORDS)[number];
export const VALUE_WORD_LABEL: Readonly<Record<ValueWord, string>> = {
  alto: "Alto",
  medio: "Medio",
  basso: "Basso",
};

/**
 * Il Valore di «Benefici e costi» senza un beneficio contato: voci solo da misurare
 * («da misurare · fino a 5.840 €») oppure solo a parole («qualitativo»).
 */
export const VALUE_MODEL_STATE_LABEL = Object.freeze({ da_misurare: "da misurare", qualitativo: "qualitativo" });
/** «fino a 5.840 €»: il tetto delle voci da misurare, fuori dal totale. */
export const UP_TO_WORD = "fino a";
/** «4.043 €/anno»: il beneficio all'anno nella forma corta. */
export const PER_YEAR_SHORT_SUFFIX = "/anno";
/** «avvio 560 € · ricorrenti 600 €/anno»: il costo di «Benefici e costi». */
export const COST_ONEOFF_WORD = "avvio";
export const COST_RUN_WORD = "ricorrenti";

/** Da dove viene il punteggio del Valore (§7.1). Senza punteggio: «da stimare». */
export const VALUE_SOURCES = ["team", "ai"] as const;
export type ValueSource = (typeof VALUE_SOURCES)[number];
export const VALUE_SOURCE_LABEL: Readonly<Record<ValueSource, string>> = {
  team: "team",
  ai: "AI",
};

/** Da dove vengono gli euro all'anno accanto al Valore (§7.1): dossier, poi team. */
export const VALUE_EUR_SOURCES = ["dossier", "team"] as const;
export type ValueEurSource = (typeof VALUE_EUR_SOURCES)[number];
export const VALUE_EUR_SOURCE_LABEL: Readonly<Record<ValueEurSource, { short: string; long: string }>> = {
  dossier: { short: "dossier", long: "dal dossier" },
  team: { short: "team", long: "team" },
};

/**
 * Le fonti del costo di realizzazione, nell'ordine in cui vincono (§7.2): il dossier, la stima
 * di «Benefici e costi» (avvio e ricorrenti), l'importo e la fascia del team, l'impegno.
 * Forma corta nella riga e nella card della Roadmap, lunga nella scheda.
 * Per il dossier: «dossier» e «dal dossier», mai «da dossier». Il costo che viene dal punteggio
 * di impegno (KPI `effort`) si dice in parole semplici, «stimato» e «stimato dall'impegno», non
 * «da sforzo» (H4p).
 */
export const COST_SOURCES = ["dossier", "stima", "team_importo", "team_fascia", "sforzo"] as const;
export type CostSource = (typeof COST_SOURCES)[number];
export const COST_SOURCE_LABEL: Readonly<Record<CostSource, { short: string; long: string }>> = {
  dossier: { short: "dossier", long: "dal dossier" },
  // «Benefici e costi» della scheda (`value_model.costs`): avvio e ricorrenti, stimati dal team.
  stima: { short: "team", long: "stima del team" },
  team_importo: { short: "team", long: "importo del team" },
  team_fascia: { short: "team", long: "fascia del team" },
  sforzo: { short: "stimato", long: "stimato dall'impegno" },
};

/** Testo «fascia» al posto dell'importo, quando il costo è una fascia (team o sforzo). */
export const COST_BAND_WORD = "fascia";

/** Le zone della matrice Valore × Costo (§7.4), nell'ordine della lista di «Priorità». */
export const ZONES = ["subito", "da_pianificare", "se_avanza_tempo", "non_ora"] as const;
export type Zone = (typeof ZONES)[number];
export const ZONE_LABEL: Readonly<Record<Zone, string>> = {
  subito: "Subito",
  da_pianificare: "Da pianificare",
  se_avanza_tempo: "Se avanza tempo",
  non_ora: "Non ora",
};

/** Nota sotto la matrice e accanto alla zona. */
export const ZONE_HINT = "Le zone sono un suggerimento, non la decisione.";

/** Chip di rischio (§7.3): solo un segnale, non cambia Valore, Costo o zona. */
export const RISK_CHIPS = ["ai_board", "dati_personali", "sicurezza"] as const;
export type RiskChip = (typeof RISK_CHIPS)[number];
export const RISK_LABEL: Readonly<Record<RiskChip, string>> = {
  ai_board: "Serve decisione AI Board",
  dati_personali: "Dati personali",
  sicurezza: "Sicurezza",
};

// ─── Decisioni (§3.7, §14.3) ─────────────────────────────────────────

/** Motivi di «Archivia», come nel dialogo. */
export const ARCHIVE_REASON_LABEL: Readonly<Record<ArchiveReason, string>> = {
  superato: "Superato da altro",
  ritirato: "Ritirato da chi l'ha proposto",
  fuori_perimetro: "Fuori dal perimetro",
  altro: "Altro motivo",
};

/** Motivo che «Doppione di…» scrive in `intake.archiveReason` (non è un motivo di «Archivia»). */
export const DUPLICATE_ARCHIVE_REASON = "duplicato";

// ─── Canale (§4.7) ───────────────────────────────────────────────────

const CHANNEL_BY_SOURCE: Readonly<Record<string, string>> = {
  claude_connector: "Claude (connettore)",
  claude_mcp: "Claude (MCP v1)",
  slack_proposed: "Slack",
  web_proposed: "Modulo web",
  ai_readiness_assessment: "AI Readiness",
  learning: "Corsi",
  activity_mapping: "Activity mapping",
  manual: "A mano",
  team_mcp: "MCP del team",
};

/** «Canale» da `use_cases.source`. `NULL` sono le righe vecchie di Activity mapping. */
export function channelLabel(source: string | null | undefined): string {
  if (source === null || source === undefined) return CHANNEL_BY_SOURCE.activity_mapping;
  return Object.prototype.hasOwnProperty.call(CHANNEL_BY_SOURCE, source) ? CHANNEL_BY_SOURCE[source] : "Altro";
}

// ─── Campi (§6.2) e campi della Storia (§10.3) ───────────────────────

/** I campi di «Cosa è» che si modificano sul posto. */
export const WHAT_FIELDS = [
  "title",
  "description",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "businessCase",
  "dataRequirements",
  "area",
  "aiLab",
  "sustainabilityImpact",
] as const;
export type WhatField = (typeof WHAT_FIELDS)[number];

/**
 * Etichetta di ogni campo per tipo (§6.2). `null`: il campo non c'è per quel tipo.
 * «Impatto ambientale e sociale» si mostra solo con ESG attivo.
 */
export const WHAT_FIELD_LABEL: Readonly<Record<WhatField, Readonly<Record<UseCaseKind, string | null>>>> = {
  title: { da_costruire: "Titolo", da_diffondere: "Titolo" },
  description: { da_costruire: "Problema", da_diffondere: "Prima" },
  flowDescription: { da_costruire: "Come funziona", da_diffondere: "Adesso" },
  humanInTheLoop: { da_costruire: "Chi controlla", da_diffondere: "Chi la usa" },
  guardrails: { da_costruire: "Limiti", da_diffondere: null },
  businessCase: { da_costruire: "Impatto atteso", da_diffondere: "Risultato" },
  dataRequirements: { da_costruire: "Dati", da_diffondere: "Cosa serve per copiarla" },
  area: { da_costruire: "Area", da_diffondere: "Area" },
  aiLab: { da_costruire: "AI Lab", da_diffondere: "AI Lab" },
  sustainabilityImpact: {
    da_costruire: "Impatto ambientale e sociale",
    da_diffondere: "Impatto ambientale e sociale",
  },
};

/**
 * I nomi dei campi che una riga della Storia può registrare: lo stesso elenco del CHECK
 * `use_case_events_fields_check` della 0020. Mai valori, solo nomi.
 */
export const EVENT_FIELDS = [
  "titolo",
  "problema",
  "come_funziona",
  "chi_controlla",
  "limiti",
  "impatto_atteso",
  "dati",
  "area",
  "ai_lab",
  "origine",
  "tipo",
  "nota_pubblica",
  "valore",
  "costo",
  "kpi",
  "quando",
  "revisione",
  "visibilita",
  "possibile_doppione",
  "intake",
] as const;
export type EventField = (typeof EVENT_FIELDS)[number];
