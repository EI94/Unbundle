import { notFound } from "next/navigation";
import { PageContainer } from "@/components/dashboard/page-container";
import { canWrite, openShellPage } from "@/components/uc/shell/case-data";
import { CaseStatusControl, type StatusOption } from "@/components/uc/shell/case-status-control";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { loadCaseSettings, loadStatusOptions } from "@/lib/db/queries/uc-people-view";
import { CASE_STATUS_LABEL } from "@/lib/uc/case-state";
import { SETTINGS_TEXT, statusHint } from "@/lib/uc/views/case-settings";
import { settingsTransitions, transitionNeedsReason } from "@/lib/uc/views/case-shell";
import type { CaseStatus } from "@/lib/uc/vocab";
import { CaseIdentityForm, RevokeAllLinks } from "./settings-forms";

const SECTION_TITLE = "text-sm font-semibold";

/**
 * Impostazioni della realizzazione (rilascio 10, §3.5; §3.21 dell'audit): solo il responsabile Lateral Space, gli
 * altri ricevono 404. Il titolo è un H2, sotto l'H1 della testata. Tre sezioni:
 *
 * - «La realizzazione»: nome, frase e perimetro, con un «Salva»; codice, schema di partenza e codice precedente in
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
