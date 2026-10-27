import { CheckCircle, ShieldCheck } from "lucide-react";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { UcAccessError, ensureUcAvailable, getUcUserContext, isUcEnabledFor, ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadSubprocessorAck, type SubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { referentStoreReady } from "@/lib/db/queries/use-case-referent-base";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import {
  SUBPROCESSORS,
  SUBPROCESSORS_POWERS_TEXT,
  SUBPROCESSORS_VERSION,
  canDeclareSubprocessors,
  subprocessorsDeclaredLine,
  subprocessorsStatement,
  subprocessorsWaitingLine,
} from "@/lib/uc/legal/subprocessors";
import { ucLogError } from "@/lib/uc/log";
import type { UserContext } from "@/lib/uc/types";
import { SubprocessorsForm } from "./subprocessors-form";

/**
 * Impostazioni › «Sub-responsabili» (GDPR art. 28, par. 2): l'elenco dei fornitori
 * di Lateral Space e l'autorizzazione del cliente. Componente server, montato con
 * una riga nella pagina delle impostazioni. Solo dove la sezione Casi d'uso è
 * accesa per il workspace e lo schema uc è aggiornato, oppure dove è accesa «Chiedi al referente»
 * (le sue email vogliono la stessa autorizzazione) con i suoi archivi pronti; altrimenti, o se la
 * lettura non riesce, non mostra nulla e il resto della pagina resta com'è.
 */
export async function SubprocessorsCard({
  workspaceId,
  workspaceName,
  userId,
  workspaceRole,
}: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  workspaceRole: string;
}) {
  const dossiers = isUcEnabledFor(workspaceId);
  if (!dossiers && !(referentAskEnabled(workspaceId, process.env) && (await referentStoreReady()))) return null;
  let ack: SubprocessorAck | null;
  let user: UserContext | null;
  try {
    if (dossiers) await ensureUcAvailable(workspaceId);
    const executor = await getAppUcExecutor();
    [ack, user] = await Promise.all([loadSubprocessorAck(executor, workspaceId), getUcUserContext(userId)]);
  } catch (error) {
    if (!(error instanceof UcAccessError)) ucLogError({ area: "uc", op: "sub_responsabili", workspaceId }, error);
    return null;
  }
  const canDeclare = !ack && canDeclareSubprocessors(user, workspaceRole, ucLsDomains());

  return (
    <SettingsSection
      id="sub-responsabili"
      icon={ShieldCheck}
      iconClassName="bg-sky-500/10 text-sky-400"
      title="Sub-responsabili"
      description="I fornitori a cui Lateral Space affida parte del trattamento dei dati."
    >
      <ul className="divide-y rounded-lg border" data-testid="subprocessors-list">
        {SUBPROCESSORS.map((s) => (
          <li key={s.nome} className="grid gap-0.5 px-3 py-2.5 text-sm @2xl:grid-cols-[9rem_1fr_auto] @2xl:items-baseline @2xl:gap-4">
            <span className="font-medium">{s.nome}</span>
            <span className="text-muted-foreground">{s.cosaFa}</span>
            <span className="text-xs text-muted-foreground @2xl:text-right">{s.doveStannoIDati}</span>
          </li>
        ))}
      </ul>
      <div className="mt-5" data-testid="subprocessors-state">
        {ack ? (
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle className="mt-0.5 size-4 shrink-0 text-green-400" aria-hidden />
            {subprocessorsDeclaredLine(ack)}
          </p>
        ) : canDeclare ? (
          <SubprocessorsForm
            workspaceId={workspaceId}
            listVersion={SUBPROCESSORS_VERSION}
            statement={subprocessorsStatement(workspaceName)}
            powersText={SUBPROCESSORS_POWERS_TEXT}
          />
        ) : (
          <p className="text-sm text-muted-foreground">{subprocessorsWaitingLine(workspaceName)}</p>
        )}
      </div>
    </SettingsSection>
  );
}
