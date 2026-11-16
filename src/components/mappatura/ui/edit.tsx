"use client";

/**
 * «Mappatura board»: i controlli per modificare la board (docs/mappatura/MAPPATURA-BOARD-PIANO.md §4.9, P51–P57, P65,
 * P67, P44; BOARD-SPEC §1.4.7, §1.4.11, §1.4.12, §1.4.14, §1.4.15).
 *
 * Il testo che si scrive sul posto, la nota con i suoi tre stati e i suoi due controlli, i chip di ruoli e strumenti
 * con «+ ruolo», i voti, i bottoni di un livello, il selettore a segmenti, il campo con l'etichetta in mono, il toast
 * della board, la conferma in linea, il blocco di una vista vuota. Le classi di `board.css`, i colori dei suoi token,
 * le scritte di `src/lib/mappatura/text.ts` o quelle che arrivano da chi li usa. Ogni pezzo porta `data-b="<nome>"`.
 *
 * Un testo si salva quando la persona lascia il campo: un'operazione per modifica, dal valore che c'era quando ci è
 * entrata a quello che lascia (P52). Escape lascia il campo e basta: un secondo Escape chiude il drawer. Un controllo
 * spento (board in sola lettura) è spento dal primo disegno (F9).
 */
import { useLayoutEffect, useRef, useState, type JSX, type KeyboardEvent, type ReactNode } from "react";
import { uncheckedNoteStatus, type BoardNote } from "../../../lib/mappatura/board-model.ts";
import { cutLine, oneLine, prose } from "../../../lib/mappatura/board-ops.ts";
import { BOARD_TEXT, formatCount, noteCaption, votesLabel } from "../../../lib/mappatura/text.ts";
import { MAPPING_LIMITS } from "../../../lib/mappatura/vocab.ts";
import { PAGE_TOAST_HOST, useOptionalBoardState, useToastHost } from "../store/use-board.tsx";
import { AddButton, BoardButton, Chip, RemoveIcon } from "./atoms.tsx";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

// ─── Testo sul posto ─────────────────────────────────────────────────

/** Il testo come si salva: una riga senza spazi doppi, o un testo su più righe con gli a capo puliti. */
export const settledText = (text: string, multiline: boolean | undefined) => (multiline ? prose(text) : oneLine(text));

/**
 * Il testo da salvare quando la persona lascia il campo, o null se non è cambiato rispetto a quello che c'era quando ci
 * è entrata (`base`). Il confronto è sul testo rifinito: uno spazio in più non è una modifica.
 */
export function committedText(edit: { base: string; text: string }, multiline: boolean | undefined): string | null {
  const next = settledText(edit.text, multiline);
  return next === settledText(edit.base, multiline) ? null : next;
}

/**
 * Un testo che si modifica sul posto (P52): una riga (`input`) o più righe (`textarea` che cresce con il testo). Si
 * salva lasciando il campo, o con Invio su una riga, o con Cmd/Ctrl+Invio su più righe; `onCommit` riceve il testo
 * nuovo e quello che c'era quando la persona è entrata (il `prev` dell'operazione). Escape lascia il campo.
 */
export function TextInPlace(p: {
  value: string;
  onCommit(next: string, base: string): void;
  label: string;
  placeholder?: string;
  multiline?: boolean;
  maxLength: number;
  disabled?: boolean;
  autoFocus?: boolean;
  className?: string;
}): JSX.Element {
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const shown = edit?.text ?? p.value;

  // Più righe: il campo è alto quanto il suo testo.
  useLayoutEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${element.scrollHeight}px`;
  }, [shown]);

  const leave = (text: string) => {
    const base = edit?.base ?? p.value;
    setEdit(null);
    const next = committedText({ base, text }, p.multiline);
    if (next !== null) p.onCommit(next, base);
  };
  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "Escape") {
      event.stopPropagation();
      event.currentTarget.blur();
    } else if (event.key === "Enter" && (!p.multiline || event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      event.currentTarget.blur();
    }
  };
  const common = {
    className: cx("b-textin", p.className),
    value: shown,
    "aria-label": p.label,
    placeholder: p.placeholder,
    maxLength: p.maxLength,
    disabled: p.disabled,
    autoFocus: p.autoFocus,
    spellCheck: true,
    onFocus: () => setEdit((current) => current ?? { base: p.value, text: p.value }),
    onBlur: (event: { currentTarget: { value: string } }) => leave(event.currentTarget.value),
    onKeyDown,
    "data-b": "text",
  };
  return p.multiline ? (
    <textarea {...common} ref={area} rows={1} onChange={(event) => setEdit({ base: edit?.base ?? p.value, text: event.target.value })} />
  ) : (
    <input {...common} type="text" onChange={(event) => setEdit({ base: edit?.base ?? p.value, text: event.target.value })} />
  );
}

/** Un numero che si salva quando la persona lascia il campo o preme Invio, non a ogni tasto (BOARD-SPEC §1.4.14). */
export function NumberInput(p: {
  value: number | null;
  onCommit(next: number | null, base: number | null): void;
  label?: string;
  min?: number;
  max?: number;
  step?: number;
  disabled?: boolean;
}): JSX.Element {
  const [edit, setEdit] = useState<{ base: number | null; text: string } | null>(null);
  const shown = edit?.text ?? (p.value === null ? "" : String(p.value));
  const leave = (text: string) => {
    const base = edit ? edit.base : p.value;
    setEdit(null);
    const next = parsedNumber(text, p.min, p.max);
    if (next !== base) p.onCommit(next, base);
  };
  return (
    <input
      className="b-input"
      type="number"
      inputMode="decimal"
      aria-label={p.label}
      min={p.min}
      max={p.max}
      step={p.step ?? "any"}
      disabled={p.disabled}
      value={shown}
      onFocus={() => setEdit((current) => current ?? { base: p.value, text: p.value === null ? "" : String(p.value) })}
      onChange={(event) => setEdit({ base: edit ? edit.base : p.value, text: event.target.value })}
      onBlur={(event) => leave(event.currentTarget.value)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.stopPropagation();
          event.currentTarget.blur();
        } else if (event.key === "Enter") {
          event.preventDefault();
          event.currentTarget.blur();
        }
      }}
      data-b="number"
    />
  );
}

/** Il numero scritto in un campo: vuoto è null; la virgola vale come il punto; fuori dai limiti si porta dentro. */
export function parsedNumber(text: string, min?: number, max?: number): number | null {
  const clean = text.trim().replace(",", ".");
  if (clean === "") return null;
  const value = Number(clean);
  if (!Number.isFinite(value)) return null;
  return Math.min(max ?? Number.POSITIVE_INFINITY, Math.max(min ?? Number.NEGATIVE_INFINITY, value));
}

// ─── La nota ─────────────────────────────────────────────────────────

function CheckIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 12 12" aria-hidden="true" focusable="false">
      <path d="M2 6.3l2.5 2.4L10 3.3" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** L'etichetta della spunta di una nota: validarla, o toglierla (e la nota torna «ipotesi» o «da fonti», P56). */
export function noteToggleLabel(note: Pick<BoardNote, "status" | "origin">): string {
  if (note.status !== "validato") return BOARD_TEXT.note.validate;
  return uncheckedNoteStatus(note.origin) === "fonte" ? BOARD_TEXT.note.unvalidateSource : BOARD_TEXT.note.unvalidate;
}

/**
 * Una nota (P51–P57): il testo sul posto, e i suoi tre stati come sul riferimento: righe sottili e «ipotesi»; contorno
 * interno e «da fonti · chat» (o documenti, o prima della board); una spunta se validata. Due controlli che compaiono al
 * passaggio o al fuoco (sempre senza mouse): la spunta e la «×». Lasciata vuota, `onText("")`: chi la usa la toglie.
 */
export function NoteItem(p: { note: BoardNote; label: string; disabled?: boolean; autoFocus?: boolean; onText(next: string, base: string): void; onToggle(): void; onRemove(): void }): JSX.Element {
  const { note } = p;
  const caption = noteCaption(note.status, note.origin);
  const toggle = noteToggleLabel(note);
  return (
    <div className="b-note-w" data-status={note.status} data-origin={note.origin} data-b="note">
      <div className="b-note">
        <TextInPlace value={note.text} label={p.label} multiline maxLength={MAPPING_LIMITS.note} disabled={p.disabled} autoFocus={p.autoFocus} onCommit={p.onText} />
      </div>
      {caption ? <span className="b-note-cap">{caption}</span> : <span className="b-sr">{BOARD_TEXT.note.validated}</span>}
      {p.disabled ? null : (
        <div className="b-note-ctl">
          <button type="button" aria-label={toggle} title={toggle} onClick={() => p.onToggle()}>
            <CheckIcon />
          </button>
          <button type="button" aria-label={BOARD_TEXT.note.removeLabel} title={BOARD_TEXT.note.remove} onClick={() => p.onRemove()}>
            <RemoveIcon />
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Chip di ruoli e strumenti ───────────────────────────────────────

/**
 * La lista dopo l'aggiunta di un valore scritto: rifinito, tagliato a `maxLength`, senza doppioni (a meno di
 * maiuscole); null se non c'è niente da aggiungere o la lista è piena.
 */
export function addedChip(values: readonly string[], raw: string, max: number, maxLength: number): string[] | null {
  const text = cutLine(raw, maxLength);
  if (!text || values.length >= max) return null;
  const key = text.toLocaleLowerCase("it");
  if (values.some((value) => value.toLocaleLowerCase("it") === key)) return null;
  return [...values, text];
}

/**
 * I chip di ruoli o strumenti di un passo, ognuno con la sua «×», e il bottone tratteggiato che apre il campo per
 * aggiungerne uno («+ ruolo», «+ strumento»). Invio aggiunge e lascia il campo aperto per il prossimo; Escape lo chiude.
 */
export function ChipInput(p: {
  values: readonly string[];
  tool?: boolean;
  addLabel: string;
  placeholder: string;
  max: number;
  maxLength: number;
  disabled?: boolean;
  onChange(next: string[]): void;
}): JSX.Element {
  const [adding, setAdding] = useState(false);
  const [text, setText] = useState("");
  const add = (raw: string) => {
    const next = addedChip(p.values, raw, p.max, p.maxLength);
    if (next) p.onChange(next);
  };
  const room = !p.disabled && p.values.length < p.max;
  return (
    <div className="b-chipin" data-b="chip-input">
      {p.values.map((value, index) => (
        <Chip key={`${index}:${value}`} tool={p.tool} onRemove={p.disabled ? undefined : () => p.onChange(p.values.filter((_, at) => at !== index))}>
          {value}
        </Chip>
      ))}
      {room && adding ? (
        <input
          className="b-input"
          type="text"
          autoFocus
          aria-label={p.placeholder}
          placeholder={p.placeholder}
          maxLength={p.maxLength}
          value={text}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing) return;
            if (event.key === "Enter") {
              event.preventDefault();
              add(text);
              setText("");
            } else if (event.key === "Escape") {
              event.stopPropagation();
              setText("");
              setAdding(false);
            }
          }}
          onBlur={() => {
            add(text);
            setText("");
            setAdding(false);
          }}
        />
      ) : null}
      {room && !adding ? <AddButton onClick={() => setAdding(true)}>{p.addLabel}</AddButton> : null}
    </div>
  );
}

// ─── Voti, livelli, segmenti, campi ──────────────────────────────────

/** I miei voti dopo un clic: mai sotto zero, mai oltre il massimo. */
export const nextVotes = (mine: number, delta: number) => Math.min(MAPPING_LIMITS.votes, Math.max(0, Math.floor(mine) + delta));

/**
 * I voti di un processo (P65): `−`, il totale in ambra, `+`. Ognuno muove solo i suoi voti, mai sotto zero; il totale è
 * la somma di tutti. Al limite il bottone resta raggiungibile (`aria-disabled`): il fuoco non si perde (F1).
 */
export function Votes(p: { total: number; mine: number; disabled?: boolean; onChange(mine: number): void }): JSX.Element {
  const total = Math.max(0, Math.floor(p.total));
  const mine = nextVotes(p.mine, 0);
  const less = nextVotes(mine, -1);
  const more = nextVotes(mine, 1);
  return (
    <div className="b-votes" role="group" aria-label={votesLabel(total, mine)} data-b="votes">
      <button
        type="button"
        aria-label={BOARD_TEXT.votes.less}
        disabled={p.disabled}
        aria-disabled={!p.disabled && less === mine ? true : undefined}
        onClick={() => {
          if (less !== mine) p.onChange(less);
        }}
      >
        −
      </button>
      <span className="b-vb" aria-hidden="true">
        {formatCount(total)}
      </span>
      <button
        type="button"
        aria-label={BOARD_TEXT.votes.more}
        disabled={p.disabled}
        aria-disabled={!p.disabled && more === mine ? true : undefined}
        onClick={() => {
          if (more !== mine) p.onChange(more);
        }}
      >
        +
      </button>
    </div>
  );
}

/** I bottoni di un livello (P67): uno premuto (`aria-pressed`); l'attrito con le sue quattro parole. */
export function LevelButtons<T extends string | number>(p: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string }>;
  value: T | null;
  disabled?: boolean;
  onChange(value: T): void;
}): JSX.Element {
  return (
    <div className="b-feas" role="group" aria-label={p.label} data-b="levels">
      {p.options.map((option) => (
        <button key={String(option.value)} type="button" aria-pressed={option.value === p.value} disabled={p.disabled} onClick={() => p.onChange(option.value)}>
          {option.label}
        </button>
      ))}
    </div>
  );
}

/**
 * Il selettore a segmenti (P44): uno solo premuto; il punto ambra segna quello proposto (`recommended`), con
 * `recommendedLabel` come titolo e per gli screen reader («Proposto dall'assistente»).
 */
export function Segmented<T extends string>(p: {
  label: string;
  options: ReadonlyArray<{ value: T; label: string; recommended?: boolean }>;
  value: T;
  disabled?: boolean;
  onChange(value: T): void;
  recommendedLabel?: string;
}): JSX.Element {
  return (
    <div className="b-wsel" role="group" aria-label={p.label} data-b="segmented">
      {p.options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={option.recommended ? "b-rec" : undefined}
          aria-pressed={option.value === p.value}
          disabled={p.disabled}
          title={option.recommended ? p.recommendedLabel : undefined}
          onClick={() => p.onChange(option.value)}
        >
          {option.label}
          {option.recommended && p.recommendedLabel ? <span className="b-sr"> {p.recommendedLabel}</span> : null}
        </button>
      ))}
    </div>
  );
}

/** Un campo con la sua etichetta in mono sopra (BOARD-SPEC §1.4.14). I numeri si salvano al cambio: `NumberInput`. */
export function Field(p: { label: string; children: ReactNode }): JSX.Element {
  return (
    <label className="b-field" data-b="field">
      <span>{p.label}</span>
      {p.children}
    </label>
  );
}

// ─── Toast, conferma, vuoto ──────────────────────────────────────────

/**
 * Il toast della board (P78): in basso al centro, d'inchiostro, uno alla volta, una regione viva educata; con
 * «Annulla» o un'altra azione quando c'è. Legge il toast dallo store. Ha un posto solo alla volta: la pagina
 * (`PAGE_TOAST_HOST`), o il drawer aperto più in alto, che passa il suo `host`.
 */
export function BoardToastView(p: { host?: string } = {}): JSX.Element {
  const state = useOptionalBoardState();
  const current = useToastHost();
  const host = p.host ?? PAGE_TOAST_HOST;
  const toast = state?.toast && current === host ? state.toast : null;
  return (
    <div className={cx("b-toast", toast && "b-on")} role="status" aria-live="polite" data-b="toast">
      {toast ? (
        <>
          <span key={toast.key}>{toast.text}</span>
          {toast.action ? (
            <button type="button" onClick={() => toast.action?.run()}>
              {toast.action.label}
            </button>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

/** La conferma in linea, accanto al bottone premuto (BOARD-SPEC §1.4.15): la domanda e due bottoni, nessun dialogo. */
export function InlineConfirm(p: { question: string; yes: string; no: string; onYes(): void; onNo(): void }): JSX.Element {
  return (
    <span className="b-confirm b-on" role="group" aria-label={p.question} data-b="confirm">
      {p.question}
      <BoardButton small onClick={() => p.onYes()}>
        {p.yes}
      </BoardButton>
      <BoardButton small variant="ghost" onClick={() => p.onNo()}>
        {p.no}
      </BoardButton>
    </span>
  );
}

/** Il blocco di una vista vuota (il riferimento nasce pieno): il titolo, una frase, e le strade per cominciare. */
export function EmptyBlock(p: { title: string; text: string; children?: ReactNode }): JSX.Element {
  return (
    <div className="b-empty" data-b="empty">
      <b>{p.title}</b>
      <p>{p.text}</p>
      {p.children ? <div className="b-empty-actions">{p.children}</div> : null}
    </div>
  );
}
