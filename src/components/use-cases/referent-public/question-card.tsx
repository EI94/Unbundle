"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TEXTAREA_CLASS } from "@/components/uc/referente/inputs/fields";
import { REFERENT_CHECK_LIMITS } from "@/lib/db/use-case-hub-referent-check-ddl";
import { cn } from "@/lib/utils";
import { REFERENT_LIMITS } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT } from "@/lib/use-cases/referent/labels";
import { saveDraft } from "./api";
import { Attachments } from "./attachments";
import { autosaveLabelKey, autosaveReducer, dueDraft, initialAutosave, needsFlush, waitFor, type AutosaveState, type DraftValue } from "./autosave";
import { attachHelp, closeHint, commentOffered, counterLabel, handledText, questionClosed, sentAnswerView, type PublicFile, type QuestionSection } from "./public-view-render";

/**
 * Una domanda della pagina `/rispondi/<token>` (SPEC §4.4 punto 4, Parte 3 §P3.7; rilascio 5 §7.5):
 * - «aperta»: si chiude con una risposta (salvata da sola 1,5 secondi dopo l'ultimo tasto e uscendo dal
 *   campo; mai su «Serve un file»), un file, «Non ce l'ho» (con «Chi potrebbe saperlo?») o «È già
 *   allegato»; con un file o «È già allegato» si può aggiungere un commento;
 * - «inviata»: in sola lettura, «Inviata il 27/10», il testo, «Non ce l'ho» o «È già allegato», il
 *   commento, i nomi dei file;
 * - «gestita»: ci ha già pensato il team dalla scheda. Solo il titolo e «Non serve più: ci ha già
 *   pensato il team.»: niente campi, niente file, mai cosa ha scritto il team né chi.
 */

const T = REFERENT_PUBLIC_TEXT;

export const questionAnchor = (needId: string) => `ucq-domanda-${needId.toLowerCase()}`;
export const questionTitleId = (needId: string) => `ucq-domanda-${needId.toLowerCase()}-titolo`;

/** Salva quello che manca prima dell'invio: true se il server ha l'ultima versione della risposta. */
export type FlushDraft = () => Promise<boolean>;

function CardFrame({ section, children, invalid, missing, closed }: { section: QuestionSection; children?: React.ReactNode; invalid?: boolean; missing?: boolean; closed?: boolean }) {
  return (
    <section
      id={questionAnchor(section.needId)}
      aria-labelledby={questionTitleId(section.needId)}
      data-closed={closed ? "" : undefined}
      className={cn(
        "min-w-0 scroll-mt-6 space-y-4 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5",
        missing && "ring-2 ring-uc-giallo",
        invalid && "ring-2 ring-uc-rosso",
      )}
    >
      <div className="space-y-1">
        <p className="flex items-center gap-1.5 text-sm text-muted-foreground">
          <span>{section.label}</span>
          {closed ? (
            <>
              <Check className="size-4 text-uc-verde" aria-hidden />
              <span className="sr-only">{T.doneSuffix}</span>
            </>
          ) : null}
        </p>
        <h3 id={questionTitleId(section.needId)} tabIndex={-1} className="rounded-md text-lg leading-snug font-semibold break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
          {section.title}
        </h3>
      </div>
      {children}
    </section>
  );
}

export function SentQuestionCard({ section, today }: { section: QuestionSection; today: string }) {
  const sent = sentAnswerView(section.question, today);
  return (
    <CardFrame section={section} closed>
      {sent ? (
        <div className="space-y-2 text-base">
          <p className="text-sm text-muted-foreground">{sent.sentOn}</p>
          {sent.text ? <p className="break-words whitespace-pre-line">{sent.text}</p> : null}
          {sent.comment ? <p className="text-sm break-words whitespace-pre-line text-muted-foreground">{sent.comment}</p> : null}
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
    <CardFrame section={section} closed>
      <p className="text-base text-muted-foreground">{handledText()}</p>
    </CardFrame>
  );
}

export function OpenQuestionCard({
  token,
  section,
  clientMode,
  issues,
  disabled,
  registerFlush,
  onStale,
  onEdit,
  missing = false,
  onClosure,
  tooSoon,
}: {
  token: string;
  section: QuestionSection;
  clientMode: boolean;
  /** I problemi dell'ultimo invio su questa domanda. */
  issues: readonly string[];
  disabled: boolean;
  registerFlush: (needId: string, flush: FlushDraft | null) => void;
  /** La domanda non è più aperta, o il link non vale più: la pagina si ricarica. */
  onStale: (code: string) => void;
  /** Il referente cambia la risposta: i problemi dell'ultimo invio su questa domanda si tolgono. */
  onEdit?: (needId: string) => void;
  /** (Rilascio 5) «Invia» l'ha trovata ancora aperta: l'anello morbido e la riga «Per chiudere: …». */
  missing?: boolean;
  /** (Rilascio 5) La domanda è chiusa o no, per «{k} di {n} fatte» e «Invia». */
  onClosure?: (needId: string, closed: boolean) => void;
  /**
   * (Rilascio 5) Il secondo clic di un doppio clic, o un clic subito dopo il cambio di passo (il doppio
   * clic su «Sì» del passo 2 arriva sulla prima domanda): «Non ce l'ho», «È già allegato» e «Allega un
   * file» lo ignorano.
   */
  tooSoon?: (e: React.MouseEvent<HTMLButtonElement>) => boolean;
}) {
  const id = useId();
  const needId = section.needId;
  const fileRequired = section.question.fileRequired === true;
  const draft = section.question.draft;
  const [state, dispatch] = useReducer(autosaveReducer, null, () =>
    initialAutosave(
      { text: draft?.dontKnow || draft?.alreadyAttached ? "" : (draft?.text ?? ""), dontKnow: draft?.dontKnow === true, alreadyAttached: draft?.alreadyAttached === true, comment: draft?.comment ?? "" },
      draft?.savedAt ?? null,
    ),
  );
  const [files, setFiles] = useState<PublicFile[]>(() => section.question.files);
  const [commentOpen, setCommentOpen] = useState(() => Boolean(draft?.comment));
  const [localError, setLocalError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const stateRef = useRef<AutosaveState>(state);
  const filesRef = useRef(files);
  const inFlight = useRef<Promise<boolean> | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);
  useEffect(() => {
    filesRef.current = files;
  }, [files]);

  const value = state.value;
  const attached = value.alreadyAttached === true;
  const closed = questionClosed(section.question, { text: value.text, dontKnow: value.dontKnow, alreadyAttached: attached, files });
  const offerComment = commentOffered({ dontKnow: value.dontKnow, alreadyAttached: attached, files });
  useEffect(() => {
    onClosure?.(needId, closed);
  }, [needId, closed, onClosure]);

  const save = useCallback(
    (v: DraftValue, keepalive = false): Promise<boolean> => {
      dispatch({ type: "start", value: v });
      const withComment = commentOffered({ dontKnow: v.dontKnow, alreadyAttached: v.alreadyAttached === true, files: filesRef.current });
      const run = (async () => {
        const r = await saveDraft(
          token,
          {
            needId,
            text: v.dontKnow || v.alreadyAttached ? null : v.text,
            dontKnow: v.dontKnow,
            alreadyAttached: v.alreadyAttached === true,
            comment: withComment && v.comment?.trim() ? v.comment : null,
          },
          keepalive,
        );
        if (r.ok) {
          dispatch({ type: "success", value: v, savedAt: r.data.savedAt, warnings: r.data.warnings });
          return true;
        }
        if (r.code.startsWith("testo_") || r.code === "risposte_da_correggere") {
          dispatch({ type: "blocked", value: v, issues: r.issues.length > 0 ? r.issues : [{ code: r.code, message: r.message }] });
          return false;
        }
        dispatch({ type: "failure", value: v });
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

  const edit = (patch: Partial<DraftValue>, now = true) => {
    onEdit?.(needId);
    setLocalError(null);
    const next = { ...value, ...patch };
    dispatch({ type: "edit", value: next, now: Date.now() });
    // Le scelte si salvano subito: niente da aspettare come per il testo.
    if (now) dispatch({ type: "blur", now: Date.now() });
  };
  const toggleDontKnow = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (tooSoon?.(e)) return;
    if (!value.dontKnow && files.some((f) => f.status !== "rifiutato" && !f.submitted)) {
      setLocalError(REFERENT_ERROR_MESSAGES.non_so_con_file);
      return;
    }
    edit({ dontKnow: !value.dontKnow, alreadyAttached: false, text: value.dontKnow ? value.text : "" });
  };
  const toggleAttached = (e: React.MouseEvent<HTMLButtonElement>) => {
    if (tooSoon?.(e)) return;
    edit({ alreadyAttached: !attached, dontKnow: false });
  };

  const counter = counterLabel(value.text.length);
  const statusKey = autosaveLabelKey(state);
  const fieldErrors = [...state.fieldError.map((i) => i.message), ...issues.filter((m) => !state.fieldError.some((i) => i.message === m))];
  // Un avviso che l'invio ha già trasformato in errore non si ripete sotto.
  const warnings = state.warnings.filter((w) => !fieldErrors.includes(w.message));
  const textId = `${id}-text`;
  const commentId = `${id}-commento`;
  const errId = `${id}-err`;
  const statusId = `${id}-stato`;
  const blocked = disabled;
  const showText = !fileRequired && !value.dontKnow && !attached;
  const showComment = value.dontKnow || (offerComment && (commentOpen || Boolean(value.comment?.trim())));

  return (
    <CardFrame section={section} invalid={fieldErrors.length > 0} missing={missing && !closed} closed={closed}>
      {fileRequired ? (
        <p className="text-sm break-words text-muted-foreground">
          <span className="font-medium text-foreground">{T.fileRequired}</span> · {attachHelp(clientMode)}
        </p>
      ) : null}
      {showText ? (
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
            disabled={blocked}
            aria-invalid={fieldErrors.length > 0 || undefined}
            aria-describedby={[fieldErrors.length > 0 ? errId : null, statusId].filter(Boolean).join(" ")}
            onChange={(e) => edit({ text: e.target.value }, false)}
            onBlur={() => dispatch({ type: "blur", now: Date.now() })}
            className={TEXTAREA_CLASS}
          />
          {counter ? <p className="text-sm text-muted-foreground">{counter}</p> : null}
        </div>
      ) : null}

      {!value.dontKnow && !attached ? (
        <Attachments token={token} needId={needId} files={files} onFiles={setFiles} clientMode={clientMode} allowUpload disabled={blocked} tooSoon={tooSoon} />
      ) : files.some((f) => f.status !== "rifiutato") ? (
        <Attachments token={token} needId={needId} files={files} onFiles={setFiles} clientMode={clientMode} allowUpload={false} disabled={blocked} />
      ) : null}

      <div role="group" aria-label={T.aria.closures} className="flex flex-wrap gap-2">
        <Button type="button" variant="outline" aria-pressed={value.dontKnow} className={cn("min-h-11 text-base", value.dontKnow && "border-foreground")} disabled={blocked} onClick={toggleDontKnow}>
          {T.dontKnow}
        </Button>
        <Button type="button" variant="outline" aria-pressed={attached} className={cn("min-h-11 text-base", attached && "border-foreground")} disabled={blocked} onClick={toggleAttached}>
          {T.alreadyAttached}
        </Button>
      </div>

      {showComment ? (
        <div className="min-w-0 space-y-1.5">
          <label htmlFor={commentId} className="block text-sm font-medium">
            {value.dontKnow ? T.whoKnows : T.commentLabel}
          </label>
          <textarea
            id={commentId}
            value={value.comment ?? ""}
            maxLength={REFERENT_CHECK_LIMITS.commentMax}
            rows={2}
            placeholder={value.dontKnow ? T.whoKnowsPlaceholder : T.commentPlaceholder}
            disabled={blocked}
            onChange={(e) => edit({ comment: e.target.value }, false)}
            onBlur={() => dispatch({ type: "blur", now: Date.now() })}
            className={TEXTAREA_CLASS}
          />
        </div>
      ) : offerComment ? (
        <Button type="button" variant="ghost" className="min-h-11 h-auto px-2 text-base" onClick={() => setCommentOpen(true)}>
          {T.addComment}
        </Button>
      ) : null}

      <p id={statusId} role="status" aria-live="polite" className={cn("min-h-5 text-sm text-muted-foreground", statusKey === "error" && "text-uc-rosso")}>
        {statusKey ? T.autosave[statusKey] : ""}
      </p>
      {fieldErrors.length > 0 || localError ? (
        <ul id={errId} className="space-y-1 text-sm break-words text-uc-rosso">
          {[...fieldErrors, ...(localError ? [localError] : [])].map((m) => (
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
      {missing && !closed ? <p className="text-sm break-words">{closeHint(fileRequired)}</p> : null}
    </CardFrame>
  );
}

export function QuestionCard(props: Parameters<typeof OpenQuestionCard>[0] & { today: string }) {
  if (props.section.kind === "inviata") return <SentQuestionCard section={props.section} today={props.today} />;
  if (props.section.kind === "gestita") return <HandledQuestionCard section={props.section} />;
  return <OpenQuestionCard {...props} />;
}
