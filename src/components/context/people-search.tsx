"use client";

import { useRef, useState, useTransition, type ReactNode } from "react";
import { FileText } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { erasePersonAction, searchPersonAction } from "@/lib/actions/context-people";
import { dayLabel } from "@/lib/context/labels";
import { personTerm, type PersonSnippet } from "@/lib/context/people";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { CONTEXT_LIMITS } from "@/lib/context/vocab";
import type { PersonHits } from "@/lib/db/queries/context-people";
import { ContextSheet } from "./context-sheet";
import { Field } from "./fields";

const T = CONTEXT_TEXT;
const P = CONTEXT_TEXT.people;

/** Quanto toglie «Togli … da tutto»: tutto tranne i documenti, che restano e si tolgono uno per uno. */
export function erasableCount(hits: PersonHits): number {
  return hits.notes.total + hits.facts.total + hits.items.total + hits.map.total + hits.granola.total + hits.chat.total;
}

/**
 * Per quanto «Togli», nella conferma appena aperta, non vale: il secondo clic di un doppio clic su «Togli … da tutto» non
 * toglie niente.
 */
export const CONFIRM_GUARD_MS = 600;

/** Vero se «Togli» vale: la conferma è aperta da almeno `CONFIRM_GUARD_MS` (i tempi in millisecondi, come `performance.now()`). */
export function confirmReady(openedAt: number, now: number): boolean {
  return now - openedAt >= CONFIRM_GUARD_MS;
}

/** I numeri della conferma, dalla stessa ricerca: gli appunti che perdono il testo e i testi corretti, come dirà «Fatto: …». */
export function eraseNumbers(hits: PersonHits): { notes: number; texts: number } {
  return { notes: hits.notes.total, texts: hits.facts.total + hits.items.total };
}

/**
 * «Cerca una persona» nella vista «Appunti», per Lateral Space (rilascio 9b, docs/contesto/RILASCIO-9b-COSTRUZIONE.md
 * §2.13): un link che apre il pannello (a tutto schermo sul telefono). Nel pannello il campo «Nome o e-mail» con il
 * pulsante pieno «Cerca», i risultati a gruppi con il numero, e in fondo, non pieno, «Togli «…» da tutto», che chiede
 * conferma. «Apri» su un documento chiude il pannello e apre quello della fonte, dove c'è «Togli»; riaperto, il pannello
 * rifà la ricerca. I risultati valgono per il nome cercato: se il campo cambia, spariscono. Il nome non va mai in un
 * indirizzo: viaggia nel corpo delle azioni.
 */
export function PeopleSearch({ workspaceId, today, onOpenSource }: { workspaceId: string; today: string; onOpenSource: (sourceId: string) => void }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [hits, setHits] = useState<PersonHits | null>(null);
  const [asking, setAsking] = useState(false);
  const [searching, startSearch] = useTransition();
  const [erasing, startErase] = useTransition();
  // L'ultima ricerca partita: una risposta di una ricerca vecchia (o di prima di un cambio nel campo) non si mostra.
  const latest = useRef(0);

  const search = (raw: string) => {
    const checked = personTerm(raw);
    latest.current += 1;
    const id = latest.current;
    setAsking(false);
    if (!checked.ok) {
      setHits(null);
      setError(checked.message);
      return;
    }
    setError(null);
    startSearch(async () => {
      const result = await searchPersonAction(workspaceId, checked.term);
      if (id !== latest.current) return;
      if (result.ok) setHits(result.value);
      else {
        setHits(null);
        setError(result.message);
      }
    });
  };

  const erase = () => {
    if (!hits) return;
    const term = hits.term;
    startErase(async () => {
      const result = await erasePersonAction(workspaceId, term);
      setAsking(false);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(P.erased(result.value.notes, result.value.texts));
      // Quello che resta: i documenti, da togliere uno per uno.
      search(term);
    });
  };

  const openPanel = () => {
    setOpen(true);
    if (hits) search(hits.term);
  };
  const openDocument = (sourceId: string) => {
    setOpen(false);
    setAsking(false);
    onOpenSource(sourceId);
  };

  const busy = searching || erasing;
  return (
    <>
      <Button type="button" variant="link" className="min-h-11 px-0 sm:min-h-8" onClick={openPanel}>
        {P.link}
      </Button>
      <ContextSheet
        open={open}
        onOpenChange={(next) => {
          setOpen(next);
          if (!next) setAsking(false);
        }}
        title={P.title}
        description={P.lead}
        footer={
          hits && erasableCount(hits) > 0 ? (
            <EraseFooter
              term={hits.term}
              {...eraseNumbers(hits)}
              inClientName={hits.inClientName}
              asking={asking}
              busy={busy}
              onAsk={() => setAsking(true)}
              onCancel={() => setAsking(false)}
              onConfirm={erase}
            />
          ) : undefined
        }
      >
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            if (!busy) search(value);
          }}
        >
          <Field id="persona-cercata" label={P.label} error={error}>
            <div className="flex flex-col gap-2 sm:flex-row">
              <Input
                id="persona-cercata"
                value={value}
                maxLength={CONTEXT_LIMITS.personTermMax}
                autoComplete="off"
                spellCheck={false}
                placeholder={P.placeholder}
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "persona-cercata-errore" : undefined}
                className="min-h-11 sm:min-h-8"
                onChange={(event) => {
                  setValue(event.target.value);
                  setError(null);
                  // I risultati sono di un altro nome: «Togli» non deve poter togliere quello.
                  latest.current += 1;
                  setHits(null);
                  setAsking(false);
                }}
              />
              <Button type="submit" className="min-h-11 shrink-0 px-4 sm:min-h-8" disabled={busy}>
                {searching ? P.searching : P.search}
              </Button>
            </div>
          </Field>
        </form>
        {hits ? <PeopleResults hits={hits} today={today} onOpenDocument={openDocument} /> : null}
      </ContextSheet>
    </>
  );
}

/** Il nome trovato dentro il suo pezzo di testo, evidenziato con i colori del tema. */
function Snippet({ snippet }: { snippet: PersonSnippet }) {
  return (
    <p className="text-sm break-words">
      {snippet.before}
      <mark className="rounded-sm bg-primary/15 px-0.5 font-medium text-foreground">{snippet.match}</mark>
      {snippet.after}
    </p>
  );
}

/** Un gruppo dei risultati: il nome e il numero, poi le righe (se il gruppo ne ha). */
function Group({ label, total, children }: { label: string; total: number; children?: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="flex items-baseline justify-between gap-3 text-sm font-medium">
        <span>{label}</span>
        <span className="tabular-nums text-muted-foreground">{total}</span>
      </h3>
      {children}
    </section>
  );
}

/**
 * I risultati, a gruppi e nell'ordine del piano («Mappa» dopo le citazioni e le proposte); un gruppo vuoto non c'è. Appunti e fatti con al massimo 5 righe e il
 * nome evidenziato; i documenti con il nome del file e «Apri» (un documento di prima della 9a non ha un pannello); gli
 * altri gruppi solo con il numero.
 */
export function PeopleResults({ hits, today, onOpenDocument }: { hits: PersonHits; today: string; onOpenDocument: (sourceId: string) => void }) {
  if (erasableCount(hits) + hits.documents.total === 0) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {P.none}
      </p>
    );
  }
  return (
    <div className="space-y-5">
      {hits.notes.total > 0 ? (
        <Group label={P.groups.notes} total={hits.notes.total}>
          <ul className="divide-y rounded-lg border">
            {hits.notes.rows.map((row) => (
              <li key={row.id} className="space-y-1 px-3 py-2.5">
                <p className="flex flex-wrap items-baseline justify-between gap-x-3 text-sm">
                  <span className="min-w-0 font-medium break-words">{row.title}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">{dayLabel(row.occurredOn, today)}</span>
                </p>
                {row.snippet ? <Snippet snippet={row.snippet} /> : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      {hits.facts.total > 0 ? (
        <Group label={P.groups.facts} total={hits.facts.total}>
          <ul className="divide-y rounded-lg border">
            {hits.facts.rows.map((row) => (
              <li key={row.id} className="space-y-1 px-3 py-2.5">
                {row.snippet ? <Snippet snippet={row.snippet} /> : <p className="text-sm break-words">{row.statement}</p>}
                {row.history ? <p className="text-xs text-muted-foreground">{T.fact.history}</p> : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      {hits.items.total > 0 ? <Group label={P.groups.items} total={hits.items.total} /> : null}
      {hits.map.total > 0 ? <Group label={P.groups.map} total={hits.map.total} /> : null}
      {hits.documents.total > 0 ? (
        <Group label={P.groups.documents} total={hits.documents.total}>
          <p className="text-xs text-muted-foreground">{P.documentHint}</p>
          <ul className="divide-y rounded-lg border">
            {hits.documents.rows.map((row, index) => (
              <li key={`${row.sourceId ?? "senza-fonte"}-${index}`} className="flex min-h-11 items-center gap-3 px-3 py-1.5">
                <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 text-sm break-words">{row.fileName}</span>
                {row.sourceId ? (
                  <Button type="button" variant="outline" className="min-h-11 shrink-0 sm:min-h-8" onClick={() => onOpenDocument(row.sourceId!)}>
                    {P.open}
                  </Button>
                ) : null}
              </li>
            ))}
          </ul>
        </Group>
      ) : null}
      {hits.granola.total > 0 ? <Group label={P.groups.granola} total={hits.granola.total} /> : null}
      {hits.chat.total > 0 ? <Group label={P.groups.chat} total={hits.chat.total} /> : null}
    </div>
  );
}

/**
 * Il piede del pannello: «Togli «…» da tutto», non pieno; poi la conferma con i testi del piano e i numeri della stessa
 * ricerca, «Togli», distruttivo ma non pieno, e «Annulla», con il fuoco. «Annulla» sta dove era il primo pulsante, in
 * basso sul telefono e a destra sullo schermo largo, e per `CONFIRM_GUARD_MS` «Togli» non vale: un doppio clic non
 * toglie niente. Il nome del cliente, o un dominio, non si toglie (`inClientName`): al posto del pulsante la frase che
 * chiede nome e cognome, oppure l'e-mail.
 */
export function EraseFooter({
  term,
  notes,
  texts,
  inClientName,
  asking,
  busy,
  onAsk,
  onCancel,
  onConfirm,
}: {
  term: string;
  notes: number;
  texts: number;
  inClientName: boolean;
  asking: boolean;
  busy: boolean;
  onAsk: () => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  // Quando si è aperta la conferma: prima di `CONFIRM_GUARD_MS` «Togli» non vale.
  const openedAt = useRef(0);
  if (inClientName) {
    return (
      <p role="status" className="text-sm text-muted-foreground">
        {P.inClientName}
      </p>
    );
  }
  if (!asking) {
    return (
      <Button
        type="button"
        variant="outline"
        className="h-auto min-h-11 w-full py-2 whitespace-normal break-words sm:min-h-8 sm:w-auto sm:self-end"
        disabled={busy}
        onClick={() => {
          openedAt.current = performance.now();
          onAsk();
        }}
      >
        {P.erase(term)}
      </Button>
    );
  }
  return (
    <div role="group" aria-labelledby="persona-togli-titolo" aria-describedby="persona-togli-testo" className="space-y-3">
      <p id="persona-togli-titolo" className="text-sm font-medium break-words">
        {P.eraseTitle(term)}
      </p>
      <div id="persona-togli-testo" className="space-y-1 text-sm">
        {notes + texts > 0 ? <p>{P.eraseCount(notes, texts)}</p> : null}
        <p className="text-muted-foreground">{P.eraseBody}</p>
      </div>
      {/* «Togli» prima, «Annulla» ultimo: sotto sul telefono, a destra sullo schermo largo, dove era «Togli … da tutto». */}
      <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
        <Button
          type="button"
          variant="destructive"
          className="min-h-11 sm:min-h-8"
          disabled={busy}
          onClick={() => {
            if (confirmReady(openedAt.current, performance.now())) onConfirm();
          }}
        >
          {P.eraseConfirm}
        </Button>
        <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy} onClick={onCancel} autoFocus>
          {P.cancel}
        </Button>
      </div>
    </div>
  );
}
