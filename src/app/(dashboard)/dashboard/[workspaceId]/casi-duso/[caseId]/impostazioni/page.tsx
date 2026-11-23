import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { canWrite, openShellPage } from "@/components/uc/shell/case-data";
import { CaseStatusControl, type StatusOption } from "@/components/uc/shell/case-status-control";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadCaseSettings, loadStatusOptions } from "@/lib/db/queries/uc-people-view";
import { readStartContext } from "@/lib/db/queries/uc-realization";
import { planReschema } from "@/lib/db/queries/uc-reschema";
import { countFromUseCaseQuestions, ensureFromUseCaseTemplate, listTemplatesForWorkspace } from "@/lib/db/queries/uc-templates";
import type { UcExecutor } from "@/lib/db/uc-executor";
import { CASE_STATUS_LABEL } from "@/lib/uc/case-state";
import { errorCodeOf, ucLog } from "@/lib/uc/log";
import { isFromUseCaseTemplateKey } from "@/lib/uc/template/from-use-case";
import { SCHEMA_CHANGE_TEXT, SETTINGS_TEXT, statusHint } from "@/lib/uc/views/case-settings";
import { settingsTransitions, transitionNeedsReason } from "@/lib/uc/views/case-shell";
import { startTemplateOptions, type StartTemplateChoice } from "@/lib/uc/views/start-templates";
import type { CaseStatus } from "@/lib/uc/vocab";
import { CaseIdentityForm, ChangeStartingSchema, RevokeAllLinks, type SchemaBlocker } from "./settings-forms";

const SECTION_TITLE = "text-sm font-semibold";

/**
 * Impostazioni della realizzazione (rilascio 10, §3.5; §3.21 dell'audit): solo il responsabile Lateral Space, gli
 * altri ricevono 404. Il titolo è un H2, sotto l'H1 della testata. Tre sezioni:
 *
 * - «La realizzazione»: nome, frase e perimetro, con un «Salva»; lo schema di partenza e, in «Bozza», «Cambia schema
 *   di partenza…» (R3 di `docs/dossier/SCHEMA-DI-PARTENZA.md`); codice, versione dello schema e codice precedente in
 *   «Dettagli tecnici».
 * - «Pausa» (`#pausa`; la vecchia ancora `#stato` porta qui): «Metti in pausa…», «Riprendi», «Torna allo sviluppo…».
 * - «Zona pericolosa»: «Revoca i link…» e «Chiudi la realizzazione…», una volta sola.
 *
 * Gli account sono in Persone › «Nella realizzazione», le leve in Valore. In pausa restano «Riprendi», la chiusura e la
 * revoca dei link; a realizzazione chiusa la pagina si legge soltanto.
 */
export default async function CaseSettingsPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, ctx } = await openShellPage({ workspaceId, caseId, session, access, page: "impostazioni" });
  const write = canWrite(caseAccess);
  const [settings, status] = await Promise.all([loadCaseSettings(executor, { workspaceId, caseId }), write ? loadStatusOptions(executor, ctx) : Promise.resolve(null)]);
  if (!settings) notFound();

  const current = settings.status;
  const paused = current === "sospeso";
  const editable = write && !paused;
  // Lo schema si cambia solo in «Bozza»; senza la lettura (errore, nessuno schema) il pulsante non c'è.
  const schemaChange = editable && current === "bozza" ? await loadSchemaChange(executor, { workspaceId, caseId, useCaseId: settings.useCaseId }) : null;
  const option = (to: CaseStatus): StatusOption => ({ to, label: CASE_STATUS_LABEL[to], hint: statusHint(current, to), needsReason: transitionNeedsReason(to) });
  // Il passo avanti è il primario della testata; qui pausa, ripresa e il ritorno allo sviluppo, la chiusura in «Zona pericolosa».
  const transitions = settingsTransitions(current, status?.allowed ?? []);
  const stateOptions = transitions.state.map(option);
  const closeOption = transitions.danger.map(option);
  const T = SETTINGS_TEXT;

  return (
    <PageContainer>
      <div className="max-w-3xl space-y-8">
        <h2 className="text-base font-semibold">{T.title}</h2>

        <section id="realizzazione" aria-labelledby="uc-settings-realization" className="scroll-mt-28 space-y-4">
          <h3 id="uc-settings-realization" className={SECTION_TITLE}>
            {T.realization}
          </h3>
          {editable ? (
            <CaseIdentityForm workspaceId={workspaceId} caseId={caseId} title={settings.title} oneLiner={settings.oneLiner} perimeterLabel={settings.perimeterLabel} />
          ) : (
            <dl className="grid gap-3 text-sm">
              <div>
                <dt className="text-xs text-muted-foreground">{T.name}</dt>
                <dd className="break-words">{settings.title}</dd>
              </div>
              {settings.oneLiner && (
                <div>
                  <dt className="text-xs text-muted-foreground">{T.oneLiner}</dt>
                  <dd className="break-words">{settings.oneLiner}</dd>
                </div>
              )}
              {settings.perimeterLabel && (
                <div>
                  <dt className="text-xs text-muted-foreground">{T.perimeter}</dt>
                  <dd className="break-words">{settings.perimeterLabel}</dd>
                </div>
              )}
            </dl>
          )}
          <div className="min-w-0 space-y-2">
            <p className="text-sm break-words">
              <span className="text-muted-foreground">{SCHEMA_CHANGE_TEXT.label}: </span>
              {settings.templateName}
            </p>
            {schemaChange && (
              <ChangeStartingSchema
                workspaceId={workspaceId}
                caseId={caseId}
                currentId={schemaChange.currentId}
                proposed={schemaChange.choice.proposed}
                others={schemaChange.choice.others}
                preselectedId={schemaChange.choice.preselectedId}
                blockers={schemaChange.blockers}
              />
            )}
          </div>
          <TechDetails roles={caseAccess.roles} copyValue={settings.displayCode}>
            <p>{T.code(settings.displayCode)}</p>
            <p>{T.template(settings.templateName, settings.templateVersion)}</p>
            {settings.previousCode && <p>{T.previousCode(settings.previousCode)}</p>}
          </TechDetails>
        </section>

        <section id="pausa" aria-labelledby="uc-settings-pause" className="scroll-mt-28 space-y-3 border-t pt-6">
          {/* La vecchia ancora: il passo «Riprendi la realizzazione» e i link già partiti dicono `#stato`. */}
          <span id="stato" className="block scroll-mt-28" aria-hidden />
          <h3 id="uc-settings-pause" className={SECTION_TITLE}>
            {T.pause}
          </h3>
          {stateOptions.length > 0 ? (
            <CaseStatusControl workspaceId={workspaceId} caseId={caseId} current={current} transitions={stateOptions} />
          ) : (
            <p className="text-sm text-muted-foreground">{current === "chiuso" ? T.closed : T.noChange}</p>
          )}
        </section>

        {write && (
          <section id="zona-pericolosa" aria-labelledby="uc-settings-danger" className="scroll-mt-28 space-y-3 rounded-xl p-4 ring-1 ring-destructive/30 sm:p-5">
            <div className="space-y-1">
              <h3 id="uc-settings-danger" className={SECTION_TITLE}>
                {T.danger}
              </h3>
              <p className="text-sm text-muted-foreground">{T.dangerNote}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <RevokeAllLinks workspaceId={workspaceId} caseId={caseId} />
              {closeOption.length > 0 && <CaseStatusControl workspaceId={workspaceId} caseId={caseId} current={current} transitions={closeOption} />}
            </div>
          </section>
        )}
      </div>
    </PageContainer>
  );
}

interface SchemaChangeData {
  currentId: string;
  choice: StartTemplateChoice;
  blockers: SchemaBlocker[];
}

/**
 * Le scelte di «Cambia schema di partenza» e le domande che lo impediscono (R3). «Dal caso d'uso» c'è in ogni
 * workspace (la riga si crea alla prima lettura, sempre la stessa) e ha senso solo con uno use case; gli schemi di
 * settore si propongono come in «Avvia la realizzazione» (`startTemplateOptions`). Le domande che bloccano non
 * dipendono dallo schema scelto: si leggono una volta, con il piano verso il primo schema proposto. Un errore toglie
 * solo il pulsante, mai la pagina.
 */
async function loadSchemaChange(executor: UcExecutor, i: { workspaceId: string; caseId: string; useCaseId: string | null }): Promise<SchemaChangeData | null> {
  try {
    const ensured = await ensureFromUseCaseTemplate(executor);
    if (!ensured.ok) ucLog({ level: "warn", area: "uc", op: "impostazioni.dal_caso", code: ensured.code, workspaceId: i.workspaceId, caseId: i.caseId });
    const [templates, context, fromUseCaseQuestions] = await Promise.all([
      listTemplatesForWorkspace(executor, i.workspaceId),
      i.useCaseId ? readStartContext(executor, { workspaceId: i.workspaceId, useCaseId: i.useCaseId }) : Promise.resolve(null),
      i.useCaseId ? countFromUseCaseQuestions(executor, i.workspaceId, i.useCaseId) : Promise.resolve(0),
    ]);
    const sources = templates
      .map((t) => ({
        id: t.id,
        key: t.key,
        name: t.name,
        archetype: t.archetype,
        industry: t.industry,
        functionArea: t.functionArea,
        restricted: t.restricted,
        questions: t.questions,
        fromUseCase: isFromUseCaseTemplateKey(t.key),
      }))
      // Senza use case non ci sono voci di «Cosa serve» da cui partire.
      .filter((t) => i.useCaseId !== null || !t.fromUseCase);
    const choice = startTemplateOptions(sources, {
      fromUseCaseQuestions,
      useCase: { title: context?.title ?? "", problem: context?.texts.problem ?? null, flow: context?.texts.flow ?? null },
    });
    const target = choice.proposed[0] ?? choice.others[0];
    if (!target) return null;
    const plan = await planReschema(executor, { workspaceId: i.workspaceId, caseId: i.caseId, to: target.fromUseCase ? "dal_caso" : { templateId: target.id } });
    if (!plan.ok) {
      ucLog({ level: "warn", area: "uc", op: "impostazioni.schema", code: plan.code, workspaceId: i.workspaceId, caseId: i.caseId });
      return null;
    }
    return {
      currentId: plan.value.from.id,
      choice,
      blockers: plan.value.blockers.map((b) => ({ itemId: b.itemId, title: b.title, reasons: [...b.reasons] })),
    };
  } catch (error) {
    ucLog({ level: "warn", area: "uc", op: "impostazioni.schema", code: errorCodeOf(error), workspaceId: i.workspaceId, caseId: i.caseId });
    return null;
  }
}
