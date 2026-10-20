import { notFound } from "next/navigation";
import { Activity, FileText, ShieldAlert, Target, Users } from "lucide-react";
import { PageContainer } from "@/components/dashboard/page-container";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { LeverIcons } from "@/components/uc/common/lever-icons";
import { MembersPanel } from "@/components/uc/people/members-panel";
import { canWrite, openShellPage } from "@/components/uc/shell/case-data";
import { CaseStatusControl, type StatusOption } from "@/components/uc/shell/case-status-control";
import { TechDetails } from "@/components/uc/ui/tech-details";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import { ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadCaseSettings, loadStatusOptions } from "@/lib/db/queries/uc-people-view";
import { loadCaseMembers, loadMemberCandidates } from "@/lib/db/queries/uc-shell";
import { CASE_STATUS_LABEL } from "@/lib/uc/case-state";
import { transitionHint, transitionNeedsReason } from "@/lib/uc/views/case-shell";
import { groupMembers } from "@/lib/uc/views/people";
import type { CaseStatus } from "@/lib/uc/vocab";
import { CaseIdentityForm, RevokeAllLinks, ScopeLeversForm } from "./settings-forms";

/**
 * Impostazioni del caso (DESIGN §3.13.3, WP6): solo il responsabile Lateral
 * Space, gli altri ricevono 404. Stessa forma delle Impostazioni del
 * workspace: H1 «Impostazioni», blocchi `SettingsSection`. La riga sopra il
 * titolo con il nome del caso qui non c'è: la pagina sta dentro il guscio del
 * dossier e la testata lo nomina subito sopra.
 *
 * - «Il caso»: nome e frase. Il codice è quello dello use case: si legge e non
 *   si cambia qui; il codice di prima, se diverso, sta in «Dettagli tecnici»
 *   con lo schema di partenza.
 * - «Perimetro e leve»: il testo del perimetro e le 8 leve come interruttori.
 * - «Accesso al caso»: membri e ruoli (prima in Persone).
 * - «Stato del caso» (`#stato`): pausa, ripresa, chiusura, con il motivo.
 * - «Zona pericolosa»: «Revoca tutti i link dei referenti», «Chiudi il caso».
 *
 * In pausa restano solo «Riprendi», la chiusura e la revoca dei link; a caso
 * chiuso la pagina si legge soltanto.
 */
export default async function CaseSettingsPage({ params }: { params: Promise<{ workspaceId: string; caseId: string }> }) {
  const { workspaceId, caseId } = await params;
  const { session, access } = await requireWorkspacePage(workspaceId);
  const { caseAccess, executor, ctx } = await openShellPage({ workspaceId, caseId, session, access, page: "impostazioni" });
  const write = canWrite(caseAccess);
  const lsDomains = ucLsDomains();
  const [settings, status, memberRows, candidates] = await Promise.all([
    loadCaseSettings(executor, { workspaceId, caseId }),
    write ? loadStatusOptions(executor, ctx) : Promise.resolve(null),
    loadCaseMembers(executor, { workspaceId, caseId, lsDomains }),
    write ? loadMemberCandidates(executor, { workspaceId, lsDomains }) : Promise.resolve([]),
  ]);
  if (!settings) notFound();

  const current = settings.status;
  const paused = current === "sospeso";
  const editable = write && !paused;
  const option = (to: CaseStatus): StatusOption => ({ to, label: CASE_STATUS_LABEL[to], hint: transitionHint(current, to), needsReason: transitionNeedsReason(to) });
  // Il passo avanti è il primario della testata; qui pausa, ripresa, chiusura e il ritorno allo sviluppo.
  const stateOptions = (status?.allowed ?? [])
    .filter((to) => to === "sospeso" || to === "chiuso" || paused || (to === "in_sviluppo" && current !== "pronto_sviluppo"))
    .map(option);
  const closeOption = stateOptions.filter((o) => o.to === "chiuso");

  return (
    <PageContainer>
      <header className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight sm:text-3xl">Impostazioni</h1>
      </header>

      <div className="mt-6 space-y-6">
        <SettingsSection id="il-caso" icon={FileText} title="Il caso" description="Nome e frase si leggono in testata.">
          <div className="space-y-5">
            <div className="space-y-1">
              <p className="text-sm">
                <span className="text-muted-foreground">Codice </span>
                <span className="font-medium tabular-nums">{settings.displayCode}</span>
              </p>
              <p className="text-xs text-muted-foreground">
                {settings.useCaseCode ? "È il codice dello use case: si legge e non si cambia qui." : "Il codice non si cambia: entra nei testi firmati."}
              </p>
            </div>
            {editable ? (
              <CaseIdentityForm workspaceId={workspaceId} caseId={caseId} title={settings.title} oneLiner={settings.oneLiner} />
            ) : (
              <dl className="grid gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted-foreground">Nome</dt>
                  <dd className="break-words">{settings.title}</dd>
                </div>
                {settings.oneLiner && (
                  <div>
                    <dt className="text-xs text-muted-foreground">In una frase</dt>
                    <dd className="break-words">{settings.oneLiner}</dd>
                  </div>
                )}
              </dl>
            )}
            <TechDetails roles={caseAccess.roles}>
              <p>
                Schema di partenza: {settings.templateName} · versione {settings.templateVersion}
              </p>
              {settings.previousCode && <p>Codice precedente del dossier: {settings.previousCode}</p>}
            </TechDetails>
          </div>
        </SettingsSection>

        <SettingsSection id="perimetro" icon={Target} title="Perimetro e leve" description="Che cosa entra nel dossier e dove porta valore.">
          {editable ? (
            <ScopeLeversForm workspaceId={workspaceId} caseId={caseId} perimeterLabel={settings.perimeterLabel} levers={settings.levers} />
          ) : (
            <div className="space-y-3 text-sm">
              {settings.perimeterLabel && <p className="break-words">{settings.perimeterLabel}</p>}
              <LeverIcons active={settings.levers} />
              {!settings.perimeterLabel && settings.levers.length === 0 && <p className="text-muted-foreground">Non ancora indicati.</p>}
            </div>
          )}
        </SettingsSection>

        <SettingsSection id="accesso" icon={Users} title="Accesso al caso" description="Chi ha un account e il suo ruolo nel dossier. «Lateral Space» o «Cliente» dipende dal dominio dell'email verificata.">
          <MembersPanel
            workspaceId={workspaceId}
            caseId={caseId}
            members={groupMembers(memberRows, { withEmail: true })}
            candidates={candidates.map((m) => ({ userId: m.userId, name: m.name, isLateralSpace: m.isLateralSpace }))}
            canManage={editable}
          />
        </SettingsSection>

        <SettingsSection
          id="stato"
          icon={Activity}
          title="Stato del caso"
          description={`Adesso: ${CASE_STATUS_LABEL[current]}. Il passo avanti è il pulsante in alto; qui ci sono pausa, ripresa e chiusura.`}
        >
          {stateOptions.length > 0 ? (
            <CaseStatusControl workspaceId={workspaceId} caseId={caseId} current={current} transitions={stateOptions} />
          ) : (
            <p className="text-sm text-muted-foreground">{current === "chiuso" ? "Il caso è chiuso: si può solo leggere." : "Nessun cambio di stato da qui, adesso."}</p>
          )}
        </SettingsSection>

        {write && (
          <SettingsSection
            id="zona-pericolosa"
            icon={ShieldAlert}
            iconClassName="bg-red-500/10 text-red-600 dark:text-red-400"
            tone="danger"
            title="Zona pericolosa"
            description="Azioni che non si annullano. Le risposte già arrivate restano."
          >
            <div className="flex flex-wrap gap-2">
              <RevokeAllLinks workspaceId={workspaceId} caseId={caseId} />
              {closeOption.length > 0 && <CaseStatusControl workspaceId={workspaceId} caseId={caseId} current={current} transitions={closeOption} />}
            </div>
          </SettingsSection>
        )}
      </div>
    </PageContainer>
  );
}
