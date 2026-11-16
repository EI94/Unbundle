/**
 * «Mappatura board»: la mappa dei processi (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9, BOARD-SPEC §1.4.6).
 *
 * Una riga per processo (lettera, nome, chi lo segue; poi i passi da sinistra a destra) su un fondo a puntini che
 * scorre di lato nel suo riquadro, con l'etichetta ferma a sinistra. Un passo è una card della stessa larghezza delle
 * altre della riga, con una freccia tra due card. Il bordo sinistro dice l'attrito (oggi) oppure lo stream
 * (classificazione). Solo markup: lettere e codici li calcola chi usa questi pezzi (`processLetter`, `stepCode`), mai
 * salvati.
 *
 * Senza stato e senza hook; `StepCard` prende `onOpen`, quindi la usa un Client Component.
 */
import type { CSSProperties, JSX, ReactNode } from "react";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import type { Friction, Stream } from "../../../lib/mappatura/vocab.ts";
import { GatePill } from "./atoms.tsx";

/** Quante card di strumento mostra al più un passo (P15). */
export const STEP_CARD_TOOLS = 4;

/** Il numero di passi della riga più lunga (almeno uno): la larghezza di ogni riga della mappa. */
export const widestRow = (rows: ReadonlyArray<{ steps: readonly unknown[] }>) => Math.max(1, ...rows.map((row) => row.steps.length));

/**
 * Il riquadro della mappa (P13, P14). `dim`: è acceso «Evidenzia attriti» o un filtro (le card dicono da sole se
 * sfumano). `steps`: i passi della riga più lunga (`widestRow`); ogni riga è larga quanto lei, come sul riferimento dove
 * ogni riga ha la stessa larghezza, così quando la mappa scorre di lato l'etichetta di ogni riga resta ferma a
 * sinistra. `adds`: le righe hanno «+ passo» in fondo, e la loro larghezza ne tiene conto.
 */
export function ProcessMap(p: { children: ReactNode; dim?: boolean; steps: number; adds?: boolean }): JSX.Element {
  const style = { "--steps": Math.max(1, Math.floor(p.steps)) } as CSSProperties;
  return (
    <div className="b-pm" style={style} data-dim={p.dim ? "" : undefined} data-adds={p.adds ? "" : undefined} data-b="map">
      {p.children}
    </div>
  );
}

/**
 * Una riga della mappa (P11, P13): l'etichetta ferma a sinistra (lettera, nome, chi lo segue, `extra` sotto: attriti,
 * voti), poi i passi; `after` in fondo alla riga («+ passo»). La larghezza minima è quella del riquadro (`--steps`).
 */
export function ProcessRow(p: { letter: string; name: ReactNode; owner?: ReactNode; extra?: ReactNode; children: ReactNode; after?: ReactNode }): JSX.Element {
  return (
    <div className="b-pm-row" data-b="process-row">
      <div className="b-pm-lab">
        <span className="b-lid">{p.letter}</span>
        <b>{p.name}</b>
        {p.owner ? <small>{p.owner}</small> : null}
        {p.extra ? <div className="b-pm-extra">{p.extra}</div> : null}
      </div>
      <div className="b-pm-steps">
        {p.children}
        {p.after ? <div className="b-pm-after">{p.after}</div> : null}
      </div>
    </div>
  );
}

/** La freccia tra due passi di una riga: niente rami, niente giri, un processo è una linea dritta. */
export function StepArrow(): JSX.Element {
  return (
    <div className="b-arrow" aria-hidden="true" data-b="arrow">
      <svg viewBox="0 0 16 10" focusable="false">
        <path d="M0 5h13M10 1l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.3" />
      </svg>
    </div>
  );
}

/**
 * Un passo sulla mappa (P15–P17, P19, P23–P25): un bottone che apre il drawer (Invio e Spazio compresi). Il titolo; con
 * `badges` (classificazione) la riga dei badge e, al posto della descrizione mancante, `note` («da classificare»); la
 * descrizione tagliata a tre righe; «Chi:» e i ruoli tagliati a tre righe; al più quattro strumenti; la pillola della
 * decisione (`gate`: una stringa è il nome, null «Decide una persona», false o assente nessuna); il tag tratteggiato
 * «da validare». `accent`: il bordo sinistro dell'attrito (oggi) o dello stream (classificazione). `grip`: la maniglia
 * per trascinare, fuori dal bottone. Il codice del passo è nel nome per gli screen reader e in `data-step`.
 */
export function StepCard(p: {
  code: string;
  title: string;
  description?: string | null;
  who?: readonly string[];
  tools?: readonly string[];
  accent?: { kind: "friction"; level: Friction } | { kind: "stream"; stream: Stream | null };
  badges?: ReactNode;
  gate?: string | null | false;
  toValidate?: boolean;
  note?: string | null;
  dimmed?: boolean;
  grip?: ReactNode;
  onOpen(): void;
}): JSX.Element {
  const accent = p.accent;
  const pain = accent?.kind === "friction" && accent.level > 0 ? String(accent.level) : undefined;
  const stream = accent?.kind === "stream" ? accent : null;
  const who = (p.who ?? []).filter((role) => role.trim() !== "");
  const tools = (p.tools ?? []).filter((tool) => tool.trim() !== "").slice(0, STEP_CARD_TOOLS);
  const card = (
    <button
      type="button"
      className={stream ? "b-node b-tb" : "b-node"}
      data-pain={pain}
      data-stream={stream?.stream ?? undefined}
      data-step={p.code}
      data-dimmed={p.dimmed ? "" : undefined}
      aria-haspopup="dialog"
      onClick={() => p.onOpen()}
      data-b="step"
    >
      <span className="b-sr">{p.code}</span>
      <span className="b-nt">{p.title}</span>
      {p.badges ? <span className="b-ag">{p.badges}</span> : null}
      {p.note ? <span className="b-none">{p.note}</span> : null}
      {p.description ? <span className="b-ns2">{p.description}</span> : null}
      {who.length > 0 ? (
        <span className="b-who">
          <b>{BOARD_TEXT.card.who}</b> {who.join(", ")}
        </span>
      ) : null}
      {tools.length > 0 ? (
        <span className="b-chips">
          {tools.map((tool, index) => (
            <span className="b-chip b-tool" key={`${index}:${tool}`}>
              {tool}
            </span>
          ))}
        </span>
      ) : null}
      {p.gate === false || p.gate === undefined ? null : <GatePill label={p.gate} />}
      {p.toValidate ? <span className="b-tag b-line">{BOARD_TEXT.card.toValidate}</span> : null}
    </button>
  );
  if (!p.grip) return card;
  return (
    <div className="b-node-w">
      {p.grip}
      {card}
    </div>
  );
}
