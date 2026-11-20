"use client";

import { useCallback, useEffect, useId, useReducer, useRef, useState } from "react";
import { Check, Paperclip } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TEXTAREA_CLASS } from "@/components/uc/referente/inputs/fields";
import { REFERENT_CHECK_LIMITS } from "@/lib/db/use-case-hub-referent-check-ddl";
import { cn } from "@/lib/utils";
import { REFERENT_LIMITS } from "@/lib/use-cases/referent/contract";
import { REFERENT_ERROR_MESSAGES, REFERENT_PUBLIC_TEXT, fillText } from "@/lib/use-cases/referent/labels";
import { waitsForPrivacy } from "@/lib/use-cases/referent/state";
import { saveDraft } from "./api";
import { Attachments, type AttachmentsHandle } from "./attachments";
import { autosaveLabelKey, autosaveReducer, dueDraft, initialAutosave, needsFlush, waitFor, type AutosaveState, type DraftValue } from "./autosave";
import { attachLabel, closeHint, commentOffered, counterLabel, handledText, questionClosed, sentAnswerView, updatedLine, type PublicFile, type QuestionSave, type QuestionSection } from "./public-view-render";
import { TemplateDownloads } from "./template-downloads";

/**
 * Una domanda della pagina `/rispondi/<token>` (SPEC §4.4 punto 4, Parte 3 §P3.7; rilascio 5 §7.5):
 * - «aperta»: si chiude con una risposta (salvata da sola 1,5 secondi dopo l'ultimo tasto e uscendo dal
 *   campo; mai su «Serve un file»), un file, «Non lo so» (con «Chi potrebbe saperlo?») o «È già
 *   allegato»; con un file o «È già allegato» si può aggiungere un commento;
 * - «inviata»: in sola lettura, «Inviata il 27/10», il testo, «Non lo so» o «È già allegato», il
 *   commento, i nomi dei file;
 * - «gestita»: ci ha già pensato il team dalla scheda. Solo il titolo e «Non serve più: ci ha già
 *   pensato il team.»: niente campi, niente file, mai cosa ha scritto il team né chi.
 *
 * (Rilascio 10, §3.11) Tre controlli per domanda: il campo, «Allega» e «Non lo so», più «Altro ▸» con «È già allegato» e
 * «Ho un dubbio». La scheda ha il suo numero («1», «2»…) e il titolo che fa da etichetta del campo. Con un file da
 * compilare prima «Scarica il file da compilare», poi «Allega il file compilato», e il campo chiuso sotto «Oppure scrivi la
 * risposta ▸»; una domanda che vuole un file ha «Allega un file» grande. Lo stato del salvataggio sta nella barra («2 di 5 ·
 * salvato», `onSave`): sotto la domanda solo quando non riesce.
 *
 * (Rilascio 9b) Una bozza, un file o un «Togli» che aspettano l'informativa (mai letta, o cambiata con un rilascio
 * mentre la pagina era aperta) non ricostruiscono la domanda: il testo resta nel campo (`held`), la pagina mostra di
 * nuovo l'informativa (`onPrivacyWait`) e, dopo «Iniziamo», fa partire quello che aspetta.
 */

const T = REFERENT_PUBLIC_TEXT;

export const questionAnchor = (needId: string) => `ucq-domanda-${needId.toLowerCase()}`;
export const questionTitleId = (needId: string) => `ucq-domanda-${needId.toLowerCase()}-titolo`;

/** Salva quello che manca prima dell'invio: true se il server ha l'ultima versione della risposta. */
export type FlushDraft = () => Promise<boolean>;

/** (Rilascio 10, §3.11) I comandi sotto il campo: senza bordo, alti 44 px, scelti con il fondo e un filo. */
const COMMAND_CLASS = "min-h-11 h-auto px-2 text-base font-medium aria-pressed:bg-muted aria-pressed:ring-[1.5px] aria-pressed:ring-foreground aria-pressed:ring-inset";

function CardFrame({
  section,
  token,
  children,
  invalid,
  missing,
  closed,
}: {
  section: QuestionSection;
  /** («File da compilare») Con il token, sotto il titolo i link dei file da compilare della domanda. */
  token?: string;
  children?: React.ReactNode;
  invalid?: boolean;
  missing?: boolean;
  closed?: boolean;
}) {
  return (
    <section
      id={questionAnchor(section.needId)}
      aria-labelledby={questionTitleId(section.needId)}
      data-closed={closed ? "" : undefined}
      className={cn(
        "min-w-0 scroll-mt-6 space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5",
        missing && "ring-2 ring-uc-giallo",
        invalid && "ring-2 ring-uc-rosso",
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        {section.label ? null : (
          <span
            aria-hidden
            data-slot="question-number"
            className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[13px] leading-none font-semibold tabular-nums", closed ? "bg-uc-verde-bg text-uc-verde" : "bg-muted")}
          >
            {closed ? <Check className="size-3.5" /> : section.number}
          </span>
        )}
        <div className="min-w-0 flex-1 space-y-1">
          {section.label ? <p className="text-sm text-muted-foreground">{section.label}</p> : null}
          <h3 id={questionTitleId(section.needId)} tabIndex={-1} className="rounded-md text-base leading-6 font-semibold break-words outline-none focus-visible:ring-3 focus-visible:ring-ring/40">
            {/* (Rilascio 10) Il numero che si vede è decorativo: lo leggono così i lettori di schermo («Manca ancora la domanda 2.»). */}
            {section.label ? null : <span className="sr-only">{fillText(T.aria.number, { n: section.number })} </span>}
            {section.title}
          </h3>
        </div>
        {closed ? <span className="sr-only">{T.doneSuffix}</span> : null}
      </div>
      {token ? <TemplateDownloads token={token} question={section.question} /> : null}
      {children}
    </section>
  );
}

export function SentQuestionCard({ section, today, extra, token }: { section: QuestionSection; today: string; extra?: React.ReactNode; token?: string }) {
  const sent = sentAnswerView(section.question, today);
  // (Rilascio 6) «Aggiornata il 08/11.»: il referente l'ha cambiata dopo l'invio.
  const updated = updatedLine(section.question, today);
  return (
    <CardFrame section={section} token={token} closed>
      {sent ? (
        <div className="space-y-2 text-base">
          <p className="text-sm text-muted-foreground">
            {sent.sentOn}
            {updated ? ` · ${updated}` : ""}
          </p>
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
      {extra}
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
  extra,
  downloads = true,
  paused = false,
  onPrivacyWait,
  onSave,
  onDoubt,
}: {
  token: string;
  section: QuestionSection;
  clientMode: boolean;
  /** («File da compilare») I link dei file da compilare sotto il titolo: solo con l'informativa di adesso letta. */
  downloads?: boolean;
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
  /** (Rilascio 5) La domanda è chiusa o no, per «2 di 5» e «Invia». */
  onClosure?: (needId: string, closed: boolean) => void;
  /**
   * (Rilascio 5) Il secondo clic di un doppio clic, o un clic subito dopo il cambio di passo (il doppio
   * clic su «Sì» del passo 2 arriva sulla prima domanda): «Non lo so», «È già allegato» e «Allega» lo ignorano.
   */
  tooSoon?: (e: React.MouseEvent<HTMLButtonElement>) => boolean;
  /** (Rilascio 6) Sotto la domanda: il filo con il team e il campo di «Ho un dubbio». */
  extra?: React.ReactNode;
  /** (Rilascio 9b) L'informativa è sullo schermo al posto delle domande: nessun salvataggio parte da solo. */
  paused?: boolean;
  /** (Rilascio 9b) Una scrittura aspetta l'informativa: la pagina la mostra di nuovo, senza ricostruire la domanda. */
  onPrivacyWait?: () => void;
  /** (Rilascio 10, §3.11) Lo stato del salvataggio di questa domanda, per l'unico «salvato» della barra. */
  onSave?: (needId: string, save: QuestionSave) => void;
  /** (Rilascio 10, §3.11) «Ho un dubbio» dentro «Altro»: la pagina apre il campo sotto la domanda. Senza, niente «Ho un dubbio». */
  onDoubt?: () => void;
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
  // (Rilascio 10, §3.11) «Altro ▸» chiuso, aperto se «È già allegato» è già scelto; con un file da compilare il campo
  // chiuso sotto «Oppure scrivi la risposta ▸», aperto se c'è già un testo.
  const [moreOpen, setMoreOpen] = useState(() => draft?.alreadyAttached === true);
  const [writeOpen, setWriteOpen] = useState(() => Boolean(draft?.text?.trim()) && !draft?.dontKnow && !draft?.alreadyAttached);
  const attachRef = useRef<AttachmentsHandle>(null);
  const [localError, setLocalError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const stateRef = useRef<AutosaveState>(state);
  const filesRef = useRef(files);
  const inFlight = useRef<Promise<boolean> | null>(null);
  const pausedRef = useRef(paused);
  const privacyWaitRef = useRef(onPrivacyWait);
  useEffect(() => {
    pausedRef.current = paused;
    privacyWaitRef.current = onPrivacyWait;
  }, [paused, onPrivacyWait]);

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
        // (Rilascio 9b) Aspetta l'informativa: il testo resta qui, mai una domanda ricostruita dalla bozza del server.
        if (waitsForPrivacy(r.code)) {
          dispatch({ type: "held", value: v });
          privacyWaitRef.current?.();
          return false;
        }
        dispatch({ type: "failure", value: v });
        if (r.code === "link_non_valido" || r.code === "domanda_non_disponibile" || r.code === "gia_inviata") onStale(r.code);
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

  // Il salvataggio automatico: parte quando scade l'attesa, sempre da un timer (mai durante il render). (Rilascio 9b)
  // Mai mentre l'informativa è sullo schermo, e mai con una chiamata ancora in corso (il flush dopo «Iniziamo»).
  useEffect(() => {
    if (paused) return;
    const now = Date.now();
    const wait = waitFor(state, now);
    if (wait === null) return;
    const timer = setTimeout(() => {
      const due = inFlight.current ? null : dueDraft(stateRef.current, Date.now());
      if (due) void save(due);
      else setTick((n) => n + 1);
    }, wait);
    return () => clearTimeout(timer);
  }, [state, tick, save, paused]);

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
      if (pausedRef.current) return;
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
  // (Rilascio 10, §3.11) Lo stato del salvataggio va alla barra: «salvato» solo quando tutto è sul server.
  const saveState: QuestionSave = state.status === "held" ? "held" : state.status === "error" || state.status === "blocked" ? "error" : state.inFlight || state.status === "pending" || state.status === "saving" ? "saving" : "saved";
  useEffect(() => {
    onSave?.(needId, saveState);
  }, [needId, saveState, onSave]);
  const fieldErrors = [...state.fieldError.map((i) => i.message), ...issues.filter((m) => !state.fieldError.some((i) => i.message === m))];
  // Un avviso che l'invio ha già trasformato in errore non si ripete sotto.
  const warnings = state.warnings.filter((w) => !fieldErrors.includes(w.message));
  const textId = `${id}-text`;
  const commentId = `${id}-commento`;
  const errId = `${id}-err`;
  const statusId = `${id}-stato`;
  const moreId = `${id}-altro`;
  const blocked = disabled;
  const template = (section.question.templates ?? []).length > 0;
  const showText = !fileRequired && !value.dontKnow && !attached;
  // (Rilascio 10, §3.11) Con un file da compilare il campo sta chiuso sotto «Oppure scrivi la risposta ▸».
  const textOpen = showText && (!template || writeOpen || value.text.trim().length > 0);
  const showComment = value.dontKnow || (offerComment && (commentOpen || Boolean(value.comment?.trim())));
  // Il pulsante grande: la domanda vuole un file o ha un file da compilare; altrimenti il comando «Allega».
  const bigAttach = fileRequired || template;
  const canUpload = !value.dontKnow && !attached;

  const field = textOpen ? (
    <div className="min-w-0 space-y-1.5">
      <textarea
        id={textId}
        value={value.text}
        maxLength={REFERENT_LIMITS.answerMax}
        rows={2}
        placeholder={T.answerPlaceholder}
        disabled={blocked}
        aria-labelledby={questionTitleId(needId)}
        aria-invalid={fieldErrors.length > 0 || undefined}
        aria-describedby={[fieldErrors.length > 0 ? errId : null, statusId].filter(Boolean).join(" ")}
        onChange={(e) => edit({ text: e.target.value }, false)}
        onBlur={() => dispatch({ type: "blur", now: Date.now() })}
        className={cn(TEXTAREA_CLASS, "min-h-12 field-sizing-content")}
      />
      {counter ? <p className="text-sm text-muted-foreground">{counter}</p> : null}
    </div>
  ) : null;

  const attachments =
    canUpload || files.some((f) => f.status !== "rifiutato") ? (
      <Attachments
        token={token}
        needId={needId}
        files={files}
        onFiles={setFiles}
        clientMode={clientMode}
        allowUpload={canUpload}
        disabled={blocked}
        tooSoon={tooSoon}
        label={attachLabel(section.question)}
        onPrivacyWait={onPrivacyWait}
        trigger={bigAttach ? "button" : "none"}
        handleRef={attachRef}
      />
    ) : null;

  return (
    <CardFrame section={section} token={downloads ? token : undefined} invalid={fieldErrors.length > 0} missing={missing && !closed} closed={closed}>
      {bigAttach ? attachments : field}
      {template && showText && !textOpen ? (
        <Button type="button" variant="ghost" aria-expanded={false} className="-ml-2 min-h-11 h-auto px-2 text-base underline underline-offset-4" disabled={blocked} onClick={() => setWriteOpen(true)}>
          {T.writeInstead}
          <span aria-hidden>{` ${T.moreClosed}`}</span>
        </Button>
      ) : null}
      {template ? field : null}
      {bigAttach ? null : attachments}

      <div role="group" aria-label={T.aria.closures} data-slot="question-commands" className="-ml-2 flex flex-wrap gap-x-1">
        {bigAttach || !canUpload ? null : (
          <Button
            type="button"
            variant="ghost"
            className={COMMAND_CLASS}
            disabled={blocked}
            onClick={(e) => {
              if (e.detail > 1 || tooSoon?.(e)) return;
              attachRef.current?.open();
            }}
          >
            <Paperclip aria-hidden />
            {T.attachShort}
          </Button>
        )}
        <Button type="button" variant="ghost" aria-pressed={value.dontKnow} className={COMMAND_CLASS} disabled={blocked} onClick={toggleDontKnow}>
          {T.dontKnow}
        </Button>
        <Button
          type="button"
          variant="ghost"
          aria-expanded={moreOpen}
          aria-controls={moreId}
          aria-label={fillText(T.aria.moreOn, { testo: section.title })}
          className={COMMAND_CLASS}
          onClick={() => setMoreOpen((open) => !open)}
        >
          {T.more}
          <span aria-hidden>{` ${moreOpen ? T.moreOpen : T.moreClosed}`}</span>
        </Button>
      </div>
      <div id={moreId} hidden={!moreOpen || undefined} data-slot="question-more" className="-mt-2 -ml-2 flex flex-wrap gap-x-1">
        <Button type="button" variant="ghost" aria-pressed={attached} className={COMMAND_CLASS} disabled={blocked} onClick={toggleAttached}>
          {T.alreadyAttached}
        </Button>
        {onDoubt ? (
          <Button type="button" variant="ghost" className={COMMAND_CLASS} onClick={() => onDoubt()}>
            {T.thread.doubt}
          </Button>
        ) : null}
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
        <Button type="button" variant="ghost" className="-ml-2 min-h-11 h-auto px-2 text-base" onClick={() => setCommentOpen(true)}>
          {T.addComment}
        </Button>
      ) : null}

      {/* (Rilascio 10, §3.11) Lo stato sotto la domanda solo quando il salvataggio non riesce: «salvato» sta nella barra. */}
      <p id={statusId} role="status" aria-live="polite" className={cn("text-sm text-uc-rosso", statusKey !== "error" && "sr-only")}>
        {statusKey === "error" ? T.autosave.error : ""}
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
      {extra}
    </CardFrame>
  );
}

/**
 * La scheda di una domanda nel suo stato. («File da compilare») `downloads`: i link «Scarica il file da compilare» solo
 * con l'informativa di adesso letta, come il download (che senza risponde 404): di default sì.
 */
export function QuestionCard({ downloads = true, ...props }: Parameters<typeof OpenQuestionCard>[0] & { today: string; downloads?: boolean }) {
  const token = downloads ? props.token : undefined;
  if (props.section.kind === "inviata") return <SentQuestionCard section={props.section} today={props.today} extra={props.extra} token={token} />;
  if (props.section.kind === "gestita") return <HandledQuestionCard section={props.section} />;
  return <OpenQuestionCard {...props} downloads={downloads} />;
}
