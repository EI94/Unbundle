import Link from "next/link";
import { ensureUcAvailable, getUcUserContext, isUcEnabledFor } from "@/lib/db/queries/uc-access";
import { loadSubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { subprocessorsLsNoticeParts } from "@/lib/uc/legal/subprocessors";
import { ucLogError } from "@/lib/uc/log";
import { cn } from "@/lib/utils";

/**
 * Solo per Lateral Space, con la sezione Casi d'uso accesa: il cliente non ha ancora autorizzato
 * i sub-responsabili della versione corrente. Un errore non rompe la pagina: niente avviso e una
 * riga di log.
 */
export async function subprocessorsPendingForLs(workspaceId: string, userId: string): Promise<boolean> {
  if (!isUcEnabledFor(workspaceId)) return false;
  try {
    await ensureUcAvailable(workspaceId);
    const user = await getUcUserContext(userId);
    if (!user?.isLateralSpace) return false;
    return (await loadSubprocessorAck(await getAppUcExecutor(), workspaceId)) === null;
  } catch (error) {
    ucLogError({ area: "uc", op: "sub_responsabili", workspaceId }, error);
    return false;
  }
}

/**
 * L'avviso discreto con il link a «Impostazioni › Sub-responsabili», da mostrare quando
 * `subprocessorsPendingForLs` è vero: con l'area «Use case» accesa sta sulla Roadmap, dove stanno
 * i dossier in realizzazione (la lista dei Casi d'uso ha il suo, uguale).
 */
export function SubprocessorsLsNotice({
  workspaceId,
  workspaceName,
  className,
}: {
  workspaceId: string;
  workspaceName: string | null | undefined;
  className?: string;
}) {
  const notice = subprocessorsLsNoticeParts(workspaceName);
  return (
    <p className={cn("text-sm text-muted-foreground", className)} data-testid="subprocessors-notice">
      {notice.before}
      <Link href={`/dashboard/${workspaceId}/settings#sub-responsabili`} className="underline underline-offset-4 hover:text-foreground">
        {notice.link}
      </Link>
      {notice.after}
    </p>
  );
}
