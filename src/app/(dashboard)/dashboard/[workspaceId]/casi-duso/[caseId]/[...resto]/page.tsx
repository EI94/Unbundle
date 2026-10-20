import { notFound } from "next/navigation";
import { requireWorkspacePage } from "@/lib/auth/require-workspace";

/**
 * Ogni indirizzo dentro il dossier che non è una pagina (un segmento scritto
 * male, `domande/<id>/x`, un vecchio segmento fuori dalla tabella di §2.5):
 * `[caseId]/not-found.tsx` in italiano, dentro il layout del caso, con testata
 * e schede (DESIGN §3.14). Senza questo segmento la richiesta finirebbe sul 404
 * generico di Next, fuori dal dossier.
 *
 * I segmenti statici (le pagine, `export`, `files/**`, `test-cases/import` e i
 * vecchi indirizzi) vincono sempre su questo. Come ogni pagina del workspace
 * controlla da sé l'accesso (`workspace-isolation.test.ts`); nessun'altra
 * lettura: l'accesso al caso l'ha già controllato il layout.
 */
export default async function CasePathNotFound({ params }: { params: Promise<{ workspaceId: string }> }): Promise<never> {
  const { workspaceId } = await params;
  await requireWorkspacePage(workspaceId);
  notFound();
}
