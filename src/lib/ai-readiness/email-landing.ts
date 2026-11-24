import "server-only";
import { notFound, redirect } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";
import type { AirEmailKind } from "@/lib/db/ai-readiness-email-ddl";
import { assessmentInWorkspace } from "@/lib/db/queries/ai-readiness-email";
import { airEmailTarget } from "./email";

/**
 * L'indirizzo pulito delle email dell'AI Readiness (0044): `/dashboard/<ws>/ai-readiness/aggiornamenti/<rilevazione>`
 * per le risposte nuove, `…/<rilevazione>/risultati` per i risultati. Un'email non può avere né `?` né `#`
 * (`checkEmailLink`). Prima l'accesso, come la pagina dell'AI Readiness (`requireWorkspacePage`: chi non è nel
 * workspace riceve «non trovata», chi segue un corso va ai suoi corsi, «Solo questo use case» all'Agent Factory, senza
 * sessione si va all'accesso); poi la rilevazione deve essere di questo workspace (altrimenti «non trovata»); poi 307
 * alla scheda giusta: «Raccolta» › «Persone», o «Risultati».
 *
 * Una rotta (`route.ts`), non una pagina: sotto `ai-readiness/loading.tsx` una pagina risponderebbe 200 e
 * reindirizzerebbe dal browser; la rotta risponde 307 davvero.
 */
export async function landFromReadinessEmail(params: Promise<{ workspaceId: string; assessmentId: string }>, kind: AirEmailKind): Promise<never> {
  const { workspaceId, assessmentId } = await params;
  await requireWorkspacePage(workspaceId);
  if (!(await assessmentInWorkspace(workspaceId, assessmentId))) notFound();
  redirect(airEmailTarget(workspaceId, assessmentId, kind));
}
