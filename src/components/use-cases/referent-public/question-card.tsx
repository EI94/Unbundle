"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { NATIVE_CHECK_CLASS, TEXTAREA_CLASS } from "@/components/uc/referente/inputs/fields";
import { cn } from "@/lib/utils";
import { REFERENT_LIMITS } from "@/lib/use-cases/referent/contract";
import { REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";
import { saveDraft } from "./api";
import { Attachments } from "./attachments";
import { autosaveLabelKey, autosaveReducer, dueDraft, initialAutosave, needsFlush, waitFor, type AutosaveState, type DraftValue } from "./autosave";
import { counterLabel, handledText, sentAnswerView, type PublicFile, type QuestionSection } from "./public-view-render";

/**
 * Una domanda della pagina `/rispondi/<token>` (SPEC §4.4 punto 4, Parte 3 §P3.7):
 * - «aperta»: la risposta (salvata da sola 1,5 secondi dopo l'ultimo tasto e uscendo dal campo),
 *   «Non lo so», i file;
 * - «inviata»: in sola lettura, «Inviata il 27/10», il testo o «Non lo so», i nomi dei file;
 * - «gestita»: ci ha già pensato il team dalla scheda. Solo il titolo e «Non serve più: ci ha già
 *   pensato il team.»: niente campi, niente file, mai cosa ha scritto il team né chi.
 */

const T = REFERENT_PUBLIC_TEXT;

export const questionAnchor = (needId: string) => `ucq-domanda-${needId.toLowerCase()}`;
export const questionTitleId = (needId: string) => `ucq-domanda-${needId.toLowerCase()}-titolo`;

/** Salva quello che manca prima dell'invio: true se il server ha l'ultima versione della risposta. */
export type FlushDraft = () => Promise<boolean>;

function CardFrame({ section, children, invalid }: { section: QuestionSection; children?: React.ReactNode; invalid?: boolean }) {
  return (
    <section
      id={questionAnchor(section.needId)}
      aria-labelledby={questionTitleId(section.needId)}
      className={cn("min-w-0 scroll-mt-6 space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5", invalid && "ring-2 ring-uc-rosso")}
    >
      <div className="space-y-1">
        <p className="text-sm text-muted-foreground">{section.label}</p>
        <h2 id={questionTitleId(section.needId)} tabIndex={-1} className="text-lg leading-snug font-semibold break-words outline-none">
          {section.title}
        </h2>
      </div>
      {children}
    </section>
  );
}

export function SentQuestionCard({ section, today }: { section: QuestionSection; today: string }) {
  const sent = sentAnswerView(section.question, today);
  return (
    <CardFrame section={section}>
      {sent ? (
        <div className="space-y-2 text-base">
          <p className="text-sm text-muted-foreground">{sent.sentOn}</p>
          {sent.text ? <p className="break-words whitespace-pre-line">{sent.text}</p> : null}
          {sent.files.length > 0 ? (
            <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {sent.files.map((name) => (
                <li key={name} className="break-all">
                  {name}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
    </CardFrame>
  );
}

export function HandledQuestionCard({ section }: { section: QuestionSection }) {
  return (
    <CardFrame section={section}>
      <p className="text-base text-muted-foreground">{handledText()}</p>
    </CardFrame>
  );
}

export function OpenQuestionCard({
  token,
  section,
  clientMode,
  declared,
  onDeclared,
  issues,
  disabled,
  registerFlush,
  onStale,
  onEdit,
}: {
  token: string;
  section: QuestionSection;
  clientMode: boolean;
  declared: boolean;
  onDeclared: (v: boolean) => void;
  /** I problemi dell'ultimo invio su questa domanda. */
  issues: readonly string[];
  disabled: boolean;
  registerFlush: (needId: string, flush: FlushDraft | null) => void;
  /** La domanda non è più aperta, o il link non vale più: la pagina si ricarica. */
  onStale: (code: string) => void;
  /** Il referente cambia la risposta: i problemi dell'ultimo invio su questa domanda si tolgono. */
  onEdit?: (needId: string) => void;
}) {
  const id = useId();
  const needId = section.needId;
  const draft = section.question.draft;
  const [state, dispatch] = useReducer(autosaveReducer, null, () =>
    initialAutosave({ text: draft?.dontKnow ? "" : (draft?.text ?? ""), dontKnow: draft?.dontKnow === true }, draft?.savedAt ?? null),
  );
  const [files, setFiles] = useState<PublicFile[]>(() => section.question.files);
  const [tick, setTick] = useState(0);
  const stateRef = useRef<AutosaveState>(state);
  const inFlight = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const save = useCallback(
    (value: DraftValue, keepalive = false): Promise<boolean> => {
      dispatch({ type: "start", value });
      const run = (async () => {
        const r = await saveDraft(token, { needId, text: value.dontKnow ? null : value.text, dontKnow: value.dontKnow }, keepalive);
        if (r.ok) {
          dispatch({ type: "success", value, savedAt: r.data.savedAt, warnings: r.data.warnings });
          return true;
        }
        if (r.code.startsWith("testo_") || r.code === "risposte_da_correggere") {
          dispatch({ type: "blocked", value, issues: r.issues.length > 0 ? r.issues : [{ code: r.code, message: r.message }] });
          return false;
        }
        dispatch({ type: "failure", value });
        if (r.code === "link_non_valido" || r.code === "domanda_non_disponibile" || r.code === "gia_inviata" || r.code === "informativa_da_leggere") onStale(r.code);
        return false;
      })();
      inFlight.current = run;
      void run.finally(() => {
        if (inFlight.current === run) inFlight.current = null;
      });
      return run;
    },
    [token, needId, onStale],
  );

  // Il salvataggio automatico: parte quando scade l'attesa, sempre da un timer (mai durante il render).
  useEffect(() => {
    const now = Date.now();
    const wait = waitFor(state, now);
    if (wait === null) return;
    const timer = setTimeout(() => {
      const due = dueDraft(stateRef.current, Date.now());
      if (due) void save(due);
      else setTick((n) => n + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [state, tick, save]);

  // Prima dell'invio la pagina chiede a ogni domanda di salvare quello che manca.
  useEffect(() => {
    const flush: FlushDraft = async () => {
      if (inFlight.current) await inFlight.current;
      const current = stateRef.current;
      if (current.status === "blocked") return false;
      if (!needsFlush(current)) return current.status !== "error";
      return save(current.value);
    };
    registerFlush(needId, flush);
    return () => registerFlush(needId, null);
  }, [needId, registerFlush, save]);

  // Chi chiude la pagina con una modifica non salvata: un ultimo salvataggio che sopravvive alla chiusura.
  useEffect(() => {
    const onHide = () => {
      const current = stateRef.current;
      if (!current.inFlight && current.status !== "blocked" && needsFlush(current)) void save(current.value, true);
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, [save]);

  const value = state.value;
  const counter = counterLabel(value.text.length);
  const statusKey = autosaveLabelKey(state);
  const fieldErrors = [...state.fieldError.map((i) => i.message), ...issues.filter((m) => !state.fieldError.some((i) => i.message === m))];
  // Un avviso che l'invio ha già trasformato in errore non si ripete sotto.
  const warnings = state.warnings.filter((w) => !fieldErrors.includes(w.message));
  const textId = `${id}-text`;
  const errId = `${id}-err`;
  const statusId = `${id}-stato`;
  const blocked = disabled;

  return (
    <CardFrame section={section} invalid={fieldErrors.length > 0}>
      <div className="min-w-0 space-y-1.5">
        <label htmlFor={textId} className="block text-sm font-medium">
          {T.answerLabel}
        </label>
        <textarea
          id={textId}
          value={value.text}
          maxLength={REFERENT_LIMITS.answerMax}
          rows={4}
          placeholder={T.answerPlaceholder}
          disabled={blocked || value.dontKnow}
          aria-invalid={fieldErrors.length > 0 || undefined}
          aria-describedby={[fieldErrors.length > 0 ? errId : null, statusId].filter(Boolean).join(" ")}
          onChange={(e) => {
            onEdit?.(needId);
            dispatch({ type: "edit", value: { text: e.target.value, dontKnow: false }, now: Date.now() });
          }}
          onBlur={() => dispatch({ type: "blur", now: Date.now() })}
          className={TEXTAREA_CLASS}
        />
        <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm text-muted-foreground">
          <p id={statusId} role="status" aria-live="polite" className={cn("min-w-0", statusKey === "error" && "text-uc-rosso")}>
            {statusKey ? T.autosave[statusKey] : ""}
          </p>
          {counter && !value.dontKnow ? <p className="shrink-0">{counter}</p> : null}
        </div>
        {fieldErrors.length > 0 ? (
          <ul id={errId} className="space-y-1 text-sm break-words text-uc-rosso">
            {fieldErrors.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        ) : null}
        {warnings.length > 0 ? (
          <ul className="space-y-1 rounded-lg bg-uc-giallo-bg px-3 py-2 text-sm break-words">
            {warnings.map((w) => (
              <li key={`${w.code}-${w.message}`}>{w.message}</li>
            ))}
          </ul>
        ) : null}
      </div>

      <label htmlFor={`${id}-nonso`} className="flex min-h-11 min-w-0 cursor-pointer items-center gap-3 text-base has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60">
        <input
          id={`${id}-nonso`}
          type="checkbox"
          checked={value.dontKnow}
          disabled={blocked}
          onChange={(e) => {
            onEdit?.(needId);
            dispatch({ type: "edit", value: { text: "", dontKnow: e.target.checked }, now: Date.now() });
          }}
          onBlur={() => dispatch({ type: "blur", now: Date.now() })}
          className={NATIVE_CHECK_CLASS}
        />
        <span className="min-w-0 break-words">{T.dontKnow}</span>
      </label>

      {!value.dontKnow || files.some((f) => f.status !== "rifiutato") ? (
        <Attachments
          token={token}
          needId={needId}
          files={files}
          onFiles={setFiles}
          clientMode={clientMode}
          declared={declared}
          onDeclared={onDeclared}
          allowUpload={!value.dontKnow}
          disabled={blocked}
        />
      ) : null}
    </CardFrame>
  );
}

export function QuestionCard(props: Parameters<typeof OpenQuestionCard>[0] & { today: string }) {
  if (props.section.kind === "inviata") return <SentQuestionCard section={props.section} today={props.today} />;
  if (props.section.kind === "gestita") return <HandledQuestionCard section={props.section} />;
  return <OpenQuestionCard {...props} />;
}
