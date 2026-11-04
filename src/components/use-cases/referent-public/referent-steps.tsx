"use client";

import { useEffect, useId, useRef, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CONTROL_CLASS, TEXTAREA_CLASS } from "@/components/uc/referente/inputs/fields";
import { Notice } from "@/components/uc/referente/screen";
import { cn } from "@/lib/utils";
import type { CheckBody, ReferentCheckView } from "@/lib/use-cases/referent/contract";
import { REFERENT_CHECK_LIMITS } from "@/lib/db/use-case-hub-referent-check-ddl";
import { teamEstimateDetail, teamEstimateQuestion } from "@/lib/use-cases/referent/estimate";
import { REFERENT_CHECK_TEXT } from "@/lib/use-cases/referent/labels";
import { numberField, numberText, perMonthLabel, placeholderOf, stepLabel, type CheckStep } from "./steps-state";

/**
 * (Rilascio 5, SPEC §7.1–§7.4) I passi di una richiesta al referente: la barra dei passi, «Lo use case»
 * («È così?», la descrizione, «Sì, è così» / «Correggi» con «Cosa cambieresti?») e «Il tempo» (la stima
 * del team in ore di lavoro con «Sì» / «È di meno» / «È di più» e due numeri facoltativi, oppure le due
 * domande senza stima). Un solo pulsante pieno per passo: il passo dopo. Le scelte sono pulsanti a
 * levetta (`aria-pressed`) in un gruppo con il suo nome. I testi vengono da labels.ts.
 */

const T = REFERENT_CHECK_TEXT;
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
}

// ─── Passo 1 «Lo use case» ───────────────────────────────────────────

export function ConfirmStep({ check, title, actions, errorFromServer }: { check: ReferentCheckView; title: string; actions: StepActions; errorFromServer: string | null }) {
  const id = useId();
  const noteId = `${id}-nota`;
  const errId = `${id}-errore`;
  const fixing = check.draft.confirm === "correggi";
  const [note, setNote] = useState(check.draft.note ?? "");
  const [error, setError] = useState<string | null>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const lastSaved = useRef(check.draft.note ?? "");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shownError = error ?? errorFromServer;

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
            aria-describedby={shownError ? errId : undefined}
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

// ─── Passo 2 «Il tempo» ──────────────────────────────────────────────

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
  const team = check.team;
  const draft = check.draft;
  const [times, setTimes] = useState(numberText(draft.timesPerMonth));
  const [minutes, setMinutes] = useState(numberText(draft.minutesEach));
  const [error, setError] = useState<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const timesRef = useRef<HTMLInputElement>(null);
  const different = draft.estimate === "meno" || draft.estimate === "piu";
  const showNumbers = !team || different;
  const shownError = error ?? errorFromServer;
  const errId = `${id}-errore`;
  const teamSeen = team ? { key: team.key, volumeYear: team.volumeYear, minutes: team.minutes } : null;

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  /** I due campi come numeri; null dove il campo non è valido. */
  const parsed = () => ({ t: numberField(times, "timesPerMonth"), m: numberField(minutes, "minutesEach") });
  const saveNumbers = async (estimate: ReferentCheckView["draft"]["estimate"], t: string, m: string) => {
    const tt = numberField(t, "timesPerMonth");
    const mm = numberField(m, "minutesEach");
    if (!tt.ok || !mm.ok) return false;
    actions.setDraft({ estimate, timesPerMonth: tt.value, minutesEach: mm.value });
    return actions.save({ step: 2, teamSeen, estimate, timesPerMonth: tt.value, minutesEach: mm.value });
  };
  const schedule = (t: string, m: string) => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      void saveNumbers(team ? draft.estimate : null, t, m);
    }, AUTOSAVE_MS);
  };

  // Chi chiude la pagina con un numero non ancora salvato: un ultimo salvataggio che sopravvive alla chiusura.
  const pendingRef = useRef({ times, minutes, estimate: draft.estimate });
  useEffect(() => {
    pendingRef.current = { times, minutes, estimate: draft.estimate };
  }, [times, minutes, draft.estimate]);
  useEffect(() => {
    const onHide = () => {
      if (!timer.current) return;
      clearTimeout(timer.current);
      timer.current = null;
      const p = pendingRef.current;
      const tt = numberField(p.times, "timesPerMonth");
      const mm = numberField(p.minutes, "minutesEach");
      if (!tt.ok || !mm.ok) return;
      const estimate = team ? p.estimate : null;
      void actions.save({ step: 2, teamSeen: team ? { key: team.key, volumeYear: team.volumeYear, minutes: team.minutes } : null, estimate, timesPerMonth: tt.value, minutesEach: mm.value }, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [actions, team]);

  const pick = (estimate: "si" | "meno" | "piu", e: React.MouseEvent<HTMLButtonElement>) => {
    // Ogni scelta, non solo «Sì»: il secondo clic di un doppio clic su «Sì, è così» (o su «Indietro» del
    // passo 3) arriva qui sotto il dito, e non deve diventare un «È di più» che nessuno ha scelto.
    if (actions.tooSoon(e)) return;
    if (estimate === "si" && !last) {
      setError(null);
      actions.setDraft({ estimate: "si", timesPerMonth: null, minutesEach: null, stale: false });
      void actions.save({ step: 2, teamSeen, estimate: "si", timesPerMonth: null, minutesEach: null });
      actions.next(e);
      return;
    }
    setError(null);
    const keep = estimate === "si" ? { t: null, m: null } : (() => { const p = parsed(); return { t: p.t.ok ? p.t.value : null, m: p.m.ok ? p.m.value : null }; })();
    actions.setDraft({ estimate, timesPerMonth: keep.t, minutesEach: keep.m, stale: false });
    void actions.save({ step: 2, teamSeen, estimate, timesPerMonth: keep.t, minutesEach: keep.m });
    if (estimate !== "si") requestAnimationFrame(() => timesRef.current?.focus());
  };

  const onPrimary = async (e: React.MouseEvent<HTMLButtonElement>) => {
    if (actions.tooSoon(e)) return;
    const p = parsed();
    if (team && draft.estimate === null) {
      setError(T.estimate.pick);
      return;
    }
    if (!p.t.ok || !p.m.ok) {
      setError(T.estimate.invalid);
      timesRef.current?.focus();
      return;
    }
    if (!team && (p.t.value === null || p.m.value === null)) {
      setError(T.estimate.noTeamMissing);
      timesRef.current?.focus();
      return;
    }
    setError(null);
    if (timer.current) clearTimeout(timer.current);
    const estimate = team ? draft.estimate : null;
    const numbers = estimate === "si" ? { t: null, m: null } : { t: p.t.value, m: p.m.value };
    actions.setDraft({ estimate, timesPerMonth: numbers.t, minutesEach: numbers.m });
    const ok = await actions.save({ step: 2, teamSeen, estimate, timesPerMonth: numbers.t, minutesEach: numbers.m });
    if (ok) actions.next(null);
  };

  const field = (which: "times" | "minutes") => {
    const isTimes = which === "times";
    const value = isTimes ? times : minutes;
    const label = team ? (isTimes ? perMonthLabel() : T.estimate.minutesEach) : isTimes ? T.estimate.noTeamTimes : T.estimate.noTeamMinutes;
    const placeholder = team ? (isTimes ? placeholderOf(team.perMonth ?? (team.volumeYear / 12)) : placeholderOf(team.minutes)) : "";
    const inputId = `${id}-${which}`;
    return (
      <div className="min-w-0 flex-1 space-y-1.5">
        <label htmlFor={inputId} className="block text-base font-medium">
          {label}
        </label>
        <input
          ref={isTimes ? timesRef : undefined}
          id={inputId}
          type="text"
          inputMode="decimal"
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          aria-invalid={shownError === T.estimate.invalid ? true : undefined}
          aria-describedby={shownError ? errId : undefined}
          onChange={(e) => {
            const text = e.target.value;
            setError(null);
            if (isTimes) setTimes(text);
            else setMinutes(text);
            schedule(isTimes ? text : times, isTimes ? minutes : text);
          }}
          onBlur={() => {
            if (timer.current) clearTimeout(timer.current);
            void saveNumbers(team ? draft.estimate : null, times, minutes);
          }}
          className={CONTROL_CLASS}
        />
      </div>
    );
  };

  const needsPrimary = last || !team || different;
  const primaryLabel = last ? T.send : T.next;
  return (
    <section aria-labelledby={stepTitleId(2)} className="mt-6 space-y-4" data-slot="referent-step-2">
      {staleNotice || draft.stale ? <Notice tone="attenzione">{T.estimate.stale}</Notice> : null}
      {team ? (
        <>
          {team.label ? <p className="text-sm break-words text-muted-foreground">{team.label}</p> : null}
          <StepTitle step={2}>{teamEstimateQuestion(team)}</StepTitle>
          <p className="text-base break-words text-muted-foreground">{teamEstimateDetail(team)}</p>
          <div role="group" aria-label={T.estimate.group} className="flex flex-col gap-3 sm:flex-row">
            <Choice pressed={draft.estimate === "si"} filled={!needsPrimary} onClick={(e) => pick("si", e)}>
              {T.estimate.yes}
            </Choice>
            <Choice pressed={draft.estimate === "meno"} filled={false} onClick={(e) => pick("meno", e)}>
              {T.estimate.less}
            </Choice>
            <Choice pressed={draft.estimate === "piu"} filled={false} onClick={(e) => pick("piu", e)}>
              {T.estimate.more}
            </Choice>
          </div>
        </>
      ) : (
        <>
          <StepTitle step={2}>{T.estimate.noTeamTitle}</StepTitle>
          <p className="text-base text-muted-foreground">{T.estimate.noTeamHint}</p>
        </>
      )}
      {showNumbers ? (
        <div className="space-y-3">
          {team ? <p className="text-base">{T.estimate.numbersLead}</p> : null}
          <div className="flex flex-col gap-3 min-[400px]:flex-row">
            {field("times")}
            {field("minutes")}
          </div>
        </div>
      ) : null}
      {shownError ? (
        <p id={errId} role="alert" className="text-sm break-words text-uc-rosso">
          {shownError}
        </p>
      ) : null}
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
        {needsPrimary ? (
          <Button type="button" className="h-12 w-full text-base sm:w-auto sm:min-w-48" aria-busy={sending || undefined} onClick={(e) => void onPrimary(e)}>
            {sending ? <Loader2 className="animate-spin" aria-hidden /> : null}
            {primaryLabel}
          </Button>
        ) : null}
      </div>
    </section>
  );
}
