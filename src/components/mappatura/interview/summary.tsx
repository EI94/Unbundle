"use client";

/**
 * «Intervista iniziale»: il riepilogo accanto alla chat (rilascio 10, docs/ui-10/PROPOSTA-10.md §3.7; prima la colonna
 * della Discovery, con «Value Thesis», «Nodi strategici», le unità e gli «Obiettivi Strategici»).
 *
 * Quello che l'intervista ha già raccolto, in italiano semplice: dove l'azienda crea valore (e dove fa la differenza),
 * le unità con le loro persone, gli obiettivi con il loro tipo (Obiettivo · Risultato chiave). Una sezione vuota non
 * c'è; senza niente, una frase sola. Ogni elenco mostra tre righe, poi «Vedi tutti (N)».
 *
 * I dati vengono dalla rotta di sempre (/api/workspaces/<ws>/sidebar-data), riletta ogni 5 secondi come prima: i tool
 * della chat li cambiano mentre si parla.
 */
import { useEffect, useState, type JSX, type ReactNode } from "react";
import { formatCount } from "../../../lib/mappatura/text.ts";
import { BoardButton, Tag } from "../ui/atoms.tsx";
import { INTERVIEW_TEXT, capitalized } from "./text.ts";

const S = INTERVIEW_TEXT.summary;

/** Ogni quanto il riepilogo si rilegge, come la colonna della Discovery. */
export const SUMMARY_POLL_MS = 5_000;

/** Le righe di un elenco prima di «Vedi tutti (N)». */
export const SUMMARY_ROWS = 3;

export interface InterviewSummaryData {
  /** Dove l'azienda crea valore, in una frase. */
  value: string | null;
  /** Dove fa la differenza. */
  differs: string[];
  /** Le unità, con le persone se si sanno. */
  units: Array<{ id: string; name: string; people: number | null }>;
  /** Il nome delle unità nel workspace, come titolo («Unità», «Reparti»). */
  unitsTitle: string;
  goals: Array<{ id: string; title: string; type: string }>;
}

/** Il riepilogo come la pagina lo sa: ancora da leggere, o letto (null se la rotta non ha risposto). */
export type SummaryState = { loaded: false } | { loaded: true; data: InterviewSummaryData | null };

const text = (value: unknown): string => (typeof value === "string" ? value.trim() : "");
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const record = (value: unknown): Record<string, unknown> => (value && typeof value === "object" ? (value as Record<string, unknown>) : {});

/** La risposta della rotta, letta con prudenza: un campo che manca vale vuoto. */
export function summaryFromRoute(json: unknown): InterviewSummaryData | null {
  if (!json || typeof json !== "object") return null;
  const body = record(json);
  const thesis = record(body.thesis);
  const term = record(body.term);
  return {
    value: text(thesis.coreValueProposition) || null,
    differs: list(thesis.strategicNodes).map(text).filter(Boolean),
    units: list(body.departments)
      .map(record)
      .filter((unit) => text(unit.id) && text(unit.name))
      .map((unit) => ({ id: text(unit.id), name: text(unit.name), people: typeof unit.teamSize === "number" && unit.teamSize > 0 ? unit.teamSize : null })),
    unitsTitle: capitalized(text(term.plural) || "unità"),
    goals: list(body.goals)
      .map(record)
      .filter((goal) => text(goal.id) && text(goal.title))
      .map((goal) => ({ id: text(goal.id), title: text(goal.title), type: text(goal.type) })),
  };
}

/** Niente da mostrare: nessuna sezione ha righe. */
export const summaryEmpty = (data: InterviewSummaryData): boolean => !data.value && data.differs.length === 0 && data.units.length === 0 && data.goals.length === 0;

/** Il tipo di un obiettivo in parole: «Obiettivo» o «Risultato chiave». */
export const goalTagText = (type: string): string => (type === "key_result" ? S.goalTag.key_result : type === "objective" ? S.goalTag.objective : S.goalTag.goal);

/**
 * Il riepilogo dal vivo: letto all'apertura e poi ogni 5 secondi. Lo stato cambia solo dopo una risposta, mai dopo che
 * la pagina è andata via; una lettura non riuscita lascia quello che c'era e riprova al giro dopo.
 */
export function useInterviewSummary(workspaceId: string): SummaryState {
  const [state, setState] = useState<SummaryState>({ loaded: false });
  useEffect(() => {
    let active = true;
    const read = async () => {
      let data: InterviewSummaryData | null = null;
      try {
        const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/sidebar-data`);
        if (response.ok) data = summaryFromRoute(await response.json());
      } catch {
        data = null;
      }
      if (!active) return;
      setState((current) => (data ? { loaded: true, data } : current.loaded ? current : { loaded: true, data: null }));
    };
    void read();
    const timer = setInterval(() => void read(), SUMMARY_POLL_MS);
    return () => {
      active = false;
      clearInterval(timer);
    };
  }, [workspaceId]);
  return state;
}

/** Un elenco corto: tre righe, poi «Vedi tutti (N)», che apre il resto sul posto. */
function ShortList(p: { label: string; items: ReadonlyArray<{ key: string; body: ReactNode }> }): JSX.Element {
  const [all, setAll] = useState(false);
  const shown = all ? p.items : p.items.slice(0, SUMMARY_ROWS);
  return (
    <>
      <ul className="b-iv-list" aria-label={p.label}>
        {shown.map((item) => (
          <li key={item.key}>{item.body}</li>
        ))}
      </ul>
      {p.items.length > SUMMARY_ROWS ? (
        <BoardButton small variant="ghost" aria-expanded={all} onClick={() => setAll(!all)} data-action="more">
          {all ? S.showLess : S.showAll(p.items.length)}
        </BoardButton>
      ) : null}
    </>
  );
}

/** Una sezione del riepilogo: il titolo, con il conteggio accanto quando è un elenco. */
function Section(p: { title: string; count?: number; children: ReactNode }): JSX.Element {
  return (
    <section className="b-iv-sec">
      <h3 className="b-sh">
        {p.title}
        {p.count ? <small>{formatCount(p.count)}</small> : null}
      </h3>
      {p.children}
    </section>
  );
}

export function InterviewSummary(p: { state: SummaryState }): JSX.Element {
  if (!p.state.loaded) return <div className="b-iv-sum" aria-busy="true" data-b="summary" />;
  const data = p.state.data;
  if (!data || summaryEmpty(data)) {
    return (
      <div className="b-iv-sum" data-b="summary">
        <p className="b-iv-empty">{S.empty}</p>
      </div>
    );
  }
  return (
    <div className="b-iv-sum" data-b="summary">
      {data.value || data.differs.length > 0 ? (
        <Section title={S.value}>
          {data.value ? <p className="b-iv-text">{data.value}</p> : null}
          {data.differs.length > 0 ? <p className="b-iv-text b-iv-mute">{S.differs(data.differs.join(", "))}</p> : null}
        </Section>
      ) : null}
      {data.units.length > 0 ? (
        <Section title={data.unitsTitle} count={data.units.length}>
          <ShortList
            label={data.unitsTitle}
            items={data.units.map((unit) => ({
              key: unit.id,
              body: (
                <>
                  <span>{unit.name}</span>
                  {unit.people ? <small>{S.people(unit.people)}</small> : null}
                </>
              ),
            }))}
          />
        </Section>
      ) : null}
      {data.goals.length > 0 ? (
        <Section title={S.goals} count={data.goals.length}>
          <ShortList
            label={S.goals}
            items={data.goals.map((goal) => ({
              key: goal.id,
              body: (
                <>
                  <Tag tone="line">{goalTagText(goal.type)}</Tag>
                  <span>{goal.title}</span>
                </>
              ),
            }))}
          />
        </Section>
      ) : null}
    </div>
  );
}
