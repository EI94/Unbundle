import { CheckCircle } from "lucide-react";
import { UcAccessError, ensureUcAvailable, getUcUserContext, isUcEnabledFor, ucLsDomains } from "@/lib/db/queries/uc-access";
import { loadSubprocessorAck, type SubprocessorAck } from "@/lib/db/queries/uc-subprocessors";
import { getAppUcExecutor } from "@/lib/db/uc-executor";
import { subprocessorAcksReady } from "@/lib/db/queries/context-consent";
import { referentStoreReady } from "@/lib/db/queries/use-case-referent-base";
import { referentAskEnabled } from "@/lib/use-cases/referent/availability";
import {
  SUBPROCESSORS,
  SUBPROCESSORS_POWERS_TEXT,
  SUBPROCESSORS_VERSION,
  subprocessorDeclarerOf,
  subprocessorsDeclaredLine,
  subprocessorsLsButton,
  subprocessorsLsStatement,
  subprocessorsStatement,
  subprocessorsWaitingLine,
} from "@/lib/uc/legal/subprocessors";
import { ucLogError } from "@/lib/uc/log";
import type { UserContext } from "@/lib/uc/types";
import { SETTINGS_TEXT } from "./settings-text";
import { SubprocessorsForm } from "./subprocessors-form";
import { SuppliersSection } from "./suppliers-section";

const DAY = new Intl.DateTimeFormat("it-IT", { day: "numeric", month: "short", year: "numeric", timeZone: "Europe/Rome" });

/**
 * Se il workspace ha la sezione dei fornitori: dove i dossier sono accesi, dove è accesa «Chiedi al referente» (le sue
 * email vogliono la stessa autorizzazione) con i suoi archivi pronti; (rilascio 9a) oppure, in ogni altro workspace, se
 * la tabella dell'ok esiste: le funzioni AI di «Contesto», la chat dell'intervista iniziale e la lettura dei PDF vogliono
 * la stessa autorizzazione, e l'ok si deve poter dare ovunque.
 */
export async function subprocessorsShown(workspaceId: string): Promise<boolean> {
  if (isUcEnabledFor(workspaceId)) return true;
  if (referentAskEnabled(workspaceId, process.env) && (await referentStoreReady())) return true;
  return subprocessorAcksReady();
}

/**
 * Impostazioni › Privacy › «Fornitori dei dati» (GDPR art. 28, par. 2; prima «Sub-responsabili»): lo stato in una riga
 * e, nel pannello, l'elenco dei fornitori di Lateral Space, il testo e l'autorizzazione del cliente. Componente server,
 * montato con una riga nella scheda. Senza la sezione (`subprocessorsShown`), o se la lettura non riesce, non mostra
 * nulla e il resto della pagina resta com'è.
 *
 * (Rilascio 5.1) Una persona di Lateral Space con un ruolo da revisore che autorizza registra l'ok per conto del
 * cliente con un clic («Registra l'ok di {cliente}», un pulsante non pieno, senza la casella dei poteri); la riga
 * dell'ok dato dice chi l'ha registrato e quando, anche per una riga scritta a mano che comincia con «Registrato da
 * Lateral Space». (Rilascio 10, ondata 6b) Al cliente che autorizza, «Autorizza» è il pulsante pieno della scheda.
 */
export async function SubprocessorsCard({
  workspaceId,
  workspaceName,
  userId,
  workspaceRole,
  initialPanel = null,
}: {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  workspaceRole: string;
  /** `?apri=` letto sul server: `fornitori` apre il pannello. */
  initialPanel?: string | null;
}) {
  if (!(await subprocessorsShown(workspaceId))) return null;
  const dossiers = isUcEnabledFor(workspaceId);
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
  const declarer = ack ? null : subprocessorDeclarerOf(user, workspaceRole, ucLsDomains());
  const T = SETTINGS_TEXT.privacy;

  return (
    <SuppliersSection
      summary={ack ? { tone: "verde", label: `Autorizzati il ${DAY.format(ack.declaredAt)}` } : { tone: "giallo", label: T.pending }}
      action={declarer === "cliente" ? { label: T.authorize, filled: true } : declarer === "lateral_space" ? { label: subprocessorsLsButton(workspaceName), filled: false } : null}
      initialPanel={initialPanel}
    >
      <ul className="divide-y rounded-lg border" data-testid="subprocessors-list">
        {SUBPROCESSORS.map((s) => (
          <li key={s.nome} className="grid gap-0.5 px-3 py-2.5 text-sm">
            <span className="font-medium">{s.nome}</span>
            <span className="text-muted-foreground">{s.cosaFa}</span>
            <span className="text-xs text-muted-foreground">{s.doveStannoIDati}</span>
          </li>
        ))}
      </ul>
      <div data-testid="subprocessors-state">
        {ack ? (
          <p className="flex items-start gap-2 text-sm">
            <CheckCircle className="mt-0.5 size-4 shrink-0 text-uc-verde" aria-hidden />
            <span data-registered-by={ack.registeredBy}>{subprocessorsDeclaredLine({ ...ack, companyName: workspaceName })}</span>
          </p>
        ) : declarer === "cliente" ? (
          <SubprocessorsForm workspaceId={workspaceId} listVersion={SUBPROCESSORS_VERSION} statement={subprocessorsStatement(workspaceName)} powersText={SUBPROCESSORS_POWERS_TEXT} />
        ) : declarer === "lateral_space" ? (
          <SubprocessorsForm workspaceId={workspaceId} listVersion={SUBPROCESSORS_VERSION} statement={subprocessorsLsStatement(workspaceName)} oneClickLabel={subprocessorsLsButton(workspaceName)} />
        ) : (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed whitespace-pre-line">{subprocessorsStatement(workspaceName)}</p>
            <p className="text-sm text-muted-foreground">{subprocessorsWaitingLine(workspaceName)}</p>
          </div>
        )}
      </div>
    </SuppliersSection>
  );
}
