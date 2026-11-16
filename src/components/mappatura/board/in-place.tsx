"use client";

/**
 * «Mappatura board»: i campi che le viste della board modificano sul posto (docs/mappatura/MAPPATURA-BOARD-PIANO.md
 * §1.3, P35, P52, P53, P55).
 *
 * Accanto a `TextInPlace` delle fondamenta servono tre forme:
 * - `LineInPlace`: una riga che va a capo quando non ci sta (un titolo, il nome di un processo, la scoperta in serif):
 *   Invio salva, come su una riga sola, ma il testo lungo si legge tutto invece di scorrere dentro il campo;
 * - `TextWithMore`: un testo lungo che si legge come sul riferimento (la prima frase, il resto sotto «Dettagli», P35) e
 *   si modifica con un clic sulla prima frase;
 * - `DraftText` e `DraftPoint`: la nota e il punto di analisi appena aggiunti, con il cursore dentro (P53). Non esistono
 *   finché non hanno un testo: lasciati vuoti spariscono senza lasciare niente (P55).
 * Si salva quando la persona lascia il campo: un'operazione per modifica, dal valore che c'era quando è entrata (P52).
 * Invio salva e lascia il cursore nel campo; Escape lascia il campo al drawer (un secondo Escape lo chiude) o alla vista:
 * il fuoco non cade mai sulla pagina (`leaveFieldKey`).
 */
import { useState, type FocusEvent, type JSX } from "react";
import { firstSentence } from "../../../lib/mappatura/board-model.ts";
import { BOARD_TEXT } from "../../../lib/mappatura/text.ts";
import { MoreText } from "../ui/atoms.tsx";
import { TextInPlace, committedText, leaveFieldKey, settledText, useFittedHeight } from "../ui/edit.tsx";

const cx = (...names: Array<string | false | null | undefined>) => names.filter(Boolean).join(" ");

/**
 * Un campo di testo alto quanto il suo testo, anche quando cambia la sua larghezza (il pannello dell'assistente che si
 * apre, la finestra che si stringe) o arrivano i font: `useFittedHeight` delle fondamenta.
 */
const useAutoHeight = (text: string) => useFittedHeight<HTMLTextAreaElement>(text);


/**
 * Una riga di testo che va a capo, modificata sul posto. Si salva lasciando il campo o con Invio; `onCommit` riceve il
 * testo nuovo (una riga, senza spazi doppi) e quello che c'era quando la persona è entrata. `onLeave`: la persona ha
 * lasciato il campo, cambiato o no. `selectOnFocus`: il testo è scelto all'entrata, così si scrive sopra (un processo
 * appena aggiunto, «Nuovo processo»).
 */
export function LineInPlace(p: {
  value: string;
  onCommit(next: string, base: string): void;
  onLeave?(): void;
  label: string;
  placeholder?: string;
  maxLength: number;
  disabled?: boolean;
  autoFocus?: boolean;
  selectOnFocus?: boolean;
  className?: string;
}): JSX.Element {
  const [edit, setEdit] = useState<{ base: string; text: string } | null>(null);
  const shown = edit?.text ?? p.value;
  const area = useAutoHeight(shown);
  const commit = (text: string) => {
    const base = edit?.base ?? p.value;
    setEdit(null);
    const next = committedText({ base, text }, false);
    if (next !== null) p.onCommit(next, base);
  };
  const leave = (text: string) => {
    commit(text);
    p.onLeave?.();
  };
  return (
    <textarea
      ref={area}
      rows={1}
      className={cx("b-textin", "b-line", p.className)}
      value={shown}
      aria-label={p.label}
      placeholder={p.placeholder}
      maxLength={p.maxLength}
      disabled={p.disabled}
      autoFocus={p.autoFocus}
      spellCheck
      onFocus={(event) => {
        setEdit((current) => current ?? { base: p.value, text: p.value });
        if (p.selectOnFocus) event.currentTarget.select();
      }}
      onChange={(event) => setEdit({ base: edit?.base ?? p.value, text: event.target.value.replace(/[\r\n]+/g, " ") })}
      onBlur={(event) => leave(event.currentTarget.value)}
      onKeyDown={(event) => {
        // Invio salva e lascia il cursore qui; Escape lascia il campo al drawer o alla vista (`leaveFieldKey`).
        const field = event.currentTarget;
        leaveFieldKey(event, { enter: "line", stays: true, commit: () => commit(field.value) });
      }}
      data-b="line"
    />
  );
}

/**
 * Un testo lungo come sul riferimento (P35): la prima frase, e il resto sotto «Dettagli». Chi può modificare fa clic
 * sulla prima frase e scrive il testo intero; lasciato il campo, torna la lettura. In sola lettura è `MoreText`.
 */
export function TextWithMore(p: { text: string; onCommit(next: string, base: string): void; label: string; editLabel: string; placeholder?: string; maxLength: number; disabled?: boolean }): JSX.Element {
  const [editing, setEditing] = useState(false);
  if (p.disabled) return <MoreText text={p.text} />;
  if (editing) {
    return (
      <span className="b-more-w" onBlur={() => setEditing(false)}>
        <TextInPlace value={p.text} multiline autoFocus label={p.label} placeholder={p.placeholder} maxLength={p.maxLength} onCommit={p.onCommit} />
      </span>
    );
  }
  const { first, rest } = firstSentence(p.text);
  return (
    <div data-b="more">
      <button type="button" className="b-more-edit" title={p.editLabel} onClick={() => setEditing(true)}>
        {first}
        <span className="b-sr"> · {p.editLabel}</span>
      </button>
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
 * Il testo di una nota appena aggiunta (P53): il cursore è dentro. Lasciata, `onDone` riceve il testo, o null se è
 * rimasta vuota (non nasce niente, P55).
 */
export function DraftText(p: { label: string; placeholder?: string; maxLength: number; onDone(text: string | null): void }): JSX.Element {
  const [text, setText] = useState("");
  const area = useAutoHeight(text);
  return (
    <textarea
      ref={area}
      rows={1}
      className="b-textin"
      value={text}
      aria-label={p.label}
      placeholder={p.placeholder}
      maxLength={p.maxLength}
      autoFocus
      spellCheck
      onChange={(event) => setText(event.target.value)}
      onBlur={() => p.onDone(settledText(text, true) || null)}
      // La nota nuova sparisce quando nasce: Escape e Cmd/Ctrl+Invio portano il fuoco al drawer, e lei nasce lasciandolo.
      onKeyDown={(event) => leaveFieldKey(event, { enter: "modified", stays: false, commit: () => {} })}
      data-b="draft"
    />
  );
}

/**
 * Un punto di analisi appena aggiunto: il titolo (con il cursore dentro) e il testo. Nasce quando la persona lascia il
 * punto, se il testo c'è; senza testo non nasce niente (P55).
 */
export function DraftPoint(p: { titleLabel: string; titlePlaceholder: string; textLabel: string; textPlaceholder: string; titleMax: number; textMax: number; onDone(point: { title: string; text: string } | null): void }): JSX.Element {
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const titleArea = useAutoHeight(title);
  const textArea = useAutoHeight(text);
  const leave = (event: FocusEvent<HTMLDivElement>) => {
    // Il fuoco passa dal titolo al testo: il punto non è ancora lasciato.
    if (event.relatedTarget instanceof Node && event.currentTarget.contains(event.relatedTarget)) return;
    const body = settledText(text, true);
    p.onDone(body ? { title: settledText(title, false), text: body } : null);
  };
  return (
    <div className="b-point b-point-draft" onBlur={leave} data-b="draft-point">
      <b>
        <textarea
          ref={titleArea}
          rows={1}
          className="b-textin b-line"
          value={title}
          aria-label={p.titleLabel}
          placeholder={p.titlePlaceholder}
          maxLength={p.titleMax}
          autoFocus
          onChange={(event) => setTitle(event.target.value.replace(/[\r\n]+/g, " "))}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.nativeEvent.isComposing) {
              event.preventDefault();
              textArea.current?.focus();
            } else leaveFieldKey(event, { enter: "never", stays: false, commit: () => {} });
          }}
        />
      </b>
      <textarea
        ref={textArea}
        rows={1}
        className="b-textin"
        value={text}
        aria-label={p.textLabel}
        placeholder={p.textPlaceholder}
        maxLength={p.textMax}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => leaveFieldKey(event, { enter: "modified", stays: false, commit: () => {} })}
      />
    </div>
  );
}
