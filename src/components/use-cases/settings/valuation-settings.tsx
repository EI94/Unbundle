import { ChevronRight, Scale } from "lucide-react";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { ScoringModelForm } from "@/components/portfolio/scoring-model-form";
import { requireSession } from "@/lib/auth/redirect-to-login";
import { logSafeError } from "@/lib/log/safe-error";
import { isUseCaseHubWorkspace } from "@/lib/use-cases/rollout";
import { VALUATION_SETTINGS_TEXT } from "@/lib/use-cases/settings";
import { loadValuationSettings, type ValuationSettingsData } from "@/lib/use-cases/settings-data";
import { getCollaboratorAccess } from "@/lib/workspace-access";
import { canManageWorkspaceSettings } from "@/lib/workspace-permissions";
import { CodePrefixField } from "./code-prefix-field";
import { CostBandsField } from "./cost-bands-field";
import { TeamNameField } from "./team-name-field";
import { ThresholdsField } from "./thresholds-field";
import { ValueParamsField } from "./value-params-field";
import { VALUE_PARAMS_TEXT } from "@/lib/use-cases/value-params-form";

const TEXT = VALUATION_SETTINGS_TEXT;

/**
 * Impostazioni › Valutazione (docs/use-case/DESIGN.md §7.2, §10.6, §14.2, §14.3; PIANO-LAVORI
 * H3d): nome del team che valuta, prefisso dei codici, soglie, fasce del costo, «Ipotesi di
 * calcolo» di «Benefici e costi» e modello di valutazione, in un posto solo.
 *
 * Componente server, montato con una riga nella pagina delle impostazioni (H4i): controlla
 * da sé l'area e chi guarda, e non mostra nulla con l'area spenta per il workspace (§12.1: lì
 * vale ancora il pannello di oggi) né a chi non gestisce il workspace. Le action rifanno gli
 * stessi controlli. Un guasto della lettura non ferma il resto delle impostazioni.
 */
export async function ValuationSettings({ workspaceId, id }: { workspaceId: string; id?: string }) {
  if (!isUseCaseHubWorkspace(workspaceId)) return null;
  const session = await requireSession();
  const access = await getCollaboratorAccess(session.user.id, workspaceId);
  if (!access || !canManageWorkspaceSettings(access.role)) return null;

  let data: ValuationSettingsData | null;
  try {
    data = await loadValuationSettings(workspaceId);
  } catch (error) {
    logSafeError("use-case-settings", "load_failed", error);
    data = null;
  }
  if (!data) {
    return <SettingsSection id={id} icon={Scale} iconClassName="bg-amber-500/10 text-amber-500" title={TEXT.section} description={TEXT.loadError} />;
  }

  const { thresholds } = data;
  // Le soglie tengono i valori nel loro stato: si rimontano quando la pagina si ricarica con
  // soglie diverse (le action la ricaricano). Il modulo del modello no: non manda «Valore alto
  // da» (lo aggiunge la sua action, quello salvato), così un salvataggio delle soglie non butta
  // le sue modifiche non salvate.
  const thresholdsKey = `soglie-${thresholds.highImpact}-${thresholds.costLowBand}-${data.costBands.map((band) => band.label).join("|")}`;

  return (
    <SettingsSection
      id={id}
      icon={Scale}
      iconClassName="bg-amber-500/10 text-amber-500"
      title={TEXT.section}
      description={TEXT.sectionDescription}
    >
      <div className="divide-y [&>*]:py-6 [&>*:first-child]:pt-0 [&>*:last-child]:pb-0" data-slot="valuation-settings">
        <TeamNameField workspaceId={workspaceId} initialName={data.teamName} />
        <CodePrefixField
          workspaceId={workspaceId}
          initialPrefix={data.codes.prefix}
          saved={data.codes.saved}
          connectorEnabled={data.codes.connectorEnabled}
        />
        <ThresholdsField
          key={thresholdsKey}
          workspaceId={workspaceId}
          initial={{ highImpact: thresholds.highImpact, costLowBand: thresholds.costLowBand }}
          midImpact={thresholds.midImpact}
          bands={data.costBands}
        />
        <CostBandsField workspaceId={workspaceId} bands={data.costBands} />
        <details className="group" data-slot="value-params-settings">
          <summary className="flex cursor-pointer list-none items-start gap-2 text-sm outline-none marker:hidden focus-visible:underline [&::-webkit-details-marker]:hidden">
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
            <span className="flex min-w-0 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:gap-2">
              <span className="font-semibold">{VALUE_PARAMS_TEXT.title}</span>
              <span className="text-xs text-muted-foreground">{VALUE_PARAMS_TEXT.hint}</span>
            </span>
          </summary>
          <div className="mt-4">
            <ValueParamsField
              key={`ipotesi-${JSON.stringify(data.valueParams)}-${data.storedOriginMonth ?? ""}`}
              workspaceId={workspaceId}
              initial={data.valueParams}
              storedOriginMonth={data.storedOriginMonth}
            />
          </div>
        </details>
        <details className="group">
          <summary className="flex cursor-pointer list-none items-start gap-2 text-sm outline-none marker:hidden focus-visible:underline [&::-webkit-details-marker]:hidden">
            <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-90" aria-hidden />
            {/* Su una colonna stretta l'aiuto va sotto il titolo, invece di spezzarlo. */}
            <span className="flex min-w-0 flex-col gap-0.5 @md:flex-row @md:items-baseline @md:gap-2">
              <span className="font-semibold">{TEXT.model.title}</span>
              <span className="text-xs text-muted-foreground">{TEXT.model.hint}</span>
            </span>
          </summary>
          <div className="mt-4">
            <ScoringModelForm
              workspaceId={workspaceId}
              initialConfig={data.scoringConfig}
              esgEnabled={data.esgEnabled}
              inSettings
            />
          </div>
        </details>
      </div>
    </SettingsSection>
  );
}
