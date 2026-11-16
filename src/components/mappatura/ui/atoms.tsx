/**
 * «Mappatura board»: i pezzi piccoli della board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9, BOARD-SPEC §1.4.2,
 * §1.4.4, §1.4.9–§1.4.11).
 *
 * Bottoni, tag, chip, punti e badge, riquadri dei numeri, legenda, filtri, sezioni che si aprono, tabelle che sul
 * telefono diventano blocchi, righe che portano a una pagina. Solo markup, nessuno stato: le classi di `board.css`, i
 * colori dei suoi token, le scritte di `src/lib/mappatura/text.ts` o quelle che arrivano da chi li usa. Ogni pezzo
 * porta `data-b="<nome>"`.
 *
 * Senza stato e senza hook: vanno bene in una pagina del server e in un Client Component. Chi passa una funzione
 * (`onToggle`, `onRemove`, `onClick`) li usa da un Client Component.
 */
import Link from "next/link";
import type { ButtonHTMLAttributes, JSX, ReactNode } from "react";
import { firstSentence } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT, exposureBadgeLabel, removeChipLabel, streamLabel } from "../../../lib/mappatura/text.ts";
import type { Stream } from "../../../lib/mappatura/vocab.ts";
import { focusBeforeRemoving, type FocusNode } from "./focus.ts";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

// ─── Bottoni ─────────────────────────────────────────────────────────

/**
 * Un bottone della board: contornato per default; `primary` pieno d'inchiostro (uno solo per schermata, e in un drawer
 * la sua sola strada avanti); `ghost` trasparente; `small` più piccolo. `type="button"` se non è detto altro.
 */
export function BoardButton(p: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "outline" | "primary" | "ghost"; small?: boolean }): JSX.Element {
  const { variant = "outline", small, className, type = "button", ...rest } = p;
  return (
    <button
      {...rest}
      type={type}
      className={cx("b-btn", variant === "primary" && "b-primary", variant === "ghost" && "b-ghost", small && "b-small", className)}
      data-b="button"
      data-variant={variant}
    />
  );
}

/** Il bottone tratteggiato di quello che si aggiunge: «+ nota», «+ passo», «+ processo». */
export function AddButton(p: ButtonHTMLAttributes<HTMLButtonElement>): JSX.Element {
  const { className, type = "button", ...rest } = p;
  return <button {...rest} type={type} className={cx("b-add", className)} data-b="add" />;
}

// ─── Tag, chip, punti, badge ─────────────────────────────────────────

const TAG_TONE = { signal: null, amber: "b-amber", crit: "b-crit", ink: "b-ink", line: "b-line" } as const;

/** Un tag in mono maiuscolo: `line` tratteggiato per quello che è da confermare («da validare»). */
export function Tag(p: { tone?: "signal" | "amber" | "crit" | "ink" | "line"; children: ReactNode }): JSX.Element {
  return (
    <span className={cx("b-tag", TAG_TONE[p.tone ?? "signal"])} data-b="tag">
      {p.children}
    </span>
  );
}

/** Il segno «×» dei controlli che tolgono qualcosa. */
export function RemoveIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true" focusable="false">
      <path d="M3 3l6 6M9 3l-6 6" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

/**
 * Un chip tondo per un ruolo o una persona; `tool` in mono e squadrato per uno strumento o un sistema. Con `onRemove`
 * porta la sua «×» («Togli {nome}», o `removeLabel`).
 */
export function Chip(p: { tool?: boolean; onRemove?: () => void; removeLabel?: string; children: ReactNode }): JSX.Element {
  const label = p.removeLabel ?? (typeof p.children === "string" ? removeChipLabel(p.children) : undefined);
  return (
    <span className={cx("b-chip", p.tool && "b-tool")} data-b="chip">
      {p.children}
      {p.onRemove ? (
        <button
          type="button"
          aria-label={label}
          title={label}
          onClick={(event) => {
            // Il chip se ne va con la sua «×»: il fuoco va alla «×» del chip vicino, o a «+ ruolo» (F1).
            focusBeforeRemoving(event.currentTarget as unknown as FocusNode, '[data-b="chip"]');
            p.onRemove?.();
          }}
        >
          <RemoveIcon />
        </button>
      ) : null}
    </span>
  );
}

/**
 * Il punto di una legenda: i tre attriti (`crit`, `amber`, `neutral`), uno stream, il grigio dell'esposizione.
 * `diamond`: il rombo di «decide una persona».
 */
export function Dot(p: { tone: "crit" | "amber" | "neutral" | Stream | "auto"; diamond?: boolean }): JSX.Element {
  return <i className={cx("b-adot", p.diamond && "b-diamond")} data-tone={p.diamond ? undefined : p.tone} aria-hidden="true" data-b="dot" />;
}

/** Il badge di uno stream, nel suo colore (P23, P28). `small`: la forma che sta nelle card. */
export function StreamBadge(p: { stream: Stream; small?: boolean }): JSX.Element {
  return (
    <span className={cx("b-abadge", p.small && "b-small")} data-stream={p.stream} data-b="stream-badge">
      {streamLabel(p.stream)}
    </span>
  );
}

/** Il badge grigio dell'esposizione all'AI dal match O*NET: «AI 34%» (al posto di «AUTO» del riferimento). */
export function ExposureBadge(p: { pct: number; small?: boolean }): JSX.Element {
  return (
    <span className={cx("b-abadge", "b-auto", p.small && "b-small")} data-b="exposure-badge">
      {exposureBadgeLabel(p.pct)}
    </span>
  );
}

/** La pillola ambra della decisione di una persona, con il rombo (P25): il nome della decisione, o «Decide una persona». */
export function GatePill(p: { label: string | null }): JSX.Element {
  return (
    <span className="b-gate" data-b="gate">
      {p.label?.trim() || BOARD_TEXT.card.decides}
    </span>
  );
}

const STATUS_TONE = { neutral: null, ok: "b-ok", wait: "b-wait", check: "b-ver" } as const;

/** Il chip di uno stato: neutro, `ok` (quello che c'è), `wait` (quello che aspetta), `check` tratteggiato (da verificare). */
export function StatusChip(p: { tone: "neutral" | "ok" | "wait" | "check"; children: ReactNode }): JSX.Element {
  return (
    <span className={cx("b-st-chip", STATUS_TONE[p.tone])} data-tone={p.tone} data-b="status-chip">
      {p.children}
    </span>
  );
}

// ─── Numeri, legenda, filtri ─────────────────────────────────────────

/** I numeri prima di tutto (P37): quattro riquadri, il numero in serif e una riga sotto; due per riga stretti. */
export function Kpis(p: { items: ReadonlyArray<{ value: string; label: string }> }): JSX.Element {
  return (
    <div className="b-kpis" data-b="kpis">
      {p.items.map((item, index) => (
        <div className="b-kpi" key={`${index}:${item.label}`}>
          <div className="b-kv">{item.value}</div>
          <div className="b-kl">{item.label}</div>
        </div>
      ))}
    </div>
  );
}

/** La legenda sopra la mappa: punti e scritte su una riga che va a capo. */
export function Legend(p: { children: ReactNode }): JSX.Element {
  return (
    <div className="b-legend" data-b="legend">
      {p.children}
    </div>
  );
}

/** Una voce della legenda: il punto e la scritta. */
export function LegendItem(p: { dot: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <span data-b="legend-item">
      {p.dot}
      {p.children}
    </span>
  );
}

/** Un chip che filtra o evidenzia: premuto è pieno d'inchiostro (`aria-pressed`, P45, P61). Non si salva. */
export function FilterChip(p: { pressed: boolean; onToggle(): void; dot?: ReactNode; children: ReactNode }): JSX.Element {
  return (
    <button type="button" className="b-fchip" aria-pressed={p.pressed} onClick={() => p.onToggle()} data-b="filter-chip">
      {p.dot}
      {p.children}
    </button>
  );
}

// ─── Dettagli a richiesta ────────────────────────────────────────────

/** Una sezione chiusa (P34): «+» e «–» in mono, il titolo, accanto in grigio un conteggio o il contenuto in due parole. */
export function Section(p: { title: string; hint?: ReactNode; defaultOpen?: boolean; children: ReactNode }): JSX.Element {
  return (
    <details className="b-sec" open={p.defaultOpen === true ? true : undefined} data-b="section">
      <summary>
        {p.title}
        {p.hint ? <small>{p.hint}</small> : null}
      </summary>
      <div className="b-body">{p.children}</div>
    </details>
  );
}

/** Un testo lungo (P35): la prima frase, e il resto sotto «Dettagli». */
export function MoreText(p: { text: string }): JSX.Element {
  const { first, rest } = firstSentence(p.text);
  return (
    <div data-b="more">
      <span>{first}</span>
      {rest ? (
        <details className="b-more-t">
          <summary>{BOARD_TEXT.buttons.details}</summary>
          <span>{rest}</span>
        </details>
      ) : null}
    </div>
  );
}

/**
 * Una tabella senza bordo esterno, che scorre di lato nel suo riquadro; sotto 680 px della board ogni riga diventa un
 * blocco: la prima cella come titolo, le altre con il nome della colonna davanti (P82).
 */
export function StackTable(p: { columns: readonly string[]; rows: ReadonlyArray<readonly ReactNode[]> }): JSX.Element {
  return (
    <div className="b-tscroll" data-b="table">
      <table className="b-tbl b-stack">
        <thead>
          <tr>
            {p.columns.map((column, index) => (
              <th key={`${index}:${column}`} scope="col">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {p.rows.map((row, rowIndex) => (
            <tr key={rowIndex}>
              {row.map((cell, index) => (
                <td key={index} data-l={index > 0 ? p.columns[index] : undefined}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Una riga per caso (P42, P43): un'unità nell'elenco, uno use case nella classificazione. Tutta la riga è un link alla
 * pagina che ha il dettaglio; il bordo sinistro prende il colore dello stream (`accent`). Le colonne le dà la vista
 * (`--b-crow-cols`).
 */
export function RowLink(p: { href: string; accent?: Stream | null; label: string; children: ReactNode }): JSX.Element {
  return (
    <Link href={p.href} className="b-crow" data-accent={p.accent ?? undefined} aria-label={p.label} data-b="row">
      {p.children}
    </Link>
  );
}
