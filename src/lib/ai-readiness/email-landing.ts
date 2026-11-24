import "server-only";
import type { AirEmailKind } from "@/lib/db/ai-readiness-email-ddl";
import { assessmentInWorkspace } from "@/lib/db/queries/ai-readiness-email";
import { readinessGoneHref } from "./dashboard-view";
import { airEmailTarget } from "./email";

/**
 * L'indirizzo pulito delle email dell'AI Readiness (0044): `/dashboard/<ws>/ai-readiness/aggiornamenti/<rilevazione>`
 * per le risposte nuove, `…/<rilevazione>/risultati` per i risultati. Un'email non può avere né `?` né `#`
 * (`checkEmailLink`). Ogni rotta chiede prima la porta, come la pagina dell'AI Readiness (`requireWorkspacePage`, nel
 * suo gestore: chi non è nel workspace riceve «non trovata», chi segue un corso va ai suoi corsi, «Solo questo use case»
 * all'Agent Factory, senza sessione si va all'accesso); poi la rotta risponde 307 alla scheda giusta: «Raccolta» ›
 * «Persone», o «Risultati». Un link morto (la rilevazione eliminata, sconosciuta o di un altro workspace) porta alla
 * pagina dell'AI Readiness con «Questa rilevazione non c'è più.»: sempre lo stesso indirizzo, così non dice mai se la
 * rilevazione esiste in un altro workspace.
 *
 * Rotte (`route.ts`), non pagine: sotto `ai-readiness/loading.tsx` una pagina risponderebbe 200 e reindirizzerebbe dal
 * browser; la rotta risponde 307 davvero.
 */
export async function readinessEmailLanding(workspaceId: string, assessmentId: string, kind: AirEmailKind): Promise<string> {
  if (!(await assessmentInWorkspace(workspaceId, assessmentId))) return readinessGoneHref(workspaceId);
  return airEmailTarget(workspaceId, assessmentId, kind);
}
