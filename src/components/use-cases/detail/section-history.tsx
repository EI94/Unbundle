import Link from "next/link";
import { ChevronRight } from "lucide-react";
import type { UseCaseEventList, UseCaseEventRow } from "@/lib/db/queries/use-case-events";
import { ANSWER_TEXT } from "@/lib/use-cases/answers";
import { formatDate, formatDayInYear } from "@/lib/use-cases/format";
import { WHAT_FIELD_LABEL, type WhatField } from "@/lib/use-cases/labels";
import { NEED_HISTORY_TEXT, isNeedHistoryEvent, needHistoryText } from "@/lib/use-cases/needs-history";
import { PHASE_LABEL } from "@/lib/use-cases/phase";
import { REFERENT_HISTORY_PREFIX, historyActorText, isReferentHistoryEvent, referentHistoryText } from "@/lib/use-cases/referent/history";
import type { Phase, UseCaseKind } from "@/lib/use-cases/types";
import { cn } from "@/lib/utils";

/** I testi del capitolo (§6.6, §14.3). */
export const HISTORY_TEXT = Object.freeze({
  title: "Storia",
  created: "Creato",
  decision: "Decisione:",
  edited: "Modificato",
  valued: "Valutazione modificata",
  aiSuggestion: "Suggerimento AI",
  when: "Quando modificato",
  visibility: "Visibilità modificata",
  redacted: "Testo oscurato",
  realizationStarted: "Realizzazione avviata",
  showAll: "Mostra tutto",
  startsOn: "La storia parte dal",
  empty: "Ancora nessuna riga.",
});

/** Il campo della Storia che è un campo di «Cosa è»: l'etichetta segue il tipo della scheda. */
const WHAT_EVENT_FIELD: Readonly<Record<string, WhatField>> = {
  titolo: "title",
  problema: "description",
  come_funziona: "flowDescription",
  chi_controlla: "humanInTheLoop",
  limiti: "guardrails",
  impatto_atteso: "businessCase",
  dati: "dataRequirements",
  area: "area",
  ai_lab: "aiLab",
};

/** Gli altri campi della Storia (l'elenco chiuso del CHECK della 0020, §10.3, e `cosa_serve` della 0023). */
const OTHER_EVENT_FIELD: Readonly<Record<string, string>> = {
  origine: "Origine",
  tipo: "Tipo",
  nota_pubblica: "Nota pubblica",
  valore: "Valore all'anno",
  costo: "Costo",
  kpi: "Punteggi",
  quando: "Quando",
  revisione: "Data di revisione",
  visibilita: "Visibilità",
  possibile_doppione: "Possibile doppione di",
  intake: "Dati raccolti da Claude",
  cosa_serve: NEED_HISTORY_TEXT.label,
  // «Chiedi al referente» (drizzle/0024): righe senza testi e senza il nome del referente.
  richiesta_referente: REFERENT_HISTORY_PREFIX,
};

/** Il canale di una riga, dopo l'azione: «pagina», «MCP del team». */
const CHANNEL_TEXT: Readonly<Record<string, string>> = {
  pagina: "pagina",
  mcp_team: "MCP del team",
  connettore: "Claude (connettore)",
  rest: "API",
  slack: "Slack",
  web: "modulo web",
  corsi: "corsi",
  ai_readiness: "AI Readiness",
  activity_mapping: "Activity mapping",
  script: "script",
  ai: "AI",
  altro: "altro canale",
};

/** Il canale della creazione: «Creato · da Slack». La creazione non mostra mai una persona. */
const CREATED_FROM: Readonly<Record<string, string>> = {
  pagina: "dalla pagina",
  mcp_team: "dal MCP del team",
  connettore: "da Claude (connettore)",
  rest: "da Claude (MCP v1)",
  slack: "da Slack",
  web: "dal modulo web",
  corsi: "dai corsi",
  ai_readiness: "da AI Readiness",
  activity_mapping: "da Activity mapping",
  script: "da uno script",
  ai: "dall'AI",
  altro: "da un altro canale",
};

/** I nomi dei campi di una riga, mai i valori: «Problema, Titolo». */
export function eventFieldsText(fields: readonly string[], kind: UseCaseKind): string {
  const names = fields.map((field) => {
    const what = WHAT_EVENT_FIELD[field];
    if (what) return WHAT_FIELD_LABEL[what][kind] ?? WHAT_FIELD_LABEL[what].da_costruire ?? field;
    return OTHER_EVENT_FIELD[field] ?? field;
  });
  return [...new Set(names)].join(", ");
}

function phaseOfCode(code: string | null): { phase: string; subState: string } | null {
  if (!code) return null;
  const [phase, subState = ""] = code.split(".");
  return phase ? { phase, subState } : null;
}

/**
 * La decisione di una riga, dai codici di fase prima e dopo (la Storia non salva testi né il
 * trimestre): «Approvato», «Rimandato», «Serve info», «Non avviato», «Doppione», «Archiviato»,
 * «Riaperto», «Realizzato», «Diffusa», «In realizzazione».
 */
export function decisionText(phaseBefore: string | null, phaseAfter: string | null): string {
  const before = phaseOfCode(phaseBefore);
  const after = phaseOfCode(phaseAfter);
  if (!after) return "";
  if (before?.phase === "chiuso" && after.phase !== "chiuso") return "Riaperto";
  switch (after.phase) {
    case "approvato":
      return after.subState === "piu_avanti" ? "Approvato (Più avanti)" : "Approvato";
    case "da_valutare":
      if (after.subState === "rimandata" || after.subState === "da_rivedere") return "Rimandato";
      if (after.subState === "serve_info") return "Serve info";
      return PHASE_LABEL.da_valutare;
    case "chiuso":
      if (after.subState === "non_avviato") return "Non avviato";
      if (after.subState === "doppione") return "Doppione";
      return "Archiviato";
    case "realizzato":
      return after.subState === "diffusa" ? "Diffusa" : "Realizzato";
    case "in_realizzazione":
      return PHASE_LABEL.in_realizzazione;
    default:
      return PHASE_LABEL[after.phase as Phase] ?? "";
  }
}

/**
 * L'azione di una riga, senza testi: «Decisione: Approvato», «Valutazione modificata: Valore all'anno,
 * Costo», «Cosa serve: aggiunto un requisito» (le esigenze, drizzle/0023; `needs-history.ts`).
 */
export function eventActionText(
  event: Pick<UseCaseEventRow, "action" | "fields" | "phaseBefore" | "phaseAfter"> & Partial<Pick<UseCaseEventRow, "actorKind">>,
  kind: UseCaseKind,
): string {
  const fields = eventFieldsText(event.fields, kind);
  const withFields = (text: string) => (fields ? `${text}: ${fields}` : text);
  switch (event.action) {
    case "creato":
      return HISTORY_TEXT.created;
    case "modificato":
      // «Chiedi al referente»: che cosa è successo alla richiesta, mai chi è il referente né le risposte.
      if (isReferentHistoryEvent(event)) return referentHistoryText(event);
      // «Cosa serve»: il cambio e il tipo dell'esigenza, con lo stato se cambia; mai i suoi testi.
      if (isNeedHistoryEvent(event)) return needHistoryText(event);
      // La risposta a «Serve info» (D17): di chi ha proposto, senza testo e senza persona.
      if (event.actorKind === "proponente") return ANSWER_TEXT.history;
      return withFields(HISTORY_TEXT.edited);
    case "valutato":
      return withFields(HISTORY_TEXT.valued);
    case "suggerimento_ai":
      return HISTORY_TEXT.aiSuggestion;
    case "decisione": {
      const decision = decisionText(event.phaseBefore, event.phaseAfter);
      return decision ? `${HISTORY_TEXT.decision} ${decision}` : HISTORY_TEXT.decision.replace(/:$/, "");
    }
    case "quando":
      return HISTORY_TEXT.when;
    case "visibilita":
      return HISTORY_TEXT.visibility;
    case "oscurato":
      return withFields(HISTORY_TEXT.redacted);
    case "realizzazione_avviata":
      return HISTORY_TEXT.realizationStarted;
    default:
      return event.action;
  }
}

/**
 * Le righe automatiche di «Cosa serve» e di «Chiedi al referente» (Parte 2): chi ha agito è
 * «Referente» (dalla pagina pubblica) o «Unbundle» (promemoria, scadenze, invio delle email), senza
 * canale. null per le altre righe.
 */
function automaticActor(event: Pick<UseCaseEventRow, "fields" | "actorKind" | "channel">): string | null {
  if (!event.fields.includes("cosa_serve") && !isReferentHistoryEvent(event)) return null;
  return historyActorText(event);
}

/**
 * Una riga della Storia in parti (§6.6): data, persona del team (solo per le persone, mai per la
 * creazione), azione con i nomi dei campi, canale. «14 ott · Nome Cognome · Decisione: Approvato ·
 * pagina», «12 ott · Creato · da Slack». Mai un testo della scheda, né prima né dopo. Le righe di
 * «Chiedi al referente» non hanno canale: non nominano mai il referente («27 ott · Unbundle ·
 * Chiedi al referente: promemoria automatico inviato»).
 */
export function historyRowParts(event: UseCaseEventRow, opts: { kind: UseCaseKind; today: string }): string[] {
  const parts: string[] = [];
  const day = formatDayInYear(event.at, opts.today);
  if (day) parts.push(day);
  const automatic = event.action === "creato" ? null : automaticActor(event);
  if (automatic) parts.push(automatic);
  else if (event.action !== "creato" && event.actorKind === "persona" && event.actorName) parts.push(event.actorName);
  parts.push(eventActionText(event, opts.kind));
  if (event.action === "creato") parts.push(CREATED_FROM[event.channel] ?? CREATED_FROM.altro);
  else if (!automatic && !isReferentHistoryEvent(event)) parts.push(CHANNEL_TEXT[event.channel] ?? CHANNEL_TEXT.altro);
  return parts;
}

/**
 * «La storia parte dal 20 ott 2026.»: la Storia non comincia con la creazione della scheda (la
 * scheda è più vecchia della Storia, nata con la 0020), quindi la prima riga dice da quando c'è.
 * null quando la Storia ha la riga «Creato», e finché ci sono righe più vecchie da mostrare.
 */
export function historyStartText(events: Pick<UseCaseEventList, "events" | "hasMore" | "startedAt">): string | null {
  if (!events.startedAt || events.hasMore) return null;
  if (events.events.some((event) => event.action === "creato")) return null;
  const label = formatDate(events.startedAt);
  return label ? `${HISTORY_TEXT.startsOn} ${label}.` : null;
}

export interface SectionHistoryProps {
  events: UseCaseEventList;
  kind: UseCaseKind;
  today: string;
  /** Il capitolo si apre già aperto (`?capitolo=storia`, «Mostra tutto»). */
  open?: boolean;
  /** Il link di «Mostra tutto», se ci sono righe più vecchie. */
  showAllHref?: string | null;
  id?: string;
  className?: string;
}

/**
 * Il capitolo «Storia» della scheda, solo per i revisori e chiuso (docs/use-case/DESIGN.md §6.6,
 * §10.3, §11): le ultime 50 righe di `use_case_events`, poi «Mostra tutto». Nessun testo, nessun
 * filtro, ordinamento o conteggio per persona; la creazione non dice chi ha proposto.
 */
export function SectionHistory({ events, kind, today, open = false, showAllHref, id = "storia", className }: SectionHistoryProps) {
  const start = historyStartText(events);
  return (
    <section id={id} aria-label={HISTORY_TEXT.title} data-slot="section-history" className={cn("scroll-mt-28", className)}>
      <details open={open} className="group">
        <summary className="flex min-h-11 cursor-pointer list-none items-center gap-1.5 text-base font-semibold select-none [&::-webkit-details-marker]:hidden">
          <ChevronRight aria-hidden className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" />
          <h2 className="inline">{HISTORY_TEXT.title}</h2>
        </summary>
        <div className="space-y-3 pt-2">
          {events.events.length ? (
            <ol className="space-y-1.5">
              {events.events.map((event) => (
                <li key={event.id} data-action={event.action} className="text-sm break-words">
                  {historyRowParts(event, { kind, today }).join(" · ")}
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-muted-foreground">{HISTORY_TEXT.empty}</p>
          )}
          {events.hasMore && showAllHref ? (
            <Link href={showAllHref} scroll={false} className="inline-flex min-h-11 items-center text-sm font-medium text-primary underline underline-offset-4 hover:decoration-2 sm:min-h-8">
              {HISTORY_TEXT.showAll}
            </Link>
          ) : null}
          {start ? <p className="text-sm text-muted-foreground">{start}</p> : null}
        </div>
      </details>
    </section>
  );
}
