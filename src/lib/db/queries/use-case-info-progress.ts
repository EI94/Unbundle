import "server-only";
import type { InfoAskFact, InfoProgressView } from "@/lib/use-cases/info-progress";
import type { UseCaseNeedLists } from "@/lib/use-cases/needs";
import type { UseCaseViewer } from "@/lib/use-cases/permissions";

/** «Raccolta informazioni» delle schede del workspace, per i revisori (giorno 0: in arrivo). */
export async function listInfoProgress(workspaceId: string, viewer: UseCaseViewer, o: { now?: Date } = {}): Promise<Record<string, InfoProgressView> | null> {
  void workspaceId;
  void viewer;
  void o;
  return null;
}

/** «Raccolta informazioni» di una scheda (giorno 0: in arrivo). */
export async function loadUseCaseInfoProgress(i: { workspaceId: string; useCaseId: string; viewer: UseCaseViewer; needs: UseCaseNeedLists; canAsk: boolean; now?: Date }): Promise<InfoProgressView | null> {
  void i;
  return null;
}

export async function loadInfoAsks(workspaceId: string, useCaseId: string | null): Promise<Array<InfoAskFact & { useCaseId: string }>> {
  void workspaceId;
  void useCaseId;
  return [];
}
