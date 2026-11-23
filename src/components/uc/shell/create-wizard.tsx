"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import { startRealizationAction } from "@/lib/actions/uc-realization";
import { REALIZATION_TEXT } from "@/lib/uc/views/realization";
import { START_TEMPLATE_TEXT, needsLargeTemplateConfirm, type StartTemplateOption } from "@/lib/uc/views/start-templates";

/**
 * Uno schema di partenza tra cui scegliere: nome, riga «per che tipo di caso · N
 * domande» (`startTemplateOptions`), se è riservato al workspace e se è «Dal
 * caso d'uso».
 */
export type StartTemplate = StartTemplateOption;

/**
 * «Avvia la realizzazione» in una schermata (DESIGN §3.2): use case (non si
 * cambia), nome, frase e schema di partenza. Il modulo non manda il codice: il
 * server lo prende dallo use case, insieme ai testi della descrizione. Il
 * dossier nasce in bozza e chi lo avvia ne è il responsabile; poi si apre la
 * sua Panoramica.
 *
 * Lo schema di partenza (R2 di `docs/dossier/SCHEMA-DI-PARTENZA.md`) si vede
 * sempre: «Dal caso d'uso» per primo e scelto all'apertura (`preselectedId`, mai
 * uno schema riservato), poi gli schemi di settore che combaciano con lo use
 * case; gli altri dietro «Mostra anche gli altri schemi». Ogni scelta ha la sua
 * riga «per che tipo di caso · N domande». Oltre 50 domande, prima di avviare,
 * una finestra chiede se lo schema è quello giusto.
 */
export function StartRealizationForm({
  workspaceId,
  useCase,
  defaults,
  templates,
  otherTemplates = [],
  preselectedId,
}: {
  workspaceId: string;
  useCase: { id: string; code: string | null; title: string };
  defaults: { title: string; oneLiner: string };
  /** Gli schemi proposti, già in ordine: «Dal caso d'uso» per primo. */
  templates: readonly StartTemplate[];
  /** Gli schemi che non combaciano con lo use case: si vedono solo a richiesta. */
  otherTemplates?: readonly StartTemplate[];
  /** Lo schema scelto all'apertura: «Dal caso d'uso», mai uno riservato; null = nessuno. */
  preselectedId: string | null;
}) {
  const router = useRouter();
  const { pending, run } = useUcAction();
  const confirmation = useSubmitConfirmation<StartTemplate>();
  const all = [...templates, ...otherTemplates];
  const initial = all.find((t) => t.id === preselectedId && !t.restricted) ?? null;
  const [title, setTitle] = useState(defaults.title);
  const [oneLiner, setOneLiner] = useState(defaults.oneLiner);
  const [templateId, setTemplateId] = useState<string | null>(initial?.id ?? null);
  // Gli altri schemi si aprono da soli solo se non c'è niente da proporre.
  const [showOthers, setShowOthers] = useState(templates.length === 0);
  const template = all.find((t) => t.id === templateId) ?? null;
  const titleOk = title.trim().length >= 3;

  /** Nascondere gli altri schemi non lascia scelto uno che non si vede più: si torna a quello dell'apertura. */
  function toggleOthers() {
    if (showOthers && otherTemplates.some((t) => t.id === templateId)) setTemplateId(initial?.id ?? null);
    setShowOthers(!showOthers);
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!template || !titleOk || pending) return;
    // Uno schema grande si conferma prima: la conferma rimanda lo stesso modulo.
    if (needsLargeTemplateConfirm(template.questions) && !confirmation.ask(event, template)) return;
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
  const option = (t: StartTemplate) => (
    <label
      key={t.id}
      className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted has-checked:border-uc-blu has-checked:bg-uc-blu-bg has-disabled:cursor-not-allowed has-disabled:opacity-70"
    >
      <input
        type="radio"
        name="realizzazione-schema"
        value={t.id}
        checked={templateId === t.id}
        onChange={() => setTemplateId(t.id)}
        disabled={pending}
        className="mt-0.5 size-4 shrink-0 accent-uc-blu"
      />
      <span className="grid min-w-0 gap-0.5">
        <span className="text-sm break-words">{t.name}</span>
        <span className="text-xs text-muted-foreground">{t.line}</span>
      </span>
    </label>
  );

  return (
    <>
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
              {START_TEMPLATE_TEXT.label}
            </p>
            {all.length === 0 ? (
              <p className="text-sm">{REALIZATION_TEXT.noTemplates}</p>
            ) : (
              <div className="min-w-0 space-y-2">
                <div role="radiogroup" aria-labelledby="realizzazione-schema-label" className="grid min-w-0 gap-2">
                  {templates.map(option)}
                  {showOthers && otherTemplates.length > 0 && (
                    <>
                      {templates.length > 0 && <p className="pt-1 text-xs text-muted-foreground">{START_TEMPLATE_TEXT.othersHint}</p>}
                      {otherTemplates.map(option)}
                    </>
                  )}
                </div>
                {otherTemplates.length > 0 && templates.length > 0 && (
                  <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={toggleOthers} disabled={pending} aria-expanded={showOthers}>
                    {showOthers ? START_TEMPLATE_TEXT.hideOthers(otherTemplates.length) : START_TEMPLATE_TEXT.showOthers(otherTemplates.length)}
                  </Button>
                )}
                {!template && <p className="text-xs text-muted-foreground">{START_TEMPLATE_TEXT.chooseOne}</p>}
                {template?.fromUseCase && template.questions === 0 && <p className="text-xs text-muted-foreground">{START_TEMPLATE_TEXT.fromUseCaseEmpty}</p>}
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
      {/* Fuori dal modulo, come gli altri: la conferma lo rimanda con `requestSubmit`. */}
      <ConfirmDialog
        open={confirmation.open}
        onOpenChange={confirmation.onOpenChange}
        title={START_TEMPLATE_TEXT.largeTitle(confirmation.target?.questions ?? 0)}
        description={START_TEMPLATE_TEXT.largeBody}
        confirmLabel={START_TEMPLATE_TEXT.largeConfirm}
        cancelLabel={START_TEMPLATE_TEXT.largeCancel}
        pending={pending}
        onConfirm={confirmation.confirm}
      />
    </>
  );
}
