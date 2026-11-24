import "server-only";
import { notFound } from "next/navigation";
import type { AirEmailKind } from "@/lib/db/ai-readiness-email-ddl";
import { assessmentInWorkspace } from "@/lib/db/queries/ai-readiness-email";
import { airEmailTarget } from "./email";

/**
 * L'indirizzo pulito delle email dell'AI Readiness (0044): `/dashboard/<ws>/ai-readiness/aggiornamenti/<rilevazione>`
 * per le risposte nuove, `…/<rilevazione>/risultati` per i risultati. Un'email non può avere né `?` né `#`
 * (`checkEmailLink`). Ogni rotta chiede prima la porta, come la pagina dell'AI Readiness (`requireWorkspacePage`, nel
 * suo gestore: chi non è nel workspace riceve «non trovata», chi segue un corso va ai suoi corsi, «Solo questo use case»
 * all'Agent Factory, senza sessione si va all'accesso); poi qui la rilevazione deve essere di questo workspace
 * (altrimenti «non trovata»); poi la rotta risponde 307 alla scheda giusta: «Raccolta» › «Persone», o «Risultati».
 *
 * Rotte (`route.ts`), non pagine: sotto `ai-readiness/loading.tsx` una pagina risponderebbe 200 e reindirizzerebbe dal
 * browser; la rotta risponde 307 davvero.
 */
export async function readinessEmailLanding(workspaceId: string, assessmentId: string, kind: AirEmailKind): Promise<string> {
  if (!(await assessmentInWorkspace(workspaceId, assessmentId))) notFound();
  return airEmailTarget(workspaceId, assessmentId, kind);
}
