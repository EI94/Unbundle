"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import type { StartFormData } from "@/components/uc/realization/start-data";
import { StartTemplatePicker, useStartTemplatePicker } from "@/components/uc/shell/create-wizard";
import { startRealizationAction } from "@/lib/actions/uc-realization";
import { REALIZATION_TEXT } from "@/lib/uc/views/realization";
import { START_DIALOG_TEXT as T } from "@/lib/uc/views/start-dialog";
import { START_TEMPLATE_TEXT, needsLargeTemplateConfirm } from "@/lib/uc/views/start-templates";
import { PREFILL_TEXT } from "@/lib/use-cases/realization-prefill";
import { StartContext } from "./start-realization-context";

/**
 * (Rilascio 10, docs/ui-10/PROPOSTA-10.md §3.5, F-019…F-024) «Avvia la realizzazione» è un dialogo sulla scheda dello
 * use case: «Parte la realizzazione di XX-0012», lo schema di partenza con «Cambia schema» solo se ce n'è più di uno,
 * «Annulla» e «Avvia», il suo pulsante pieno. Niente campo «Nome»: il nome è il titolo dello use case (si cambia in
 * Impostazioni della realizzazione); «In una frase» arriva già compilata. I «Dati raccolti da Claude» di una scheda del
 * connettore stanno in una piega chiusa; senza prefisso dei codici il dialogo lo dice e porta alle Impostazioni.
 * L'azione è quella di prima (`startRealizationAction`); dopo, la Panoramica della realizzazione. La pagina
 * `/casi-duso/nuovo` resta come ripiego (senza JavaScript il pulsante è il suo link).
 *
 * Lo schema di partenza segue le regole della pagina di ripiego (R2 di `docs/dossier/SCHEMA-DI-PARTENZA.md`): scelto
 * all'apertura solo «Dal caso d'uso» (`preselectedId`), mai uno schema riservato; «Cambia schema» apre la stessa scelta
 * (`StartTemplatePicker`: i proposti, gli altri dietro «Mostra anche gli altri schemi», ogni schema con la sua riga);
 * senza uno schema scelto la scelta è già aperta. Oltre 50 domande, «Avvia» chiede prima nel dialogo se lo schema è
 * quello giusto.
 */
export function StartRealizationHost({ workspaceId, data, children }: { workspaceId: string; data: StartFormData | null; children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const show = useCallback(() => setOpen(true), []);
  const value = useMemo(() => (data ? show : null), [data, show]);
  return (
    <StartContext value={value}>
      {children}
      {data ? <StartRealizationDialog workspaceId={workspaceId} data={data} open={open} onOpenChange={setOpen} /> : null}
    </StartContext>
  );
}

function StartRealizationDialog({ workspaceId, data, open, onOpenChange }: { workspaceId: string; data: StartFormData; open: boolean; onOpenChange: (open: boolean) => void }) {
  const router = useRouter();
  const { pending, run } = useUcAction();
  const choice = useStartTemplatePicker(data.templates, data.otherTemplates, data.preselectedId);
  const { all, template } = choice;
  // Senza uno schema scelto all'apertura (mai uno riservato) la scelta è già aperta.
  const [choosing, setChoosing] = useState(choice.initial === null);
  // «Cambia schema» lascia il posto alla scelta: il fuoco passa lì, non torna in cima al dialogo.
  const chooserRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => {
    if (choosing) chooserRef.current?.focus();
  }, [choosing]);
  // Oltre 50 domande, prima di avviare, la domanda della pagina di ripiego: il primo «Avvia» chiede, il secondo avvia.
  const large = template !== null && needsLargeTemplateConfirm(template.questions);
  const [asking, setAsking] = useState(false);
  const ready = !data.codeMissing && template !== null;

  function choose(id: string) {
    choice.setTemplateId(id);
    setAsking(false);
  }

  function toggleOthers() {
    choice.toggleOthers();
    setAsking(false);
  }

  /** «Scegli un altro schema»: via la domanda, il fuoco sulla scelta. */
  function chooseAnother() {
    setAsking(false);
    if (choosing) chooserRef.current?.focus();
    else setChoosing(true);
  }

  function close(next: boolean) {
    if (!next) setAsking(false);
    onOpenChange(next);
  }

  function start() {
    if (!template || pending) return;
    if (large && !asking) {
      setAsking(true);
      return;
    }
    run(() => startRealizationAction(workspaceId, { useCaseId: data.useCase.id, templateId: template.id, title: data.defaults.title, oneLiner: data.defaults.oneLiner.trim() || null }), {
      onSuccess: (created) => router.push(`/dashboard/${workspaceId}/casi-duso/${created.caseId}`),
      onError: (message) => {
        // Qualcuno l'ha appena avviata: la scheda riletta porta alla realizzazione.
        if (message === REALIZATION_TEXT.alreadyStarted) {
          close(false);
          router.refresh();
        }
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && close(next)}>
      <DialogContent data-slot="start-realization-dialog" className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{T.title(data.useCase.code, data.useCase.title)}</DialogTitle>
          <DialogDescription>
            {data.codeMissing ? REALIZATION_TEXT.noPrefix : template ? T.template(template) : all.length === 0 ? REALIZATION_TEXT.noTemplates : START_TEMPLATE_TEXT.chooseOne}
          </DialogDescription>
        </DialogHeader>
        {!data.codeMissing && all.length > 0 ? (
          choosing ? (
            <div className="min-w-0 space-y-2">
              <StartTemplatePicker
                name="avvia-schema"
                label={T.chooseLabel}
                templates={data.templates}
                otherTemplates={data.otherTemplates}
                templateId={choice.templateId}
                onChoose={choose}
                showOthers={choice.showOthers}
                onToggleOthers={toggleOthers}
                disabled={pending}
                focusRef={chooserRef}
              />
            </div>
          ) : all.length > 1 ? (
            <div>
              <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={() => setChoosing(true)} disabled={pending}>
                {T.change}
              </Button>
            </div>
          ) : null
        ) : null}
        {!data.codeMissing && template?.fromUseCase && template.questions === 0 ? <p className="text-xs text-muted-foreground">{START_TEMPLATE_TEXT.fromUseCaseEmpty}</p> : null}
        {asking && large && template ? (
          <div role="alert" className="space-y-1 rounded-lg border border-border p-3 text-sm">
            <p className="font-medium">{START_TEMPLATE_TEXT.largeTitle(template.questions)}</p>
            <p className="text-muted-foreground">{START_TEMPLATE_TEXT.largeBody}</p>
          </div>
        ) : null}
        {data.prefillRows.length > 0 ? (
          <details data-slot="collected-by-claude" className="rounded-lg border px-3 text-sm">
            <summary className="flex min-h-11 cursor-pointer items-center font-medium sm:min-h-9">{PREFILL_TEXT.title}</summary>
            <p className="text-muted-foreground">{PREFILL_TEXT.hint}</p>
            <dl className="my-3 grid min-w-0 gap-3">
              {data.prefillRows.map((row) => (
                <div key={row.label} className="min-w-0">
                  <dt className="text-xs text-muted-foreground">{row.label}</dt>
                  <dd className="mt-0.5 break-words whitespace-pre-line">{row.value}</dd>
                </div>
              ))}
            </dl>
          </details>
        ) : null}
        {pending ? (
          <p role="status" className="text-sm text-muted-foreground">
            {REALIZATION_TEXT.creating}
          </p>
        ) : null}
        <DialogFooter>
          {asking && large ? (
            <Button type="button" variant="outline" className="h-11 sm:h-8" disabled={pending} onClick={chooseAnother}>
              {START_TEMPLATE_TEXT.largeCancel}
            </Button>
          ) : (
            <Button type="button" variant="outline" className="h-11 sm:h-8" disabled={pending} onClick={() => close(false)}>
              {T.cancel}
            </Button>
          )}
          {data.codeMissing ? (
            <Button className="h-11 sm:h-8" render={<Link href={`/dashboard/${workspaceId}/settings`} />} nativeButton={false}>
              {T.settings}
            </Button>
          ) : (
            <Button type="button" className="h-11 sm:h-8" disabled={!ready || pending} onClick={start}>
              {pending ? T.starting : asking && large ? START_TEMPLATE_TEXT.largeConfirm : T.start}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
