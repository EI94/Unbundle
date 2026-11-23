/**
 * La dashboard AI Readiness come modello (rilascio 10, ondata 7b, docs/ui-10/PROPOSTA-10.md §3.9; audit «Fuori» §5.4,
 * §8.4): le quattro schede e i loro indirizzi, le ancore di prima, lo stato in italiano, la riga sotto il titolo e il
 * prossimo passo, che segue lo stato (un solo pulsante pieno):
 *
 * | Stato | Pulsante pieno | Chi lo vede pieno |
 * |---|---|---|
 * | Bozza | «Apri la raccolta» | chi gestisce la rilevazione |
 * | Aperta, senza link | «Crea il link per tutti» | chi gestisce la rilevazione |
 * | Aperta | «Copia il link per tutti» | chi gestisce la rilevazione |
 * | Sopra la soglia, senza sintesi o con 20 risposte in più | «Genera la sintesi» | chi valuta gli use case |
 * | Insight da rivedere | «Rivedi N insight» | chi gestisce la rilevazione |
 * | Chiusa | «Scarica il report» | chi valuta gli use case |
 *
 * Chi non può fare il passo vede le parole dello stato, senza pulsante (e «Tocca a …» quando il passo è di qualcuno).
 * I permessi sono quelli delle azioni di oggi: gestire (`canManageWorkspaceSettings`) per aprire, chiudere, i link e la
 * revisione degli insight; valutare (`canReviewWorkspacePortfolio`) per la sintesi e i file scaricabili.
 *
 * Le ancore di prima restano: `#respondents` apre «Raccolta», `#intelligence` «Insight». I parametri di prima
 * (`?assessment=`, `?new=1`, `?deleted=1`) valgono come prima.
 *
 * Modulo puro: import relativi `.ts`, nessun accesso a rete o database.
 */
import type { SemaforoColor } from "../uc/vocab.ts";
import { READINESS_TEXT, formatScore } from "./dashboard-text.ts";

const T = READINESS_TEXT;

// ── Schede e indirizzi ────────────────────────────────────────────────

export const READINESS_TABS = Object.freeze(["risultati", "raccolta", "insight", "impostazioni"] as const);
export type ReadinessTab = (typeof READINESS_TABS)[number];

/** Il parametro della scheda (come nelle Impostazioni del workspace). */
export const READINESS_TAB_PARAM = "scheda";
/** Il pannello «Invita una persona» (`?apri=invita`). */
export const INVITE_PANEL = "invita";

/** Le ancore delle sezioni nelle schede: un link a `#<ancora>` porta alla sua scheda. */
export const READINESS_ANCHORS = Object.freeze({
  link: "link-per-tutti",
  people: "persone",
  proposals: "use-case-proposti",
  insights: "da-rivedere",
  roadmap: "tappe",
  threshold: "soglia",
  privacy: "privacy",
  exports: "file-scaricati",
  byArea: "per-area",
  byTeam: "per-team",
});

/** Le ancore di prima (`#respondents`, `#intelligence`) e quelle nuove, con la scheda che le contiene. */
export const READINESS_ANCHOR_TAB: Readonly<Record<string, ReadinessTab>> = Object.freeze({
  respondents: "raccolta",
  intelligence: "insight",
  [READINESS_ANCHORS.link]: "raccolta",
  [READINESS_ANCHORS.people]: "raccolta",
  [READINESS_ANCHORS.proposals]: "raccolta",
  [READINESS_ANCHORS.insights]: "insight",
  [READINESS_ANCHORS.roadmap]: "insight",
  [READINESS_ANCHORS.threshold]: "impostazioni",
  [READINESS_ANCHORS.privacy]: "impostazioni",
  [READINESS_ANCHORS.exports]: "impostazioni",
  [READINESS_ANCHORS.byArea]: "risultati",
  [READINESS_ANCHORS.byTeam]: "risultati",
});

/** Le schede di chi guarda: «Raccolta» a chi gestisce, o se ci sono use case proposti; «Insight» a chi valuta, o se ci sono. */
export function visibleReadinessTabs(a: { manages: boolean; reviews: boolean; proposals: number; insights: number }): ReadinessTab[] {
  return READINESS_TABS.filter((tab) => {
    if (tab === "raccolta") return a.manages || a.proposals > 0;
    if (tab === "insight") return a.reviews || a.insights > 0;
    return true;
  });
}

/** La scheda aperta: quella dell'indirizzo, se chi guarda la vede; altrimenti «Risultati». */
export function readinessTabOf(raw: string | null | undefined, visible: readonly ReadinessTab[] = READINESS_TABS): ReadinessTab {
  const asked = (READINESS_TABS as readonly string[]).includes(raw ?? "") ? (raw as ReadinessTab) : null;
  return asked && visible.includes(asked) ? asked : "risultati";
}

/**
 * L'indirizzo della dashboard: la rilevazione (`?assessment=`), la scheda (`?scheda=`, «Risultati» senza parametro),
 * il pannello (`?apri=`) e l'ancora.
 */
export function readinessHref(
  workspaceId: string,
  o: { assessmentId?: string | null; tab?: ReadinessTab; panel?: string | null; anchor?: string | null } = {},
): string {
  const params = new URLSearchParams();
  if (o.assessmentId) params.set("assessment", o.assessmentId);
  if (o.tab && o.tab !== "risultati") params.set(READINESS_TAB_PARAM, o.tab);
  if (o.panel) params.set("apri", o.panel);
  const query = params.toString();
  return `/dashboard/${workspaceId}/ai-readiness${query ? `?${query}` : ""}${o.anchor ? `#${o.anchor}` : ""}`;
}

/** La pagina «Domande» di una rilevazione (con `?per=referenti` per le schede dei referenti). */
export function questionsHref(workspaceId: string, assessmentId: string, audience: QuestionAudience = "tutti"): string {
  const base = `/dashboard/${workspaceId}/ai-readiness/questions/${assessmentId}`;
  return audience === "referenti" ? `${base}?per=referenti` : base;
}

export type QuestionAudience = "tutti" | "referenti";
export function questionAudienceOf(raw: string | null | undefined): QuestionAudience {
  return raw === "referenti" ? "referenti" : "tutti";
}

/** I file scaricabili (le rotte di oggi, con i loro parametri). */
export const exportHref = (assessmentId: string, type: "pdf" | "excel") => `/api/ai-readiness/assessments/${assessmentId}/export?type=${type}`;

function decodeHash(hash: string): string {
  const raw = hash.startsWith("#") ? hash.slice(1) : hash;
  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

/**
 * Dove porta un'ancora all'arrivo: la scheda che la contiene, se non è già quella aperta e chi guarda la vede; null
 * altrimenti. `#respondents` diventa `#persone` e `#intelligence` `#da-rivedere`, le loro sezioni di adesso.
 */
export function readinessAnchorTarget(i: { hash: string; current: ReadinessTab; visible: readonly ReadinessTab[]; workspaceId: string; assessmentId: string | null }): string | null {
  const anchor = decodeHash(i.hash);
  if (!anchor || !Object.hasOwn(READINESS_ANCHOR_TAB, anchor)) return null;
  const tab = READINESS_ANCHOR_TAB[anchor];
  if (tab === i.current || !i.visible.includes(tab)) return null;
  const renamed = anchor === "respondents" ? READINESS_ANCHORS.people : anchor === "intelligence" ? READINESS_ANCHORS.insights : anchor;
  return readinessHref(i.workspaceId, { assessmentId: i.assessmentId, tab, anchor: renamed });
}

// ── Stato e riga sotto il titolo ──────────────────────────────────────

export type ReadinessStatus = "draft" | "open" | "closed" | "archived";

/** Lo stato in italiano, con il suo puntino: mai la chiave salvata («draft», «open»). */
export function readinessStatusView(status: string): { label: string; tone: SemaforoColor } {
  if (status === "open") return { label: T.status.open, tone: "blu" };
  if (status === "closed") return { label: T.status.closed, tone: "grigio" };
  if (status === "archived") return { label: T.status.archived, tone: "grigio" };
  return { label: T.status.draft, tone: "grigio" };
}

/** «46 risposte su 120 attese · bastano 5 per i risultati»; lo zero non si vede: «Ancora nessuna risposta · …». */
export function readinessSummary(i: { completed: number; expected: number | null; threshold: number }): string {
  const count =
    i.completed <= 0 ? T.summary.none : i.expected && i.expected > 0 ? T.summary.ofExpected(i.completed, i.expected) : T.summary.answers(i.completed);
  return `${count} · ${T.summary.threshold(Math.max(1, i.threshold))}`;
}

/** Le risposte attese salvate in `scoringConfig.expectedRespondents`, se sono un intero positivo. */
export function expectedRespondentsOf(scoringConfig: unknown): number | null {
  const value = scoringConfig && typeof scoringConfig === "object" ? (scoringConfig as Record<string, unknown>).expectedRespondents : null;
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null;
}

// ── Il prossimo passo ─────────────────────────────────────────────────

export type ReadinessStage = "bozza" | "senza_link" | "aperta" | "sopra_soglia" | "da_rivedere" | "chiusa";

/**
 * (Revisione 7b) Dopo una sintesi, quante risposte nuove la rendono di nuovo il prossimo passo: venti. Con meno, mentre
 * la raccolta va avanti, il passo resta copiare il link (o rivedere gli insight): rigenerare a ogni risposta aggiungeva
 * bozze uguali e toglieva di vista il link. Si può sempre rigenerare prima dalla scheda Insight.
 */
export const SYNTHESIS_STEP = 20;

/** L'ultima sintesi: le risposte che c'erano quando è nata (`inputScope.responseCount`), null se non si sa. */
export interface SynthesisFacts {
  responses: number | null;
}

/** L'ultima sintesi tra gli insight (quello generato per ultimo), o null senza insight. */
export function synthesisOf(insights: ReadonlyArray<{ generatedAt: Date; inputScope?: unknown }>): SynthesisFacts | null {
  let latest: { generatedAt: Date; inputScope?: unknown } | null = null;
  for (const insight of insights) {
    if (insight.generatedAt instanceof Date && !Number.isNaN(insight.generatedAt.getTime()) && (latest === null || insight.generatedAt.getTime() > latest.generatedAt.getTime())) latest = insight;
  }
  if (!latest) return null;
  const scope = latest.inputScope && typeof latest.inputScope === "object" ? (latest.inputScope as Record<string, unknown>) : {};
  const responses = scope.responseCount;
  return { responses: typeof responses === "number" && Number.isInteger(responses) && responses >= 0 ? responses : null };
}

export interface ReadinessStageInput {
  status: string;
  hasOpenLink: boolean;
  /** Le persone che hanno risposto (questionario inviato o raccolta di use case finita). */
  completed: number;
  /** La soglia per i risultati (`aggregationThreshold`). */
  threshold: number;
  /** Gli insight ancora in bozza. */
  draftInsights: number;
  /** L'ultima sintesi (`synthesisOf`), o null se non c'è. */
  synthesis: SynthesisFacts | null;
}

/**
 * Lo stato che decide il passo. Con la raccolta aperta: la sintesi, quando le risposte bastano e la sintesi non c'è,
 * è nata sotto la soglia o ha alle spalle `SYNTHESIS_STEP` risposte nuove (una sintesi di cui non si sa il numero non
 * torna dovuta); poi gli insight da rivedere; poi il link per tutti, da creare o da copiare. Chiusa o archiviata: gli
 * insight da rivedere, poi il report.
 */
export function readinessStage(i: ReadinessStageInput): ReadinessStage {
  if (i.status === "draft") return "bozza";
  if (i.status !== "open") return i.draftInsights > 0 ? "da_rivedere" : "chiusa";
  const threshold = Math.max(1, i.threshold);
  const enough = i.completed > 0 && i.completed >= threshold;
  const last = i.synthesis;
  const due = last === null || (last.responses !== null && (last.responses < threshold || i.completed - last.responses >= SYNTHESIS_STEP));
  if (enough && due) return "sopra_soglia";
  if (i.draftInsights > 0) return "da_rivedere";
  return i.hasOpenLink ? "aperta" : "senza_link";
}

export type ReadinessStepKind = "open" | "create_link" | "copy_link" | "synthesis" | "review" | "report";

export interface ReadinessStep {
  kind: ReadinessStepKind;
  /** Il verbo del pulsante, o le parole dello stato quando il passo non è di chi guarda. */
  label: string;
  why: string;
  /** Tocca a chi guarda: il pulsante pieno. */
  mine: boolean;
  /** «Tocca a …», solo quando il passo è di qualcun altro. */
  turn: string | null;
}

/** Il passo di uno stato per chi guarda (vedi la tabella in testa al modulo). */
export function readinessNextStep(stage: ReadinessStage, a: { manages: boolean; reviews: boolean; draftInsights: number }): ReadinessStep {
  const S = T.step;
  switch (stage) {
    case "bozza":
      return a.manages
        ? { kind: "open", label: S.open, why: S.openWhy, mine: true, turn: null }
        : { kind: "open", label: S.statusDraft, why: S.openWhy, mine: false, turn: S.turnManager };
    case "senza_link":
      return a.manages
        ? { kind: "create_link", label: S.createLink, why: S.createLinkWhy, mine: true, turn: null }
        : { kind: "create_link", label: S.statusOpen, why: S.createLinkWhy, mine: false, turn: S.turnManager };
    case "aperta":
      return a.manages
        ? { kind: "copy_link", label: S.copyLink, why: S.copyLinkWhy, mine: true, turn: null }
        : { kind: "copy_link", label: S.statusOpen, why: S.copyLinkWhy, mine: false, turn: null };
    case "sopra_soglia":
      return a.reviews
        ? { kind: "synthesis", label: S.synthesis, why: S.synthesisWhy, mine: true, turn: null }
        : { kind: "synthesis", label: S.statusSynthesis, why: S.synthesisWhy, mine: false, turn: S.turnReviewer };
    case "da_rivedere":
      return a.manages
        ? { kind: "review", label: S.review(a.draftInsights), why: S.reviewWhy, mine: true, turn: null }
        : { kind: "review", label: S.statusReview, why: S.reviewWhy, mine: false, turn: S.turnManager };
    case "chiusa":
      return a.reviews
        ? { kind: "report", label: S.report, why: S.reportWhy, mine: true, turn: null }
        : { kind: "report", label: S.statusClosed, why: S.reportWhy, mine: false, turn: null };
  }
}

// ── Etichette ─────────────────────────────────────────────────────────

/** I livelli di maturità in italiano (le etichette inglesi di `MATURITY_LEVELS` restano per il report). */
const MATURITY_TEXT = ["Da avviare", "Frammentata", "Sperimentale", "Strutturata", "Scalabile", "AI integrata"] as const;

export function maturityLabel(score: number | null | undefined): string | null {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  return MATURITY_TEXT[Math.max(0, Math.min(5, Math.round(score)))];
}

/** Il numero grande dei Risultati: l'indice di prontezza su 5, con la maturità e l'area più debole. */
export function readinessIndexView(score: number | null | undefined, weakest: string | null): { value: string; note: string } | null {
  const value = formatScore(score);
  if (value === null) return null;
  return { value: T.results.indexValue(value), note: T.results.indexNote(maturityLabel(score), weakest) };
}

const INSIGHT_TYPE_TEXT: Readonly<Record<string, string>> = Object.freeze({
  executive_summary: "Sintesi",
  bottleneck: "Area più debole",
  risk: "Attenzione",
  opportunity: "Opportunità",
  roadmap: "Tappe",
  adoption: "Adozione",
  use_case: "Gruppi di use case",
  benchmark: "Confronto",
});

/** Il tipo di un insight in parole; un tipo che non si conosce non ha etichetta. */
export function insightTypeLabel(type: string): string | null {
  return Object.hasOwn(INSIGHT_TYPE_TEXT, type) ? INSIGHT_TYPE_TEXT[type] : null;
}

/** Lo stato di un insight: puntino più parola. */
export function insightStatusView(status: string): { label: string; tone: SemaforoColor } {
  if (status === "approved") return { label: "Approvato", tone: "verde" };
  if (status === "reviewed") return { label: "Visto", tone: "blu" };
  if (status === "rejected") return { label: "Scartato", tone: "grigio" };
  return { label: "Da rivedere", tone: "giallo" };
}

const INVITE_STATUS: Readonly<Record<string, { label: string; tone: SemaforoColor }>> = Object.freeze({
  invited: { label: "Link creato", tone: "grigio" },
  opened: { label: "Link aperto", tone: "blu" },
  started: { label: "In corso", tone: "blu" },
  completed: { label: "Ha risposto", tone: "verde" },
  privacy_deleted: { label: "Dati cancellati", tone: "grigio" },
  revoked: { label: "Link revocato", tone: "grigio" },
  expired: { label: "Link scaduto", tone: "grigio" },
});

/** Lo stato dell'invito di una persona: mai la chiave salvata («invited», «opened»…). */
export function inviteStatusView(status: string): { label: string; tone: SemaforoColor } {
  return Object.hasOwn(INVITE_STATUS, status) ? INVITE_STATUS[status] : INVITE_STATUS.invited;
}

/** I tre percorsi di oggi, con i nomi della dashboard. */
export const READINESS_TRACKS = Object.freeze({
  internal: Object.freeze({ label: "Scheda per i referenti", hint: "Sistemi, dati, persone e processi: per IT, HR e chi conosce l'organizzazione." }),
  use_case_expert: Object.freeze({ label: "Raccolta di use case", hint: "Idee concrete: il bisogno, il lavoro di oggi, che cosa potrebbe fare l'AI." }),
  everyone: Object.freeze({ label: "Questionario per tutti", hint: "Le stesse domande del link per tutti, con un link solo per questa persona." }),
});
export type ReadinessTrack = keyof typeof READINESS_TRACKS;

export function trackLabel(track: string | null | undefined): string {
  return track === "internal" || track === "use_case_expert" ? READINESS_TRACKS[track].label : READINESS_TRACKS.everyone.label;
}

/**
 * Una riga di «Persone»: il nome (o l'email; dal link per tutti, senza nome, «Dal link per tutti»), il percorso, l'area e
 * il ruolo quando c'è. Mai l'id pseudonimo.
 */
export function personRowView(p: {
  name: string | null;
  surname: string | null;
  email: string | null;
  organizationUnit: string | null;
  role?: string | null;
  surveyTrack: string | null;
  inviteStatus: string;
}): { title: string; fact: string; status: { label: string; tone: SemaforoColor } } {
  const fullName = [p.name, p.surname].map((part) => part?.trim()).filter(Boolean).join(" ");
  const title = fullName || p.email?.trim() || T.collection.personFromLink;
  const fact = [trackLabel(p.surveyTrack), p.organizationUnit?.trim() || T.collection.areaMissing, p.role?.trim() || null].filter(Boolean).join(" · ");
  return { title, fact, status: inviteStatusView(p.inviteStatus) };
}

/** Il fatto grigio di uno use case proposto: la priorità indicata e la frequenza, quando ci sono. */
export function proposalFact(p: { riskLevel: string | null; frequency: string | null }): string | null {
  const parts = [p.riskLevel?.trim() ? T.collection.priority(p.riskLevel.trim()) : null, p.frequency?.trim() || null].filter(Boolean);
  return parts.length ? parts.join(" · ") : null;
}

/** I punti di forza (le due sezioni più alte) e di attenzione (le due più basse, senza ripetere quelle di forza). */
export function strengthsAndAttention<S extends { title: string; score: number }>(sections: readonly S[]): { strengths: S[]; attention: S[] } {
  const sorted = [...sections].filter((s) => Number.isFinite(s.score)).sort((a, b) => b.score - a.score);
  const strengths = sorted.slice(0, 2);
  const attention = sorted
    .slice(2)
    .reverse()
    .slice(0, 2);
  return { strengths, attention };
}
