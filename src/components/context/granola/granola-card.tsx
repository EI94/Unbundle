/**
 * Il blocco «Granola» delle Impostazioni (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.9).
 *
 * È un componente server asincrono: legge da sé lo stato (`loadGranolaStatus`, e le regole se c'è un collegamento) e
 * decide da sé che cosa mostrare. A chi non è di Lateral Space niente: nemmeno la cornice.
 *
 * | Stato | Che cosa si vede |
 * |---|---|
 * | Non disponibile | «Il collegamento con Granola non è ancora attivo.» |
 * | Non collegato | Che cosa legge Unbundle, «Collega Granola» |
 * | Collegato | L'account e il piano, «Scollega»; sotto, per questo workspace, quali call sono del cliente |
 * | Da ricollegare | «Il collegamento è scaduto.», «Ricollega» |
 *
 * È già montato in `settings/page.tsx`, dentro «Integrazioni», in un contenitore con `id="granola"` (l'ancora a cui
 * tornano il collegamento e il link dalla pagina «Contesto»): il blocco non mette un altro `id`.
 */
import { NotebookPen } from "lucide-react";
import { SettingsSection } from "@/components/dashboard/settings-section";
import { auth } from "@/lib/auth";
import { granolaCardState, granolaFlashLine } from "@/lib/context/granola/view";
import { contextActorFor } from "@/lib/context/server/actor";
import { CONTEXT_TEXT } from "@/lib/context/text";
import { contextAbilities } from "@/lib/context/visibility";
import { loadGranolaStatus, readGranolaRules } from "@/lib/db/queries/context-granola";
import { GranolaCardPanel } from "./granola-card-panel";

export interface GranolaCardProps {
  workspaceId: string;
  workspaceName: string;
  userId: string;
  role: string;
  /** `?granola=…` dell'indirizzo, dopo il ritorno da Granola (§8.2): `collegato`, `annullato`, `scaduto`, `errore`. */
  flash?: string;
}

export async function GranolaCard(props: GranolaCardProps) {
  const session = await auth();
  if (!session?.user?.id || session.user.id !== props.userId) return null;
  const actor = contextActorFor(session.user, { role: props.role }, props.workspaceId);
  // Solo Lateral Space: per gli altri il blocco non c'è.
  if (!contextAbilities(actor).canUseGranola) return null;
  const status = await loadGranolaStatus({ userId: props.userId, workspaceId: props.workspaceId });
  const state = granolaCardState(status);
  const rules = state === "collegato" ? await readGranolaRules(actor) : null;
  const T = CONTEXT_TEXT.granola;
  return (
    <SettingsSection icon={NotebookPen} iconClassName="bg-uc-giallo-bg text-uc-giallo" title={T.cardTitle} description={T.cardDescription}>
      <GranolaCardPanel
        workspaceId={props.workspaceId}
        workspaceName={props.workspaceName}
        state={state}
        accountEmail={status.accountEmail}
        plan={status.plan}
        rules={rules}
        flash={granolaFlashLine(props.flash)}
      />
    </SettingsSection>
  );
}
