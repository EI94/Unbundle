"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronRight } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { removeSourceAction, setDocumentVisibilityAction } from "@/lib/actions/context";
import { dayLabel } from "@/lib/context/labels";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { ContextVisibility } from "@/lib/context/vocab";
import type { SourceDetail } from "@/lib/db/queries/context-sources";
import { ContextSheet } from "./context-sheet";
import { ChoiceSelect, Field } from "./fields";
import { getJson, readUntilDone, sourceUrl } from "./read-client";
import { fileSizeText, fileTypeText, notReportedLines, readOutcomeMessage, sourceMeta, sourceReadAction, type ReadMessage } from "./view-model";
import { VISIBILITY_ITEMS } from "./write-fact-form";

const T = CONTEXT_TEXT;

/**
 * Il dettaglio di una fonte come arriva dalla rotta: le date sono testo. (9b) `useCaseId`: per le risposte di un referente,
 * lo use case della richiesta, per «Apri lo use case».
 */
export type SourceDetailJson = Omit<SourceDetail, "createdAt" | "textPurgedAt"> & { createdAt: string; textPurgedAt: string | null; useCaseId?: string | null };

type Loaded = { status: "caricamento" } | { status: "pronto"; source: SourceDetailJson } | { status: "errore"; message: string };

/**
 * Il pannello di un appunto o di un documento nella vista «Appunti» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md
 * §7.5). Solo Lateral Space. Un appunto: il testo (o «cancellato dopo 12 mesi»), «Con chi», il link, «Aggiunto da …»,
 * e «Leggi» o «Rileggi», «Da confermare», «Togli». Un documento: nome, tipo, dimensione, chi lo vede, «Togli».
 * (9b) Le risposte di un referente: niente testo e niente «Togli» (vivono nella scheda dello use case), una frase che lo
 * dice e «Apri lo use case».
 */
export function SourceSheet({ workspaceId, sourceId, today, onClose }: { workspaceId: string; sourceId: string | null; today: string; onClose: () => void }) {
  return <SourceSheetBody key={sourceId ?? "chiuso"} workspaceId={workspaceId} sourceId={sourceId} today={today} onClose={onClose} />;
}

function SourceSheetBody({ workspaceId, sourceId, today, onClose }: { workspaceId: string; sourceId: string | null; today: string; onClose: () => void }) {
  const router = useRouter();
  const [loaded, setLoaded] = useState<Loaded>({ status: "caricamento" });
  const [reload, setReload] = useState(0);
  const [askRemove, setAskRemove] = useState(false);
  const [reading, setReading] = useState<{ partsRead: number; partsTotal: number } | "start" | null>(null);
  const [message, setMessage] = useState<ReadMessage | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!sourceId) return;
    const controller = new AbortController();
    getJson<SourceDetailJson>(fetch, sourceUrl(workspaceId, sourceId), controller.signal)
      .then((result) => setLoaded(result.ok ? { status: "pronto", source: result.value } : { status: "errore", message: result.message }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, sourceId, reload]);

  const source = loaded.status === "pronto" ? loaded.source : null;
  const isDocument = source?.kind === "documento";
  const isAnswers = source?.kind === "risposta";
  const purged = source?.textPurgedAt != null;
  const readAction = source ? sourceReadAction(source, purged) : null;

  const read = async () => {
    if (!source || !readAction) return;
    setMessage(null);
    setReading("start");
    const result = await readUntilDone(fetch, workspaceId, source.id, { again: readAction === "rileggi", onPart: setReading }).catch(() => null);
    setReading(null);
    if (!result || !result.ok) {
      setMessage({ text: result ? result.message : T.read.failed, retry: true, tone: "problema" });
      return;
    }
    if (result.outcome.status === "letto" && result.outcome.proposals > 0) {
      router.push(`/dashboard/${workspaceId}/contesto/conferma?fonte=${encodeURIComponent(source.id)}`);
      return;
    }
    setMessage(readOutcomeMessage(result.outcome));
    setReload((n) => n + 1);
    router.refresh();
  };

  const remove = () =>
    startTransition(async () => {
      if (!source) return;
      const result = await removeSourceAction(workspaceId, source.id);
      if (!result.ok) {
        toast.error(result.message);
        return;
      }
      toast.success(isDocument ? T.documents.removed : T.notes.removed);
      onClose();
    });

  const setVisibility = (visibility: ContextVisibility) =>
    startTransition(async () => {
      if (!source || visibility === source.visibility) return;
      const result = await setDocumentVisibilityAction(workspaceId, source.id, visibility);
      if (!result.ok) toast.error(result.message);
      else toast.success(T.fact.saved);
      setReload((n) => n + 1);
    });

  const busy = pending || reading !== null;
  const progressText = reading === null ? null : reading !== "start" && reading.partsTotal > 1 ? T.page.readingOf(Math.min(reading.partsRead + 1, reading.partsTotal), reading.partsTotal) : T.page.reading;
  const notReported = source ? notReportedLines([source.skipped]) : [];

  return (
    <ContextSheet
      open={sourceId !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={source?.title ?? T.page.tabNotes}
      description={source ? sourceMeta(source, today, true).join(" · ") : undefined}
      footer={
        source ? (
          askRemove ? (
            <div className="space-y-3">
              <p className="text-sm">{isDocument ? T.documents.removeConfirm : T.notes.removeConfirm}</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => setAskRemove(false)}>
                  {T.notes.cancel}
                </Button>
                <Button type="button" variant="destructive" className="min-h-11 sm:min-h-8" disabled={busy} onClick={remove}>
                  {isDocument ? T.documents.remove : T.notes.remove}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              {source.openProposals > 0 ? (
                <Link
                  href={`/dashboard/${workspaceId}/contesto/conferma?fonte=${encodeURIComponent(source.id)}`}
                  className="inline-flex min-h-11 items-center justify-center gap-0.5 rounded-lg border px-2.5 text-sm font-medium outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-8"
                >
                  {T.notes.toConfirm}
                  <ChevronRight aria-hidden className="size-4" />
                </Link>
              ) : null}
              {readAction ? (
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => void read()}>
                  {readAction === "leggi" ? T.notes.read : T.notes.readAgain}
                </Button>
              ) : null}
              {source.canRemove ? (
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={busy} onClick={() => setAskRemove(true)}>
                  {isDocument ? T.documents.remove : T.notes.remove}
                </Button>
              ) : null}
            </div>
          )
        ) : undefined
      }
    >
      {loaded.status === "caricamento" ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-32 w-full" />
        </div>
      ) : loaded.status === "errore" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {loaded.message}
        </p>
      ) : source ? (
        <>
          {progressText ? (
            <p role="status" className="text-sm text-muted-foreground">
              {progressText}
            </p>
          ) : null}
          {message ? (
            <p role="status" className="text-sm">
              {message.text}
            </p>
          ) : null}
          {isDocument && source.document ? (
            <dl className="space-y-3 text-sm">
              <div>
                <dt className="sr-only">{T.page.tabDocuments}</dt>
                <dd className="break-words">{source.document.fileName}</dd>
                <dd className="text-xs text-muted-foreground">{[fileTypeText(source.document.fileName), fileSizeText(source.document.fileSize)].filter(Boolean).join(" · ")}</dd>
              </div>
            </dl>
          ) : null}
          {isDocument ? (
            <Field id="fonte-chi-la-vede" label={T.writeFact.visibility}>
              <ChoiceSelect id="fonte-chi-la-vede" value={source.visibility} items={VISIBILITY_ITEMS} disabled={busy} onChange={setVisibility} />
            </Field>
          ) : isAnswers ? (
            purged ? null : (
              <div className="space-y-2 text-sm">
                <p className="text-muted-foreground">{T.notes.answerSource}</p>
                {source.useCaseId ? (
                  <Link
                    href={`/dashboard/${workspaceId}/use-cases/${encodeURIComponent(source.useCaseId)}?capitolo=cosa-serve`}
                    className="inline-flex min-h-11 items-center gap-0.5 font-medium underline underline-offset-4 outline-none focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0"
                  >
                    {T.notes.openUseCase}
                    <ChevronRight aria-hidden className="size-4" />
                  </Link>
                ) : null}
              </div>
            )
          ) : purged ? (
            <p className="text-sm text-muted-foreground">{T.notes.purged}</p>
          ) : source.body ? (
            <div className="max-h-[50dvh] overflow-y-auto rounded-lg border bg-muted/20 p-3 text-sm leading-relaxed break-words whitespace-pre-wrap">{source.body}</div>
          ) : null}
          {source.participants || source.link || source.addedByName ? (
            <dl className="space-y-3 text-sm">
              {source.participants ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{T.notes.participants}</dt>
                  <dd className="mt-0.5 break-words">{source.participants}</dd>
                </div>
              ) : null}
              {source.link ? (
                <div>
                  <dt className="text-xs text-muted-foreground">{T.notes.link}</dt>
                  <dd className="mt-0.5 break-all">
                    <a href={source.link} target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">
                      {source.link}
                    </a>
                  </dd>
                </div>
              ) : null}
              {source.addedByName ? <p className="text-xs text-muted-foreground">{T.notes.addedBy(source.addedByName, dayLabel(source.createdAt, today))}</p> : null}
            </dl>
          ) : null}
          {notReported.length > 0 ? (
            <ul className="space-y-1 text-xs text-muted-foreground">
              {notReported.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </ContextSheet>
  );
}
