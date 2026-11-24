"use client";

import { useState, type Ref } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ConfirmDialog, useSubmitConfirmation } from "@/components/ui/confirm-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useUcAction } from "@/components/uc/catalog/use-uc-action";
import type { StartTemplate } from "@/components/uc/realization/start-data";
import { startRealizationAction } from "@/lib/actions/uc-realization";
import { REALIZATION_TEXT } from "@/lib/uc/views/realization";
import { START_TEMPLATE_TEXT, needsLargeTemplateConfirm } from "@/lib/uc/views/start-templates";

/**
 * La scelta dello schema di partenza (R2 di `docs/dossier/SCHEMA-DI-PARTENZA.md`), la stessa nella pagina di ripiego
 * e nel dialogo della scheda: scelto all'apertura solo `preselectedId` («Dal caso d'uso»), mai uno schema riservato;
 * gli altri schemi si aprono da soli solo se non c'è niente da proporre; nasconderli non lascia scelto uno che non si
 * vede più (si torna a quello dell'apertura).
 */
export function useStartTemplatePicker(templates: readonly StartTemplate[], otherTemplates: readonly StartTemplate[], preselectedId: string | null) {
  const all = [...templates, ...otherTemplates];
  const initial = all.find((t) => t.id === preselectedId && !t.restricted) ?? null;
  const [templateId, setTemplateId] = useState<string | null>(initial?.id ?? null);
  const [showOthers, setShowOthers] = useState(templates.length === 0);
  const template = all.find((t) => t.id === templateId) ?? null;

  function toggleOthers() {
    if (showOthers && otherTemplates.some((t) => t.id === templateId)) setTemplateId(initial?.id ?? null);
    setShowOthers(!showOthers);
  }

  return { all, initial, template, templateId, setTemplateId, showOthers, toggleOthers };
}

/**
 * Gli schemi tra cui scegliere (R2): i proposti («Dal caso d'uso» per primo, poi gli schemi di settore che combaciano
 * con lo use case), gli altri dietro «Mostra anche gli altri schemi», con la loro avvertenza. Ogni scelta ha la sua
 * riga «per che tipo di caso · N domande». `focusRef` va sulla scelta fatta, altrimenti sulla prima che si vede.
 */
export function StartTemplatePicker({
  name,
  labelledBy,
  label,
  templates,
  otherTemplates,
  templateId,
  onChoose,
  showOthers,
  onToggleOthers,
  disabled,
  focusRef,
}: {
  /** Il nome del gruppo di radio. */
  name: string;
  labelledBy?: string;
  label?: string;
  templates: readonly StartTemplate[];
  otherTemplates: readonly StartTemplate[];
  templateId: string | null;
  onChoose: (id: string) => void;
  showOthers: boolean;
  onToggleOthers: () => void;
  disabled: boolean;
  focusRef?: Ref<HTMLInputElement>;
}) {
  const visible = showOthers ? [...templates, ...otherTemplates] : templates;
  const focusId = visible.some((t) => t.id === templateId) ? templateId : (visible[0]?.id ?? null);
  const option = (t: StartTemplate) => (
    <label
      key={t.id}
      className="flex min-h-11 min-w-0 cursor-pointer items-start gap-3 rounded-lg border border-border p-3 hover:bg-muted has-checked:border-uc-blu has-checked:bg-uc-blu-bg has-disabled:cursor-not-allowed has-disabled:opacity-70"
    >
      <input
        ref={t.id === focusId ? focusRef : undefined}
        type="radio"
        name={name}
        value={t.id}
        checked={templateId === t.id}
        onChange={() => onChoose(t.id)}
        disabled={disabled}
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
      <div role="radiogroup" aria-labelledby={labelledBy} aria-label={labelledBy ? undefined : label} className="grid min-w-0 gap-2">
        {templates.map(option)}
        {showOthers && otherTemplates.length > 0 && (
          <>
            {templates.length > 0 && <p className="pt-1 text-xs text-muted-foreground">{START_TEMPLATE_TEXT.othersHint}</p>}
            {otherTemplates.map(option)}
          </>
        )}
      </div>
      {otherTemplates.length > 0 && templates.length > 0 && (
        <Button type="button" variant="ghost" className="h-11 px-2 sm:h-8" onClick={onToggleOthers} disabled={disabled} aria-expanded={showOthers}>
          {showOthers ? START_TEMPLATE_TEXT.hideOthers(otherTemplates.length) : START_TEMPLATE_TEXT.showOthers(otherTemplates.length)}
        </Button>
      )}
    </>
  );
}

/**
 * «Avvia la realizzazione» in una schermata (DESIGN §3.2), la pagina di ripiego del dialogo della scheda (rilascio 10,
 * §3.5): use case, frase e schema di partenza. (F-020) Niente campo «Nome»: il nome è il titolo dello use case, e si
 * cambia nelle Impostazioni della realizzazione. Il modulo non manda il codice: il server lo prende dallo use case,
 * insieme ai testi della descrizione. Il dossier nasce in bozza e chi lo avvia ne è il responsabile; poi si apre la
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
  const choice = useStartTemplatePicker(templates, otherTemplates, preselectedId);
  const { all, template } = choice;
  const title = defaults.title;
  const [oneLiner, setOneLiner] = useState(defaults.oneLiner);
  const titleOk = title.trim().length >= 3;

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

  return (
    <>
      <form onSubmit={submit} className="min-w-0 space-y-6" aria-busy={pending}>
        <div className="min-w-0 space-y-5">
          <div className={row}>
            <p className="text-sm text-muted-foreground">Use case</p>
            <p className="min-w-0 text-sm break-words">
              {useCase.code && <span className="font-mono font-medium">{useCase.code} · </span>}
              {useCase.title}
            </p>
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
                <StartTemplatePicker
                  name="realizzazione-schema"
                  labelledBy="realizzazione-schema-label"
                  templates={templates}
                  otherTemplates={otherTemplates}
                  templateId={choice.templateId}
                  onChoose={choice.setTemplateId}
                  showOthers={choice.showOthers}
                  onToggleOthers={choice.toggleOthers}
                  disabled={pending}
                />
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

        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-end">
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
