"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { startRealizationAction } from "@/lib/actions/uc-realization";
import { formatCountIt } from "@/lib/uc/views/format";
import { REALIZATION_TEXT } from "@/lib/uc/views/realization";

export interface StartTemplate {
  id: string;
  name: string;
  questions: number;
  /** Riservato a questo workspace: viene prima nell'elenco. */
  restricted: boolean;
}

function templateLabel(t: StartTemplate): string {
  return `${t.name} · ${t.questions === 1 ? "1 domanda" : `${formatCountIt(t.questions)} domande`}`;
}

/**
 * «Avvia la realizzazione» in una schermata (DESIGN §3.2): use case (non si
 * cambia), nome, frase e schema di partenza. Il modulo non manda il codice: il
 * server lo prende dallo use case, insieme ai testi della descrizione. Il
 * dossier nasce in bozza e chi lo avvia ne è il responsabile; poi si apre la
 * sua Panoramica.
 */
export function StartRealizationForm({
  workspaceId,
  useCase,
  defaults,
  templates,
}: {
  workspaceId: string;
  useCase: { id: string; code: string | null; title: string };
  defaults: { title: string; oneLiner: string };
  templates: readonly StartTemplate[];
}) {
  const router = useRouter();
  const { pending, run } = useUcAction();
  const [title, setTitle] = useState(defaults.title);
  const [oneLiner, setOneLiner] = useState(defaults.oneLiner);
  const [templateId, setTemplateId] = useState<string | null>(templates[0]?.id ?? null);
  const [choosing, setChoosing] = useState(false);
  const template = templates.find((t) => t.id === templateId) ?? null;
  const titleOk = title.trim().length >= 3;

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template || !titleOk || pending) return;
    // Un errore arriva solo come toast (`useUcAction`), come negli altri moduli uc.
    run(() => startRealizationAction(workspaceId, { useCaseId: useCase.id, templateId: template.id, title: title.trim(), oneLiner: oneLiner.trim() || null }), {
      onSuccess: (data) => router.push(`/dashboard/${workspaceId}/casi-duso/${data.caseId}`),
      onError: (message) => {
        // Qualcuno l'ha appena avviato: la pagina riletta porta al dossier (o alla scheda, per chi non lo apre).
        if (message === REALIZATION_TEXT.alreadyStarted) router.refresh();
      },
    });
  }

  const row = "grid min-w-0 gap-1.5 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-baseline sm:gap-4";
  const items = templates.map((t) => ({ value: t.id, label: templateLabel(t) }));

  return (
    <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
      <div className="min-w-0 space-y-5">
        <div className={row}>
          <p className="text-sm text-muted-foreground">Use case</p>
          <p className="min-w-0 text-sm break-words">
            {useCase.code && <span className="font-mono font-medium">{useCase.code} · </span>}
            {useCase.title}
            <span className="ml-2 text-xs text-muted-foreground">non si cambia</span>
          </p>
        </div>
        <div className={row}>
          <Label htmlFor="realizzazione-nome" className="text-muted-foreground">
            Nome
          </Label>
          <Input id="realizzazione-nome" value={title} maxLength={255} onChange={(e) => setTitle(e.target.value)} disabled={pending} className="h-11 text-base sm:h-9 sm:text-sm" aria-invalid={!titleOk} />
        </div>
        <div className={row}>
          <Label htmlFor="realizzazione-frase" className="text-muted-foreground">
            In una frase
          </Label>
          <div className="min-w-0 space-y-1">
            <Input id="realizzazione-frase" value={oneLiner} maxLength={500} onChange={(e) => setOneLiner(e.target.value)} disabled={pending} className="h-11 text-base sm:h-9 sm:text-sm" />
            <p className="text-xs text-muted-foreground">Facoltativo.</p>
          </div>
        </div>
        <div className={row}>
          <p id="realizzazione-schema-label" className="text-sm text-muted-foreground">
            Schema di partenza
          </p>
          {templates.length === 0 ? (
            <p className="text-sm">{REALIZATION_TEXT.noTemplates}</p>
          ) : choosing && templates.length > 1 ? (
            <Select items={items} value={templateId} onValueChange={(v) => setTemplateId(typeof v === "string" ? v : null)}>
              <SelectTrigger aria-labelledby="realizzazione-schema-label" className="min-h-11 w-full sm:min-h-8">
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
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
              <p className="min-w-0 text-sm break-words">{template ? templateLabel(template) : ""}</p>
              {templates.length > 1 && (
                <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={() => setChoosing(true)} disabled={pending}>
                  Cambia
                </Button>
              )}
            </div>
          )}
        </div>
      </div>

      {pending && (
        <div role="status" className="space-y-2">
          <p className="text-sm">{REALIZATION_TEXT.creating}</p>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full w-1/3 animate-pulse rounded-full bg-uc-blu" />
          </div>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-xs text-muted-foreground sm:max-w-sm">{REALIZATION_TEXT.footnote}</p>
        <Button type="submit" className="h-11 shrink-0 sm:h-9" disabled={!template || !titleOk || pending}>
          {REALIZATION_TEXT.start}
        </Button>
      </div>
    </form>
  );
}
