/**
 * Granola nella pagina «Contesto» (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.7, §8.9): la riga «Aggiorna
 * da Granola» e «Da smistare». Il pacchetto «pagina» lo monta nei due punti del §7: con `compact` nella vista «Memoria»
 * (una riga sola, e solo se c'è qualcosa da dire), senza nella vista «Fonti» (il blocco intero). (Rilascio 10, §3.7) Nel
 * blocco intero, con un collegamento attivo, anche le regole delle call di questo cliente, chiuse.
 *
 * È un componente server asincrono: legge da sé chi guarda e lo stato, e non mostra niente a chi non è di Lateral Space
 * o dove Granola non è attivo. Se l'ultimo giro ha più di 30 minuti, il pannello lo fa partire da solo.
 */
import { contextActorFromSession } from "@/lib/context/server/actor";
import { contextAbilities } from "@/lib/context/visibility";
import { loadGranolaStatus, readGranolaRules } from "@/lib/db/queries/context-granola";
import { GranolaInboxPanel } from "./granola-inbox-panel";

export interface GranolaInboxProps {
  workspaceId: string;
  workspaceName: string;
  /** Vista «Memoria»: una riga sola, e solo se c'è qualcosa da dire. Senza: il blocco intero della vista «Appunti». */
  compact?: boolean;
}

export async function GranolaInbox({ workspaceId, workspaceName, compact = false }: GranolaInboxProps) {
  const who = await contextActorFromSession(workspaceId);
  // Solo Lateral Space: per gli altri il blocco non c'è.
  if (!who.ok || !contextAbilities(who.actor).canUseGranola) return null;
  const status = await loadGranolaStatus({ userId: who.actor.userId, workspaceId });
  if (!status.available) return null;
  // (Rilascio 10, §3.7) Nelle Fonti, con un collegamento attivo, anche le regole delle call di questo cliente.
  const rules = !compact && status.connected && status.status !== "da_ricollegare" ? await readGranolaRules(who.actor) : null;
  return (
    <GranolaInboxPanel
      workspaceId={workspaceId}
      workspaceName={workspaceName}
      compact={compact}
      connected={status.connected}
      expired={status.status === "da_ricollegare"}
      lastSyncAt={status.lastSyncAt?.toISOString() ?? null}
      stale={status.stale}
      unsortedCount={status.unsortedCount}
      blockedCount={status.blockedCount}
      renderedAt={new Date().toISOString()}
      rules={rules}
    />
  );
}
