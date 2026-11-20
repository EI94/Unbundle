"use client";

import { useCallback, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import type { StartFormData, StartTemplate } from "@/components/uc/realization/start-data";
import { startRealizationAction } from "@/lib/actions/uc-realization";
import { REALIZATION_TEXT } from "@/lib/uc/views/realization";
import { START_DIALOG_TEXT as T, startTemplateLabel } from "@/lib/uc/views/start-dialog";
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
  const [templateId, setTemplateId] = useState<string | null>(data.templates[0]?.id ?? null);
  const [choosing, setChoosing] = useState(false);
  const template: StartTemplate | null = data.templates.find((t) => t.id === templateId) ?? null;
  const items = data.templates.map((t) => ({ value: t.id, label: startTemplateLabel(t) }));
  const ready = !data.codeMissing && template !== null;

  function start() {
    if (!template || pending) return;
    run(() => startRealizationAction(workspaceId, { useCaseId: data.useCase.id, templateId: template.id, title: data.defaults.title, oneLiner: data.defaults.oneLiner.trim() || null }), {
      onSuccess: (created) => router.push(`/dashboard/${workspaceId}/casi-duso/${created.caseId}`),
      onError: (message) => {
        // Qualcuno l'ha appena avviata: la scheda riletta porta alla realizzazione.
        if (message === REALIZATION_TEXT.alreadyStarted) {
          onOpenChange(false);
          router.refresh();
        }
      },
    });
  }

  return (
    <Dialog open={open} onOpenChange={(next) => !pending && onOpenChange(next)}>
      <DialogContent data-slot="start-realization-dialog">
        <DialogHeader>
          <DialogTitle>{T.title(data.useCase.code, data.useCase.title)}</DialogTitle>
          <DialogDescription>{data.codeMissing ? REALIZATION_TEXT.noPrefix : template ? T.template(template) : REALIZATION_TEXT.noTemplates}</DialogDescription>
        </DialogHeader>
        {!data.codeMissing && data.templates.length > 1 ? (
          choosing ? (
            <Select items={items} value={templateId} onValueChange={(v) => setTemplateId(typeof v === "string" ? v : null)}>
              <SelectTrigger aria-label={T.chooseLabel} className="min-h-11 w-full text-base sm:min-h-8 sm:text-sm">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {items.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          ) : (
            <div>
              <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={() => setChoosing(true)} disabled={pending}>
                {T.change}
              </Button>
            </div>
          )
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
          <Button type="button" variant="outline" className="h-11 sm:h-8" disabled={pending} onClick={() => onOpenChange(false)}>
            {T.cancel}
          </Button>
          {data.codeMissing ? (
            <Button className="h-11 sm:h-8" render={<Link href={`/dashboard/${workspaceId}/settings`} />} nativeButton={false}>
              {T.settings}
            </Button>
          ) : (
            <Button type="button" className="h-11 sm:h-8" disabled={!ready || pending} onClick={start}>
              {pending ? T.starting : T.start}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
