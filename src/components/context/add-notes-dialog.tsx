"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight, FileText, XIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { CONTEXT_LIMITS } from "@/lib/context/vocab";
import type { AiConsentNoticeData } from "@/lib/db/queries/context-consent";
import { cn } from "@/lib/utils";
import { AiConsentNotice } from "./ai-consent-notice";
import { Field } from "./fields";
import { readUntilDone, saveNote, uploadDocument } from "./read-client";
import { ACCEPTED_FILES, addNotesClose, afterUpload, droppedFileKind, droppedText, fileSizeText, noteDraftErrors, proposedTitle, readOutcomeMessage, titleFromFileName, type AddNotesPhase, type ReadMessage } from "./view-model";

const T = CONTEXT_TEXT;

interface Draft {
  body: string;
  title: string;
  occurredOn: string;
  participants: string;
  link: string;
}
/** Come è finita: il messaggio, la fonte (per «Riprova» e per il link) e se mostrare l'avviso dell'ok. */
interface Ending {
  message: ReadMessage;
  sourceId: string | null;
  duplicate: boolean;
  consent: boolean;
}

const emptyDraft = (today: string): Draft => ({ body: "", title: "", occurredOn: today, participants: "", link: "" });

/**
 * «Aggiungi appunti» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.3). Solo Lateral Space. Gli appunti si
 * incollano o si trascinano: un file di testo si legge nel browser e finisce nel campo; gli altri (PDF, Word, Excel,
 * PowerPoint, CSV, fino a 4 MB) si caricano come documento «Solo Lateral Space» e si leggono come un appunto.
 *
 * «Aggiungi» salva, poi legge parte per parte («Leggo gli appunti… 2 di 3»). Con proposte si va a «Da confermare»;
 * altrimenti il messaggio dell'esito, con «Riprova» quando serve. La finestra non si chiude da sola mentre legge;
 * «Chiudi» lascia la lettura al prossimo passaggio. A tutto schermo sul telefono.
 */
export function AddNotesDialog({
  open,
  onOpenChange,
  workspaceId,
  today,
  consentNotice,
  pickedFile = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  workspaceId: string;
  today: string;
  consentNotice: AiConsentNoticeData | null;
  /** (Rilascio 10, §3.7) Il file scelto da «Aggiungi › File»: la finestra si apre con lui dentro, come se fosse trascinato. */
  pickedFile?: File | null;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(() => emptyDraft(today));
  const [titleTouched, setTitleTouched] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [phase, setPhase] = useState<AddNotesPhase>("modulo");
  const [progress, setProgress] = useState<{ partsRead: number; partsTotal: number } | null>(null);
  const [ending, setEnding] = useState<Ending | null>(null);
  const running = useRef<AbortController | null>(null);
  // Ogni chiusura dopo il salvataggio apre un giro nuovo: una risposta del giro di prima non tocca più la finestra.
  const round = useRef(0);
  const fileInput = useRef<HTMLInputElement | null>(null);
  const busy = phase === "salvo" || phase === "leggo";
  // «Con chi» e «Link» stanno in «Altro», chiuso; si apre da sé quando hanno qualcosa o un errore.
  const [moreOpen, setMoreOpen] = useState(false);

  const reset = () => {
    setDraft(emptyDraft(today));
    setTitleTouched(false);
    setFile(null);
    setErrors({});
    setFailure(null);
    setPhase("modulo");
    setProgress(null);
    setEnding(null);
    setMoreOpen(false);
  };

  const close = () => {
    onOpenChange(false);
    const then = addNotesClose(phase);
    if (then.keepDraft) return;
    // «Chiudi» non ferma la lettura sul server: la finisce lì, o la riprende la pagina o la notte.
    round.current += 1;
    running.current = null;
    if (then.refresh) router.refresh();
    reset();
  };

  const setBody = (body: string) => {
    setDraft((d) => ({ ...d, body, title: titleTouched ? d.title : proposedTitle(body) }));
  };

  const takeFile = async (picked: File | null | undefined) => {
    if (!picked) return;
    const kind = droppedFileKind(picked);
    if (kind.kind === "rifiutato") {
      setErrors((e) => ({ ...e, body: kind.message }));
      return;
    }
    setErrors((e) => ({ ...e, body: "" }));
    const title = titleFromFileName(picked.name);
    if (kind.kind === "testo") {
      const text = droppedText(new Uint8Array(await picked.arrayBuffer()));
      setDraft((d) => ({ ...d, body: text, title: titleTouched && d.title ? d.title : title || proposedTitle(text) }));
      setFile(null);
      return;
    }
    setFile(picked);
    if (!titleTouched || !draft.title) setDraft((d) => ({ ...d, title }));
  };

  // Il file di «Aggiungi › File» entra una volta, all'apertura.
  const taken = useRef<File | null>(null);
  useEffect(() => {
    if (!open || !pickedFile || taken.current === pickedFile) return;
    taken.current = pickedFile;
    void takeFile(pickedFile);
    // `takeFile` cambia a ogni disegno: conta solo il file nuovo.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pickedFile]);

  /** La lettura di una fonte già salvata, fino in fondo. */
  const read = async (sourceId: string) => {
    const controller = new AbortController();
    running.current = controller;
    setPhase("leggo");
    setProgress(null);
    setEnding(null);
    const result = await readUntilDone(fetch, workspaceId, sourceId, { signal: controller.signal, onPart: setProgress }).catch(() => null);
    // Chiusa nel frattempo: niente da mostrare nella finestra, ma la lettura sul server è finita adesso. La pagina si
    // aggiorna, così «N proposte da confermare» conta anche queste.
    if (running.current !== controller) {
      router.refresh();
      return;
    }
    running.current = null;
    if (!result) {
      setPhase("fatto");
      setEnding({ message: { text: T.read.failed, retry: true, tone: "problema" }, sourceId, duplicate: false, consent: false });
      return;
    }
    if (!result.ok) {
      setPhase("fatto");
      setEnding({ message: { text: result.message, retry: result.status === 0 || result.status >= 500, tone: "problema" }, sourceId, duplicate: false, consent: false });
      return;
    }
    const outcome = result.outcome;
    if (outcome.status === "letto" && outcome.proposals > 0) {
      onOpenChange(false);
      reset();
      router.push(`/dashboard/${workspaceId}/contesto/conferma?fonte=${encodeURIComponent(sourceId)}`);
      return;
    }
    setPhase("fatto");
    setEnding({ message: readOutcomeMessage(outcome) ?? { text: T.add.nothingNew, retry: false, tone: "fatto" }, sourceId, duplicate: false, consent: outcome.status === "ok_mancante" });
    router.refresh();
  };

  const submit = async () => {
    const local = noteDraftErrors({ ...draft, hasFile: file !== null });
    setErrors({ ...local });
    setFailure(null);
    if (Object.keys(local).length > 0) return;
    const mine = round.current;
    setPhase("salvo");
    let sourceId: string;
    if (file) {
      const uploaded = await uploadDocument(fetch, { workspaceId, file, origine: "appunti", occurredOn: draft.occurredOn, title: draft.title, participants: draft.participants, link: draft.link }).catch(() => null);
      if (round.current !== mine) return;
      if (!uploaded || !uploaded.ok) {
        setPhase("modulo");
        setFailure(uploaded ? uploaded.message : T.errors.retry);
        return;
      }
      sourceId = uploaded.value.sourceId;
      const then = afterUpload(uploaded.value);
      if (!then.read) {
        // Niente testo da leggere: lo si dice, e il documento resta nell'elenco.
        setPhase("fatto");
        setEnding({ message: { text: then.text ?? T.documents.unread, retry: false, tone: "attesa" }, sourceId, duplicate: false, consent: then.consent });
        router.refresh();
        return;
      }
    } else {
      const saved = await saveNote(fetch, workspaceId, draft).catch(() => null);
      if (round.current !== mine) return;
      if (!saved || !saved.ok) {
        setPhase("modulo");
        if (saved && Object.keys(saved.fieldErrors).length > 0) setErrors(saved.fieldErrors);
        else setFailure(saved ? saved.message : T.errors.retry);
        return;
      }
      if (!saved.value.created) {
        setPhase("fatto");
        setEnding({ message: { text: T.add.duplicate, retry: false, tone: "attesa" }, sourceId: saved.value.sourceId, duplicate: true, consent: false });
        return;
      }
      sourceId = saved.value.sourceId;
    }
    await read(sourceId);
  };

  const status = phase === "salvo" ? T.add.saving : phase === "leggo" ? (progress && progress.partsTotal > 1 ? T.page.readingOf(Math.min(progress.partsRead + 1, progress.partsTotal), progress.partsTotal) : T.page.reading) : null;

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) close();
        else onOpenChange(true);
      }}
      disablePointerDismissal={busy}
    >
      <DialogContent
        showCloseButton={false}
        className={cn(
          "top-0 left-0 flex h-[100dvh] max-h-[100dvh] w-full max-w-full translate-x-0 translate-y-0 flex-col gap-0 overflow-hidden rounded-none p-0",
          "sm:top-1/2 sm:left-1/2 sm:h-auto sm:max-h-[90dvh] sm:max-w-2xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-xl",
        )}
      >
        <DialogHeader className="border-b p-4 pt-[max(1rem,env(safe-area-inset-top))]">
          <DialogTitle className="text-base font-semibold">{T.add.title}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain p-4">
          {phase === "modulo" || phase === "salvo" ? (
            <form
              id="aggiungi-appunti"
              className="space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void submit();
              }}
            >
              <Field id="appunti-testo" label={T.add.bodyLabel} error={errors.body || null}>
                {file ? (
                  <div className="flex min-h-11 items-center gap-2 rounded-lg border px-3 py-2 text-sm">
                    <FileText aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate">{file.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{fileSizeText(file.size)}</span>
                    <Button type="button" variant="ghost" size="icon" className="size-11 shrink-0 sm:size-8" disabled={busy} onClick={() => setFile(null)}>
                      <XIcon aria-hidden />
                      <span className="sr-only">{T.notes.remove}</span>
                    </Button>
                  </div>
                ) : (
                  <div
                    onDragOver={(event) => {
                      if (event.dataTransfer.types.includes("Files")) event.preventDefault();
                    }}
                    onDrop={(event) => {
                      if (!event.dataTransfer.files.length) return;
                      event.preventDefault();
                      void takeFile(event.dataTransfer.files[0]);
                    }}
                  >
                    <Textarea
                      id="appunti-testo"
                      value={draft.body}
                      onChange={(event) => setBody(event.target.value)}
                      placeholder={T.add.bodyPlaceholder}
                      rows={10}
                      maxLength={CONTEXT_LIMITS.bodyMax + 1_000}
                      aria-invalid={errors.body ? true : undefined}
                      aria-describedby={errors.body ? "appunti-testo-errore" : "appunti-file"}
                      disabled={busy}
                      className="max-h-[45dvh] min-h-48"
                    />
                  </div>
                )}
                {file ? null : (
                  <label id="appunti-file" htmlFor="appunti-file-scelta" className="block cursor-pointer py-1 text-xs text-muted-foreground underline-offset-4 hover:underline">
                    {T.add.drop}
                  </label>
                )}
                <input
                  ref={fileInput}
                  id="appunti-file-scelta"
                  type="file"
                  accept={ACCEPTED_FILES}
                  className="sr-only"
                  tabIndex={-1}
                  disabled={busy}
                  onChange={(event) => {
                    void takeFile(event.target.files?.[0]);
                    event.target.value = "";
                  }}
                />
              </Field>
              <div className="grid gap-4 sm:grid-cols-[10rem_minmax(0,1fr)]">
                <Field id="appunti-data" label={T.add.date} error={errors.occurredOn || null}>
                  <Input
                    id="appunti-data"
                    type="date"
                    value={draft.occurredOn}
                    onChange={(event) => setDraft((d) => ({ ...d, occurredOn: event.target.value }))}
                    aria-invalid={errors.occurredOn ? true : undefined}
                    disabled={busy}
                    className="min-h-11 sm:min-h-8"
                  />
                </Field>
                <Field id="appunti-titolo" label={T.add.titleLabel} error={errors.title || null}>
                  <Input
                    id="appunti-titolo"
                    value={draft.title}
                    onChange={(event) => {
                      setTitleTouched(true);
                      setDraft((d) => ({ ...d, title: event.target.value }));
                    }}
                    maxLength={CONTEXT_LIMITS.titleMax}
                    aria-invalid={errors.title ? true : undefined}
                    disabled={busy}
                    className="min-h-11 sm:min-h-8"
                  />
                </Field>
              </div>
              {(() => {
                const shown = moreOpen || Boolean(draft.participants || draft.link || errors.participants || errors.link);
                return (
                  <div className="space-y-4">
                    <button
                      type="button"
                      aria-expanded={shown}
                      aria-controls="appunti-altro"
                      onClick={() => setMoreOpen(!shown)}
                      className="inline-flex min-h-11 items-center gap-1 text-sm font-medium outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
                    >
                      <ChevronRight aria-hidden className={cn("size-4 transition-transform motion-reduce:transition-none", shown && "rotate-90")} />
                      {T.add.more}
                    </button>
                    <div id="appunti-altro" hidden={!shown} className="space-y-4">
                      <Field id="appunti-con-chi" label={T.add.participants} error={errors.participants || null} optional>
                        <Input
                          id="appunti-con-chi"
                          value={draft.participants}
                          onChange={(event) => setDraft((d) => ({ ...d, participants: event.target.value }))}
                          maxLength={CONTEXT_LIMITS.participantsMax}
                          disabled={busy}
                          className="min-h-11 sm:min-h-8"
                        />
                      </Field>
                      <Field id="appunti-link" label={T.add.link} error={errors.link || null} optional>
                        <Input
                          id="appunti-link"
                          type="url"
                          inputMode="url"
                          value={draft.link}
                          onChange={(event) => setDraft((d) => ({ ...d, link: event.target.value }))}
                          maxLength={CONTEXT_LIMITS.linkMax}
                          placeholder="https://"
                          disabled={busy}
                          className="min-h-11 sm:min-h-8"
                        />
                      </Field>
                    </div>
                  </div>
                );
              })()}
              {failure ? (
                <p role="alert" className="text-sm text-destructive">
                  {failure}
                </p>
              ) : null}
            </form>
          ) : null}

          {status ? (
            <p role="status" className="text-sm text-muted-foreground">
              {status}
            </p>
          ) : null}

          {phase === "fatto" && ending ? (
            <div className="space-y-3" role="status">
              <p className="text-sm">
                {ending.message.text}{" "}
                {ending.duplicate && ending.sourceId ? (
                  <Link href={`/dashboard/${workspaceId}/contesto?vista=appunti&fonte=${encodeURIComponent(ending.sourceId)}`} onClick={() => close()} className="underline underline-offset-4">
                    {T.page.open}
                  </Link>
                ) : null}
              </p>
              {ending.consent && consentNotice ? <AiConsentNotice notice={consentNotice} variant="card" /> : null}
            </div>
          ) : null}
        </div>

        <DialogFooter className="mx-0 mb-0 rounded-none pb-[max(1rem,env(safe-area-inset-bottom))]">
          {phase === "modulo" || phase === "salvo" ? (
            <>
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={close}>
                {busy ? T.add.close : T.add.cancel}
              </Button>
              <Button type="submit" form="aggiungi-appunti" className="min-h-11 sm:min-h-8" disabled={busy}>
                {T.add.submit}
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" onClick={close}>
                {T.add.close}
              </Button>
              {phase === "fatto" && ending?.message.retry && ending.sourceId ? (
                <Button type="button" className="min-h-11 sm:min-h-8" onClick={() => void read(ending.sourceId!)}>
                  {T.read.retry}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
