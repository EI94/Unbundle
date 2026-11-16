"use client";

import { useEffect, useState, useTransition } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { reconfirmFactAction, retireFactAction, editFactAction } from "@/lib/actions/context";
import { dayLabel } from "@/lib/context/labels";
import { CONTEXT_TEXT } from "@/lib/context/text";
import type { ContextVisibility } from "@/lib/context/vocab";
import type { FactDetail } from "@/lib/db/queries/context-memory";
import { ContextSheet } from "./context-sheet";
import { ChoiceSelect, Field, Mark, nameOfUseCase, type UseCaseOption } from "./fields";
import { LsLock } from "./fact-row";
import { factUrl, getJson } from "./read-client";
import { factMarks, sectionLabel } from "./view-model";
import { VISIBILITY_ITEMS, WriteFactForm } from "./write-fact-form";

const T = CONTEXT_TEXT;

type Loaded = { status: "caricamento" } | { status: "pronto"; fact: FactDetail } | { status: "errore"; message: string };

/**
 * Il pannello di un fatto (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §7.2). Per chi apre la pagina: la
 * fonte, l'ultima conferma, gli use case. Per Lateral Space anche la citazione, la storia («Prima: …»), chi ha
 * confermato, e le azioni: «Modifica», «Ancora vero», «Non più vero», «Per tutti / Solo Lateral Space».
 * Il fatto si rilegge dalla rotta a ogni apertura e dopo ogni azione: la versione è sempre quella di adesso.
 */
export function FactSheet({
  workspaceId,
  factId,
  today,
  canEdit,
  useCaseOptions,
  onClose,
}: {
  workspaceId: string;
  factId: string | null;
  today: string;
  canEdit: boolean;
  useCaseOptions: readonly UseCaseOption[];
  onClose: () => void;
}) {
  // Il fatto aperto può cambiare id: un testo nuovo è una versione nuova.
  const [current, setCurrent] = useState<string | null>(factId);
  const [shown, setShown] = useState<string | null>(factId);
  if (factId !== shown) {
    setShown(factId);
    setCurrent(factId);
  }
  return (
    <FactSheetBody
      key={current ?? "chiuso"}
      workspaceId={workspaceId}
      factId={current}
      today={today}
      canEdit={canEdit}
      useCaseOptions={useCaseOptions}
      onClose={onClose}
      onReplaced={(next) => setCurrent(next)}
    />
  );
}

function FactSheetBody({
  workspaceId,
  factId,
  today,
  canEdit,
  useCaseOptions,
  onClose,
  onReplaced,
}: {
  workspaceId: string;
  factId: string | null;
  today: string;
  canEdit: boolean;
  useCaseOptions: readonly UseCaseOption[];
  onClose: () => void;
  onReplaced: (factId: string) => void;
}) {
  const [loaded, setLoaded] = useState<Loaded>({ status: "caricamento" });
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  const [askRetire, setAskRetire] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!factId) return;
    const controller = new AbortController();
    getJson<FactDetail>(fetch, factUrl(workspaceId, factId), controller.signal)
      .then((result) => setLoaded(result.ok ? { status: "pronto", fact: result.value } : { status: "errore", message: result.message }))
      .catch(() => undefined);
    return () => controller.abort();
  }, [workspaceId, factId, reload]);

  const fact = loaded.status === "pronto" ? loaded.fact : null;
  const title = fact?.statement ?? T.page.title;

  const act = (work: () => Promise<{ ok: true } | { ok: false; message: string }>, done: string, after: "reload" | "close") => {
    startTransition(async () => {
      const result = await work();
      if (!result.ok) {
        toast.error(result.message);
        setReload((n) => n + 1);
        return;
      }
      toast.success(done);
      if (after === "close") onClose();
      else setReload((n) => n + 1);
    });
  };

  const setVisibility = (visibility: ContextVisibility) => {
    if (!fact || visibility === fact.visibility) return;
    act(() => editFactAction(workspaceId, fact.id, fact.version, { visibility }), T.fact.saved, "reload");
  };

  return (
    <ContextSheet
      open={factId !== null}
      onOpenChange={(open) => (open ? undefined : onClose())}
      title={title}
      footer={
        fact && canEdit && !editing ? (
          askRetire ? (
            <div className="space-y-3">
              <p className="text-sm">{T.fact.retireConfirm}</p>
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => setAskRetire(false)}>
                  {T.notes.cancel}
                </Button>
                <Button type="button" variant="destructive" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => act(() => retireFactAction(workspaceId, fact.id, fact.version), T.fact.retired, "close")}>
                  {T.fact.noLongerTrue}
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-end">
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => setEditing(true)}>
                {T.fact.edit}
              </Button>
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => act(() => reconfirmFactAction(workspaceId, fact.id), T.fact.reconfirmed, "reload")}>
                {T.fact.stillTrue}
              </Button>
              <Button type="button" variant="outline" className="min-h-11 sm:min-h-8" disabled={pending} onClick={() => setAskRetire(true)}>
                {T.fact.noLongerTrue}
              </Button>
            </div>
          )
        ) : undefined
      }
    >
      {loaded.status === "caricamento" ? (
        <div className="space-y-3" aria-busy="true">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : loaded.status === "errore" ? (
        <p role="alert" className="text-sm text-muted-foreground">
          {loaded.message}
        </p>
      ) : editing && fact ? (
        <WriteFactForm
          workspaceId={workspaceId}
          useCaseOptions={useCaseOptions}
          editing={{ id: fact.id, version: fact.version, statement: fact.statement, section: fact.section, visibility: fact.visibility, useCaseIds: fact.useCases.map((u) => u.id) }}
          onCancel={() => setEditing(false)}
          onDone={(next) => {
            setEditing(false);
            if (next !== fact.id) onReplaced(next);
            else setReload((n) => n + 1);
          }}
        />
      ) : fact ? (
        <FactDetails fact={fact} today={today} canEdit={canEdit} pending={pending} onVisibility={setVisibility} />
      ) : null}
    </ContextSheet>
  );
}

function FactDetails({ fact, today, canEdit, pending, onVisibility }: { fact: FactDetail; today: string; canEdit: boolean; pending: boolean; onVisibility: (v: ContextVisibility) => void }) {
  const marks = factMarks(fact);
  const confirmedOn = dayLabel(fact.lastConfirmedOn, today);
  return (
    <>
      <dl className="space-y-4 text-sm">
        {marks.inferred || marks.toCheck || marks.lsOnly ? (
          <div className="flex flex-wrap items-center gap-1.5">
            {marks.inferred ? <Mark>{T.fact.inferred}</Mark> : null}
            {marks.toCheck ? <Mark>{T.fact.toCheck}</Mark> : null}
            {marks.lsOnly ? (
              <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                <LsLock />
                <span aria-hidden>{T.fact.lsOnly}</span>
              </span>
            ) : null}
          </div>
        ) : null}
        <div>
          <dt className="text-xs text-muted-foreground">{T.fact.source}</dt>
          <dd className="mt-0.5">
            {fact.source ? `${fact.sourceLabel} · ${fact.source.title}` : fact.sourceLabel}
            <span className="block text-xs text-muted-foreground">{`${sectionLabel(fact.section)}${confirmedOn ? ` · ${T.fact.lastConfirmed(confirmedOn)}` : ""}`}</span>
          </dd>
        </div>
        {fact.quote ? (
          <div>
            <dt className="text-xs text-muted-foreground">{T.fact.quote}</dt>
            <dd className="mt-0.5 leading-relaxed text-muted-foreground">
              <q>{fact.quote}</q>
            </dd>
          </div>
        ) : null}
        {fact.useCases.length > 0 ? (
          <div>
            <dt className="text-xs text-muted-foreground">{T.fact.useCases}</dt>
            <dd className="mt-1">
              <ul className="space-y-1">
                {fact.useCases.map((useCase) => (
                  <li key={useCase.id}>{useCase.code ? `${nameOfUseCase(useCase)} · ${useCase.title}` : useCase.title}</li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {fact.history.length > 0 ? (
          <div>
            <dt className="text-xs text-muted-foreground">{T.fact.history}</dt>
            <dd className="mt-1">
              <ul className="space-y-2">
                {fact.history.map((version, index) => (
                  <li key={`${version.from}-${index}`} className="leading-relaxed">
                    {T.fact.before(version.statement)}
                    <span className="block text-xs text-muted-foreground">{[version.sourceLabel, dayLabel(version.from, today)].filter(Boolean).join(" · ")}</span>
                  </li>
                ))}
              </ul>
            </dd>
          </div>
        ) : null}
        {fact.confirmedBy ? <p className="text-xs text-muted-foreground">{T.fact.confirmedBy(fact.confirmedBy.name, dayLabel(fact.confirmedBy.on, today))}</p> : null}
      </dl>
      {canEdit ? (
        <Field id="fatto-chi-lo-vede" label={T.writeFact.visibility}>
          <ChoiceSelect id="fatto-chi-lo-vede" value={fact.visibility} items={VISIBILITY_ITEMS} disabled={pending} onChange={onVisibility} />
        </Field>
      ) : null}
    </>
  );
}
