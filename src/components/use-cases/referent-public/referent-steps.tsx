"use client";

import { useCallback, useEffect, useId, useImperativeHandle, useRef, useState, type Ref } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "@/components/uc/referente/inputs/fields";
import { Notice } from "@/components/uc/referente/screen";
import { cn } from "@/lib/utils";
import type { BenefitBody, CheckBody, ReferentBenefitView, ReferentCheckView } from "@/lib/use-cases/referent/contract";
import { REFERENT_CHECK_LIMITS } from "@/lib/db/use-case-hub-referent-check-ddl";
import { REFERENT_BENEFIT_LIMITS } from "@/lib/db/use-case-hub-referent-benefits-ddl";
import { benefitAnswered, benefitChoices, benefitQuestion } from "@/lib/use-cases/referent/impact-text";
import { REFERENT_CHECK_TEXT, REFERENT_IMPACT_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { benefitDone, numberField, numberText, placeholderOf, stepLabel, type CheckStep } from "./steps-state";

/**
 * (Rilascio 5, SPEC §7.1–§7.4) I passi di una richiesta al referente: la barra dei passi, «Lo use case»
 * («È così?», la descrizione, «Sì, è così» / «Correggi» con «Cosa cambieresti?») e, (rilascio 5.1),
 * «L'impatto»: una riga per ogni voce di «Benefici e costi» con un tocco («Sì» / «È di meno» / «È di più»
 * con i numeri facoltativi, o «Sì» / «No» / «Non so», o i due numeri quando il team non li ha) e un
 * commento facoltativo; senza modello del valore le due domande del tempo. Un solo pulsante pieno per
 * passo: il passo dopo. Le scelte sono pulsanti a levetta (`aria-pressed`) in un gruppo con il suo nome.
 * I testi vengono da labels.ts.
 */

const T = REFERENT_CHECK_TEXT;
const I = REFERENT_IMPACT_TEXT;
export const stepTitleId = (step: CheckStep) => `ucq-passo-${step}-titolo`;
const CHOICE_CLASS = "min-h-11 h-auto w-full py-2.5 text-base whitespace-normal sm:w-auto";
const AUTOSAVE_MS = 1500;

/** La barra dei passi: cerchio e nome, lo stato si legge anche senza colore; non si clicca. */
export function ReferentStepBar({ items }: { items: { step: CheckStep; state: "done" | "current" | "later" }[] }) {
  return (
    <ol aria-label={T.steps.label} data-slot="referent-steps" className={cn("mt-6 grid gap-2", items.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {items.map((item, index) => {
        const label = stepLabel(item.step, item.state);
        return (
          <li key={item.step} data-state={item.state} aria-current={item.state === "current" ? "step" : undefined} className="flex min-w-0 items-start gap-2">
            <span
              aria-hidden
              className={cn(
                "flex size-6 shrink-0 items-center justify-center rounded-full text-xs tabular-nums",
                item.state === "done" && "bg-foreground text-background",
                item.state === "current" && "border-2 border-foreground font-medium",
                item.state === "later" && "border border-input text-muted-foreground",
              )}
            >
              {item.state === "done" ? <Check className="size-3.5" /> : index + 1}
            </span>
            <span className={cn("min-w-0 pt-1 text-sm break-words", item.state === "current" ? "font-medium" : "text-muted-foreground")}>
              {label.text}
              <span className="sr-only">{label.suffix}</span>
            </span>
          </li>
        );
      })}
    </ol>
  );
}

/** Il titolo di un passo: riceve il fuoco all'arrivo, con l'anello visibile da tastiera. */
function StepTitle({ step, children }: { step: CheckStep; children: React.ReactNode }) {
  return (
    <h2 id={stepTitleId(step)} tabIndex={-1} className="rounded-md text-xl leading-snug font-semibold break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
      {children}
    </h2>
  );
}

/** Un pulsante a levetta di una scelta. */
function Choice({ pressed, filled, onClick, children, busy }: { pressed: boolean; filled: boolean; onClick: (e: React.MouseEvent<HTMLButtonElement>) => void; children: React.ReactNode; busy?: boolean }) {
  return (
    <Button type="button" variant={filled ? "default" : "outline"} aria-pressed={pressed} aria-busy={busy || undefined} className={cn(CHOICE_CLASS, pressed && !filled && "border-foreground")} onClick={onClick}>
      {busy ? <Loader2 className="animate-spin" aria-hidden /> : null}
      {children}
    </Button>
  );
}

export interface StepActions {
  /** Salva una bozza del passo: true se il server l'ha salvata. `keepalive`: chi chiude la pagina. */
  save: (body: CheckBody, keepalive?: boolean) => Promise<boolean>;
  /** Il passo dopo (o l'invio, sull'ultimo passo): `e` per il controllo del doppio clic. */
  next: (e: React.MouseEvent<HTMLButtonElement> | null) => void;
  /** È un doppio clic o un clic troppo vicino al cambio di passo. */
  tooSoon: (e: React.MouseEvent<HTMLButtonElement>) => boolean;
  /** Aggiorna subito la bozza mostrata. */
  setDraft: (patch: Partial<ReferentCheckView["draft"]>) => void;
  /** (Rilascio 5.1) Aggiorna subito la bozza mostrata di una riga dell'impatto. */
  setBenefit?: (key: string, draft: NonNullable<ReferentBenefitView["draft"]>) => void;
}

// ─── Passo 1 «Lo use case» ───────────────────────────────────────────

export function ConfirmStep({
  check,
  title,
  actions,
  errorFromServer,
  warningFromServer = null,
}: {
  check: ReferentCheckView;
  title: string;
  actions: StepActions;
  errorFromServer: string | null;
  /** L'avviso del server sull'ultima bozza della nota (un codice fiscale, una data di nascita), come sotto le domande. */
  warningFromServer?: string | null;
}) {
  const id = useId();
  const noteId = `${id}-nota`;
  const errId = `${id}-errore`;
  const warnId = `${id}-avviso`;
  const fixing = check.draft.confirm === "correggi";
  const [note, setNote] = useState(check.draft.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const lastSaved = useRef(check.draft.note ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownError = error ?? errorFromServer;
  // L'avviso non si ripete sotto l'errore che dice la stessa cosa (dopo «Invia»).
  const shownWarning = warningFromServer && warningFromServer !== shownError ? warningFromServer : null;

  const saveNote = async (text: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (text.trim() === lastSaved.current.trim()) return true;
    const ok = await actions.save({ step: 1, confirm: "correggi", note: text });
    if (ok) lastSaved.current = text;
    return ok;
  };

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  // Chi chiude la pagina con la nota non ancora salvata: un ultimo salvataggio che sopravvive alla chiusura.
  const noteText = useRef(note);
  useEffect(() => {
    noteText.current = note;
  }, [note]);
  useEffect(() => {
    const onHide = () => {
      if (check.draft.confirm !== "correggi") return;
      const text = noteText.current;
      if (text.trim() !== lastSaved.current.trim()) void actions.save({ step: 1, confirm: "correggi", note: text }, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [actions, check.draft.confirm]);

  const onYes = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (actions.tooSoon(e)) return;
    setError(null);
    actions.setDraft({ confirm: "si", note: null });
    void actions.save({ step: 1, confirm: "si", note: null });
    actions.next(e);
  };
  const onFix = (e: React.MouseEvent<HTMLButtonElement>) => {
    // Il secondo clic di un doppio clic su «Indietro» del passo 2 arriva qui: niente «Correggi» per caso.
    if (actions.tooSoon(e)) return;
    setError(null);
    if (!fixing) {
      actions.setDraft({ confirm: "correggi", note: note || null });
      void actions.save({ step: 1, confirm: "correggi", note: note || null });
    }
    requestAnimationFrame(() => noteRef.current?.focus());
  };
  const onNext = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (actions.tooSoon(e)) return;
    if (note.trim().length < 2) {
      setError(T.confirm.noteMissing);
      noteRef.current?.focus();
      return;
    }
    actions.setDraft({ confirm: "correggi", note });
    if (await saveNote(note)) actions.next(null);
  };

  return (
    <section aria-labelledby={stepTitleId(1)} className="mt-6 space-y-4" data-slot="referent-step-1">
      <StepTitle step={1}>{T.confirm.title}</StepTitle>
      <blockquote className="rounded-xl bg-muted/50 px-4 py-3 text-base leading-7 break-words whitespace-pre-line">{check.description ?? title}</blockquote>
      <div role="group" aria-label={T.confirm.group} className="flex flex-col gap-3 sm:flex-row">
        <Choice pressed={check.draft.confirm === "si"} filled={!fixing} onClick={onYes}>
          {T.confirm.yes}
        </Choice>
        <Choice pressed={fixing} filled={false} onClick={onFix}>
          {T.confirm.fix}
        </Choice>
      </div>
      {fixing ? (
        <div className="space-y-1.5">
          <label htmlFor={noteId} className="block text-base font-medium">
            {T.confirm.noteLabel}
          </label>
          <textarea
            ref={noteRef}
            id={noteId}
            rows={3}
            maxLength={REFERENT_CHECK_LIMITS.noteMax}
            value={note}
            placeholder={T.confirm.notePlaceholder}
            aria-invalid={shownError ? true : undefined}
            aria-describedby={[shownError ? errId : null, shownWarning ? warnId : null].filter(Boolean).join(" ") || undefined}
            onChange={(e) => {
              const text = e.target.value;
              setNote(text);
              setError(null);
              if (timer.current) clearTimeout(timer.current);
              timer.current = setTimeout(() => void saveNote(text), AUTOSAVE_MS);
            }}
            onBlur={() => void saveNote(note)}
            className={TEXTAREA_CLASS}
          />
          {shownError ? (
            <p id={errId} role="alert" className="text-sm break-words text-uc-rosso">
              {shownError}
            </p>
          ) : null}
          {shownWarning ? (
            <p id={warnId} className="rounded-lg bg-uc-giallo-bg px-3 py-2 text-sm break-words">
              {shownWarning}
            </p>
          ) : null}
          <div className="pt-2">
            <Button type="button" className="h-12 w-full text-base sm:w-auto sm:min-w-48" onClick={(e) => void onNext(e)}>
              {T.next}
            </Button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

// ─── Passo 2 senza modello del valore: le due domande del tempo ─────

/**
 * (Rilascio 5) Il passo 2 quando lo use case non ha un modello del valore: «Quanto tempo vi prende questo
 * lavoro?» con i due numeri, tutti e due necessari («Basta una stima.»).
 */
export function EstimateStep({
  check,
  last,
  sending,
  staleNotice,
  actions,
  onBack,
  errorFromServer,
}: {
  check: ReferentCheckView;
  /** Senza domande è l'ultimo passo: il pulsante pieno è «Invia». */
  last: boolean;
  sending: boolean;
  staleNotice: boolean;
  actions: StepActions;
  onBack: () => void;
  errorFromServer: string | null;
}) {
  const id = useId();
  const draft = check.draft;
  const [times, setTimes] = useState(numberText(draft.timesPerMonth));
  const [minutes, setMinutes] = useState(numberText(draft.minutesEach));
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timesRef = useRef<HTMLInputElement>(null);
  const shownError = error ?? errorFromServer;
  const errId = `${id}-errore`;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /** I due campi come numeri; null dove il campo non è valido. */
  const parsed = () => ({ t: numberField(times, "timesPerMonth"), m: numberField(minutes, "minutesEach") });
  const saveNumbers = async (t: string, m: string) => {
    const tt = numberField(t, "timesPerMonth");
    const mm = numberField(m, "minutesEach");
    if (!tt.ok || !mm.ok) return false;
    actions.setDraft({ estimate: null, timesPerMonth: tt.value, minutesEach: mm.value, stale: false });
    return actions.save({ step: 2, teamSeen: null, estimate: null, timesPerMonth: tt.value, minutesEach: mm.value });
  };
  const schedule = (t: string, m: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveNumbers(t, m);
    }, AUTOSAVE_MS);
  };

  // Chi chiude la pagina con un numero non ancora salvato: un ultimo salvataggio che sopravvive alla chiusura.
  const pendingRef = useRef({ times, minutes });
  useEffect(() => {
    pendingRef.current = { times, minutes };
  }, [times, minutes]);
  useEffect(() => {
    const onHide = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      const tt = numberField(pendingRef.current.times, "timesPerMonth");
      const mm = numberField(pendingRef.current.minutes, "minutesEach");
      if (!tt.ok || !mm.ok) return;
      void actions.save({ step: 2, teamSeen: null, estimate: null, timesPerMonth: tt.value, minutesEach: mm.value }, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [actions]);

  const onPrimary = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (actions.tooSoon(e)) return;
    const p = parsed();
    if (!p.t.ok || !p.m.ok) {
      setError(T.estimate.invalid);
      timesRef.current?.focus();
      return;
    }
    if (p.t.value === null || p.m.value === null) {
      setError(T.estimate.noTeamMissing);
      timesRef.current?.focus();
      return;
    }
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    actions.setDraft({ estimate: null, timesPerMonth: p.t.value, minutesEach: p.m.value, stale: false });
    const ok = await actions.save({ step: 2, teamSeen: null, estimate: null, timesPerMonth: p.t.value, minutesEach: p.m.value });
    if (ok) actions.next(null);
  };

  const field = (which: "times" | "minutes") => {
    const isTimes = which === "times";
    const inputId = `${id}-${which}`;
    return (
      <NumberField
        id={inputId}
        inputRef={isTimes ? timesRef : undefined}
        label={isTimes ? T.estimate.noTeamTimes : T.estimate.noTeamMinutes}
        value={isTimes ? times : minutes}
        placeholder=""
        invalid={shownError === T.estimate.invalid}
        describedBy={shownError ? errId : undefined}
        onChange={(text) => {
          setError(null);
          if (isTimes) setTimes(text);
          else setMinutes(text);
          schedule(isTimes ? text : times, isTimes ? minutes : text);
        }}
        onBlur={() => {
          if (timer.current) clearTimeout(timer.current);
          void saveNumbers(times, minutes);
        }}
      />
    );
  };

  return (
    <section aria-labelledby={stepTitleId(2)} className="mt-6 space-y-4" data-slot="referent-step-2">
      {staleNotice || draft.stale ? <Notice tone="attenzione">{T.estimate.stale}</Notice> : null}
      <StepTitle step={2}>{T.estimate.noTeamTitle}</StepTitle>
      <p className="text-base text-muted-foreground">{T.estimate.noTeamHint}</p>
      <div className="flex flex-col gap-3 min-[400px]:flex-row">
        {field("times")}
        {field("minutes")}
      </div>
      {shownError ? (
        <p id={errId} role="alert" className="text-sm break-words text-uc-rosso">
          {shownError}
        </p>
      ) : null}
      <StepFooter last={last} sending={sending} actions={actions} onBack={onBack} onPrimary={(e) => void onPrimary(e)} />
    </section>
  );
}

/** Un campo numerico del passo 2: testo con la virgola, tastiera numerica sul telefono. */
function NumberField({
  id,
  label,
  value,
  placeholder,
  invalid,
  describedBy,
  onChange,
  onBlur,
  inputRef,
}: {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  invalid: boolean;
  describedBy: string | undefined;
  onChange: (text: string) => void;
  onBlur: () => void;
  inputRef?: Ref<HTMLInputElement>;
}) {
  return (
    <div className="min-w-0 flex-1 space-y-1.5">
      <label htmlFor={id} className="block text-base font-medium">
        {label}
      </label>
      <input
        ref={inputRef}
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        value={value}
        placeholder={placeholder}
        aria-invalid={invalid ? true : undefined}
        aria-describedby={describedBy}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        className={CONTROL_CLASS}
      />
    </div>
  );
}

/** «Indietro» e il pulsante pieno del passo 2 («Avanti», o «Invia» senza domande). */
function StepFooter({ last, sending, actions, onBack, onPrimary }: { last: boolean; sending: boolean; actions: StepActions; onBack: () => void; onPrimary: (e: React.MouseEvent<HTMLButtonElement>) => void }) {
  return (
    <div className="flex flex-col-reverse gap-3 pt-2 sm:flex-row sm:items-center">
      <Button
        type="button"
        variant="ghost"
        className="min-h-11 h-auto px-3 text-base"
        onClick={(e) => {
          if (!actions.tooSoon(e)) onBack();
        }}
      >
        {T.back}
      </Button>
      <Button type="button" className="h-12 w-full text-base sm:w-auto sm:min-w-48" aria-busy={sending || undefined} onClick={onPrimary}>
        {sending ? <Loader2 className="animate-spin" aria-hidden /> : null}
        {last ? T.send : T.next}
      </Button>
    </div>
  );
}

// ─── Passo 2 «L'impatto» (rilascio 5.1) ──────────────────────────────

/** Il titolo di una riga dell'impatto: riceve il fuoco quando «Avanti» la trova senza risposta. */
export const benefitTitleId = (key: string) => `ucq-beneficio-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
/** Il commento di una riga: riceve il fuoco quando «Invia» lo rifiuta (un codice fiscale, una data di nascita). */
export const benefitCommentId = (key: string) => `${benefitTitleId(key)}-commento`;

type BenefitDraftView = NonNullable<ReferentBenefitView["draft"]>;
interface RowState {
  answer: BenefitDraftView["answer"];
  times: string;
  minutes: string;
  euro: string;
  comment: string;
}
interface RowHandle {
  /** Salva quello che resta da salvare; `saved` falso con un numero non valido o un salvataggio fallito. */
  flush: () => Promise<{ saved: boolean; done: boolean }>;
}

/** La risposta di una riga com'è adesso, per la bozza mostrata e per il server; null con un numero non valido. */
function rowDraftOf(row: ReferentBenefitView, s: RowState): BenefitDraftView | null {
  const t = numberField(s.times, "timesPerMonth");
  const m = numberField(s.minutes, "minutesEach");
  const e = numberField(s.euro, "eurYear");
  if (!t.ok || !m.ok || !e.ok) return null;
  const different = s.answer === "meno" || s.answer === "piu";
  const comment = s.comment.trim() ? s.comment : null;
  if (row.form === "ore_numeri") return { answer: null, timesPerMonth: t.value, minutesEach: m.value, eurYear: null, comment, stale: false };
  if (row.form === "ore") return { answer: s.answer, timesPerMonth: different ? t.value : null, minutesEach: different ? m.value : null, eurYear: null, comment, stale: false };
  if (row.form === "euro") return { answer: s.answer, timesPerMonth: null, minutesEach: null, eurYear: different ? e.value : null, comment, stale: false };
  return { answer: s.answer, timesPerMonth: null, minutesEach: null, eurYear: null, comment, stale: false };
}

function bodyOf(row: ReferentBenefitView, d: BenefitDraftView): BenefitBody {
  return { key: row.key, seen: row.team, answer: d.answer, timesPerMonth: d.timesPerMonth, minutesEach: d.minutesEach, eurYear: d.eurYear, comment: d.comment };
}

/** Una riga del passo «L'impatto»: la domanda, un tocco, i numeri facoltativi, il commento. */
function BenefitRow({
  row,
  actions,
  missing,
  onEdit,
  handleRef,
  commentError = null,
  commentWarning = null,
}: {
  row: ReferentBenefitView;
  actions: StepActions;
  missing: boolean;
  onEdit: (key: string) => void;
  handleRef: Ref<RowHandle>;
  /** (Rilascio 5.1) «Invia» rifiutato per il commento di questa riga: il messaggio, sotto il commento. */
  commentError?: string | null;
  /** (Rilascio 5.1) L'avviso dell'ultima bozza di questa riga, sotto il commento. */
  commentWarning?: string | null;
}) {
  const id = useId();
  const titleId = benefitTitleId(row.key);
  const errId = `${id}-errore`;
  const fresh = row.draft && !row.draft.stale ? row.draft : null;
  const [state, setState] = useState<RowState>(() => ({
    answer: fresh?.answer ?? null,
    times: numberText(fresh?.timesPerMonth ?? null),
    minutes: numberText(fresh?.minutesEach ?? null),
    euro: numberText(fresh?.eurYear ?? null),
    comment: row.draft?.comment ?? "",
  }));
  const [commentOpen, setCommentOpen] = useState(Boolean(row.draft?.comment));
  const [error, setError] = useState<string | null>(null);
  const stateRef = useRef(state);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chain = useRef<Promise<boolean>>(Promise.resolve(true));
  const lastSaved = useRef<string>(JSON.stringify(rowDraftOf(row, state)));
  const firstNumber = useRef<HTMLInputElement>(null);
  const commentRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /** Un salvataggio alla volta per riga, nell'ordine; uno uguale all'ultimo non parte. */
  const save = useCallback(
    (d: BenefitDraftView, keepalive = false): Promise<boolean> => {
      const run = chain.current.then(async () => {
        const key = JSON.stringify(d);
        if (key === lastSaved.current) return true;
        const ok = await actions.save({ step: 2, benefit: bodyOf(row, d) }, keepalive);
        if (ok) lastSaved.current = key;
        return ok;
      });
      chain.current = run.catch(() => false);
      return run;
    },
    [actions, row],
  );

  /** La bozza di adesso: mostrata subito, salvata subito (o dopo `AUTOSAVE_MS` mentre si scrive). */
  const commit = (next: RowState, delay: "subito" | "dopo") => {
    setState(next);
    stateRef.current = next;
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    const d = rowDraftOf(row, next);
    if (!d) return;
    actions.setBenefit?.(row.key, d);
    if (delay === "subito") void save(d);
    else
      timer.current = setTimeout(() => {
        timer.current = null;
        void save(d);
      }, AUTOSAVE_MS);
  };

  useImperativeHandle(
    handleRef,
    () => ({
      flush: async () => {
        if (timer.current) clearTimeout(timer.current);
        timer.current = null;
        const d = rowDraftOf(row, stateRef.current);
        if (!d) {
          setError(I.invalid);
          return { saved: false, done: false };
        }
        const saved = await save(d);
        return { saved, done: benefitAnswered(row.form, d) };
      },
    }),
    [row, save],
  );

  // Chi chiude la pagina mentre scrive: un ultimo salvataggio che sopravvive alla chiusura.
  useEffect(() => {
    const onHide = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      const d = rowDraftOf(row, stateRef.current);
      if (d) void save(d, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [row, save]);

  const pick = (answer: NonNullable<RowState["answer"]>, e: React.MouseEvent<HTMLButtonElement>) => {
    // Il secondo clic di un doppio clic (o un clic appena cambiato il passo) non sceglie niente.
    if (actions.tooSoon(e)) return;
    setError(null);
    onEdit(row.key);
    const base = rowDraftOf(row, stateRef.current) ? stateRef.current : { ...stateRef.current, times: "", minutes: "", euro: "" };
    commit({ ...base, answer }, "subito");
    if ((answer === "meno" || answer === "piu") && row.form !== "fatto") requestAnimationFrame(() => firstNumber.current?.focus());
  };

  const typed = (patch: Partial<RowState>) => {
    setError(null);
    onEdit(row.key);
    commit({ ...stateRef.current, ...patch }, "dopo");
  };
  const blurred = () => {
    const d = rowDraftOf(row, stateRef.current);
    if (!d) {
      setError(I.invalid);
      return;
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    void save(d);
  };

  const choices = benefitChoices(row.form);
  const different = state.answer === "meno" || state.answer === "piu";
  const showNumbers = row.form === "ore_numeri" || (row.form !== "fatto" && different);
  const current = rowDraftOf(row, state);
  const done = current !== null && benefitAnswered(row.form, current);
  const missingLine = row.form === "ore_numeri" ? I.numbersMissing : I.pick;
  const describedBy = error ? errId : undefined;
  const commentId = benefitCommentId(row.key);
  const commentNote = commentError ?? commentWarning;
  const commentNoteId = `${id}-commento-nota`;
  const numberPlaceholder = (n: number | null) => (n !== null && n > 0 ? placeholderOf(n) : "");

  return (
    <div
      role="group"
      aria-labelledby={titleId}
      data-slot="referent-benefit"
      data-benefit={row.key}
      data-form={row.form}
      data-done={done ? "true" : "false"}
      className={cn("space-y-3 rounded-xl border bg-card px-4 py-3", ((missing && !done) || commentError) && "ring-2 ring-uc-giallo")}
    >
      <p id={titleId} tabIndex={-1} className="rounded-md text-base leading-snug font-medium break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
        {benefitQuestion(row)}
      </p>
      {choices.length ? (
        <div className="grid grid-cols-3 gap-2 sm:flex sm:flex-wrap">
          {choices.map((c) => (
            <Choice key={c.answer} pressed={state.answer === c.answer} filled={false} onClick={(e) => pick(c.answer, e)}>
              {c.label}
            </Choice>
          ))}
        </div>
      ) : null}
      {showNumbers ? (
        <div className="space-y-2">
          {row.form !== "ore_numeri" ? <p className="text-sm text-muted-foreground">{row.form === "euro" ? I.euroLead : I.numbersLead}</p> : null}
          <div className="flex flex-col gap-3 min-[400px]:flex-row">
            {row.form === "euro" ? (
              <NumberField
                id={`${id}-euro`}
                inputRef={firstNumber}
                label={I.eurYear}
                value={state.euro}
                placeholder={numberPlaceholder(row.team.eurYear)}
                invalid={error === I.invalid}
                describedBy={describedBy}
                onChange={(text) => typed({ euro: text })}
                onBlur={blurred}
              />
            ) : (
              <>
                <NumberField
                  id={`${id}-volte`}
                  inputRef={firstNumber}
                  label={I.perMonth}
                  value={state.times}
                  placeholder={row.form === "ore" ? numberPlaceholder((row.team.volumeYear ?? 0) / 12) : ""}
                  invalid={error === I.invalid}
                  describedBy={describedBy}
                  onChange={(text) => typed({ times: text })}
                  onBlur={blurred}
                />
                <NumberField
                  id={`${id}-minuti`}
                  label={I.minutesEach}
                  value={state.minutes}
                  placeholder={row.form === "ore" ? numberPlaceholder(row.team.minutes) : ""}
                  invalid={error === I.invalid}
                  describedBy={describedBy}
                  onChange={(text) => typed({ minutes: text })}
                  onBlur={blurred}
                />
              </>
            )}
          </div>
        </div>
      ) : null}
      {error ? (
        <p id={errId} role="alert" className="text-sm break-words text-uc-rosso">
          {error}
        </p>
      ) : missing && !done ? (
        <p className="text-sm break-words">{missingLine}</p>
      ) : null}
      {commentOpen || commentNote ? (
        <div className="space-y-1.5">
          <label htmlFor={commentId} className="block text-sm font-medium">
            {I.commentLabel}
          </label>
          <textarea
            ref={commentRef}
            id={commentId}
            rows={2}
            maxLength={REFERENT_BENEFIT_LIMITS.comment}
            value={state.comment}
            placeholder={I.commentPlaceholder}
            onChange={(e) => typed({ comment: e.target.value })}
            onBlur={blurred}
            aria-invalid={commentError ? true : undefined}
            aria-describedby={commentNote ? commentNoteId : undefined}
            className={TEXTAREA_CLASS}
          />
          {commentNote ? (
            <p id={commentNoteId} role={commentError ? "alert" : undefined} className={cn("text-sm break-words", commentError ? "text-uc-rosso" : "text-muted-foreground")}>
              {commentNote}
            </p>
          ) : null}
        </div>
      ) : (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="min-h-11 h-auto px-2 text-sm text-muted-foreground sm:min-h-8"
          onClick={(e) => {
            if (actions.tooSoon(e)) return;
            setCommentOpen(true);
            requestAnimationFrame(() => commentRef.current?.focus());
          }}
        >
          {I.addComment}
        </Button>
      )}
    </div>
  );
}

/**
 * (Rilascio 5.1) Il passo «L'impatto»: «Cosa cambia, secondo il team» e una riga per ogni voce di
 * «Benefici e costi», nell'ordine del modello. «Avanti» (o «Invia» senza domande) salva prima ogni riga;
 * con una riga senza risposta lo dice con garbo, la evidenzia e ci porta il fuoco.
 */
export function ImpactStep({
  check,
  last,
  sending,
  staleNotice,
  actions,
  onBack,
  errorFromServer,
  missingFromServer,
  rowError = null,
  rowWarnings,
}: {
  check: ReferentCheckView;
  last: boolean;
  sending: boolean;
  staleNotice: boolean;
  actions: StepActions;
  onBack: () => void;
  errorFromServer: string | null;
  /** (Rilascio 5.1) Le righe senza risposta secondo «Invia» rifiutato (dopo aver riletto la vista). */
  missingFromServer?: readonly string[];
  /** (Rilascio 5.1) «Invia» rifiutato per il commento di una riga. */
  rowError?: { key: string; message: string } | null;
  /** (Rilascio 5.1) L'avviso dell'ultima bozza di ogni riga, per chiave. */
  rowWarnings?: Readonly<Record<string, string>>;
}) {
  const rows = check.benefits ?? [];
  const handles = useRef(new Map<string, RowHandle>());
  const [missing, setMissing] = useState<string[]>([]);
  // Un rifiuto nuovo di «Invia» evidenzia le sue righe, come «Avanti» (lo stato si adegua alla prop nel render).
  const [shownRefusal, setShownRefusal] = useState<readonly string[] | undefined>(undefined);
  if (missingFromServer !== shownRefusal) {
    setShownRefusal(missingFromServer);
    if (missingFromServer?.length) setMissing(missingFromServer.filter((key) => rows.some((row) => row.key === key)));
  }
  const [busy, setBusy] = useState(false);
  const anyStale = rows.some((row) => row.draft?.stale);
  const onEdit = useCallback((key: string) => setMissing((m) => (m.includes(key) ? m.filter((k) => k !== key) : m)), []);
  const refFor = useCallback(
    (key: string) => (handle: RowHandle | null) => {
      if (handle) handles.current.set(key, handle);
      else handles.current.delete(key);
    },
    [],
  );

  const onPrimary = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (actions.tooSoon(e) || busy) return;
    setBusy(true);
    const results = await Promise.all(rows.map(async (row) => [row.key, (await handles.current.get(row.key)?.flush()) ?? { saved: true, done: benefitDone(row) }] as const));
    setBusy(false);
    const failed = results.find(([, r]) => !r.saved);
    if (failed) {
      document.getElementById(benefitTitleId(failed[0]))?.focus();
      return;
    }
    const open = results.filter(([, r]) => !r.done).map(([key]) => key);
    setMissing(open);
    if (open.length) {
      const el = document.getElementById(benefitTitleId(open[0]));
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
      el?.scrollIntoView({ block: "center", behavior: reduce ? "auto" : "smooth" });
      el?.focus({ preventScroll: true });
      return;
    }
    actions.next(null);
  };

  return (
    <section aria-labelledby={stepTitleId(2)} className="mt-6 space-y-4" data-slot="referent-step-2" data-mode="benefici">
      {staleNotice || anyStale ? <Notice tone="attenzione">{I.stale}</Notice> : null}
      <StepTitle step={2}>{I.title}</StepTitle>
      <div className="space-y-3">
        {rows.map((row) => (
          <BenefitRow
            key={row.key}
            row={row}
            actions={actions}
            missing={missing.includes(row.key)}
            onEdit={onEdit}
            handleRef={refFor(row.key)}
            commentError={rowError?.key === row.key ? rowError.message : null}
            commentWarning={rowWarnings?.[row.key] ?? null}
          />
        ))}
      </div>
      {missing.length ? (
        <p role="alert" className="rounded-xl bg-uc-giallo-bg px-4 py-3 text-base break-words">
          {missing.length === 1 ? I.missingOne : fillText(I.missingMany, { n: missing.length })}
        </p>
      ) : null}
      {errorFromServer ? (
        <p role="alert" className="text-sm break-words text-uc-rosso">
          {errorFromServer}
        </p>
      ) : null}
      <StepFooter last={last} sending={sending || busy} actions={actions} onBack={onBack} onPrimary={(e) => void onPrimary(e)} />
    </section>
  );
}
