import "server-only";
import { emptyBellPayload, type BellPayload } from "./bell";

/** La campanella di una persona in un workspace (giorno 0: in arrivo). */
export async function loadBellPayload(i: { workspaceId: string; userId: string | null; role: string | null; useCaseHub: boolean; now?: Date; env?: Readonly<Record<string, string | undefined>> }): Promise<BellPayload> {
  return emptyBellPayload(i.workspaceId, i.now ?? new Date());
}
