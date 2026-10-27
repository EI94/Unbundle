import "server-only";
import type { ReferentClientTicket, ReferentUploadResult } from "@/lib/use-cases/referent/contract";
import type { UseCaseViewer } from "@/lib/use-cases/permissions";
import type { WriteContext } from "@/lib/use-cases/service";
import type { Result } from "@/lib/uc/types";

// Giorno 0: firme definitive, corpi in arrivo.

type Env = Readonly<Record<string, string | undefined>>;
const TODO = () => new Error("non implementato");

export async function processReferentFile(i: { fileId: string; bytes?: Uint8Array }, env: Env): Promise<Result<ReferentUploadResult>> {
  void [i, env];
  throw TODO();
}

export async function uploadReviewerFileServer(
  ctx: WriteContext,
  useCaseId: string,
  input: { needId: string; fileName: string; declaration: boolean; bytes: Uint8Array; validate?: boolean },
  env: Env,
): Promise<Result<ReferentUploadResult>> {
  void [ctx, useCaseId, input, env];
  throw TODO();
}

export async function beginReviewerClientUpload(ctx: WriteContext, useCaseId: string, body: unknown, env: Env): Promise<Result<ReferentClientTicket>> {
  void [ctx, useCaseId, body, env];
  throw TODO();
}

export async function completeReviewerClientUpload(ctx: WriteContext, useCaseId: string, body: unknown, env: Env): Promise<Result<ReferentUploadResult>> {
  void [ctx, useCaseId, body, env];
  throw TODO();
}

export async function openReviewerFileDownload(
  i: { workspaceId: string; useCaseId: string; fileId: string; viewer: UseCaseViewer; userId: string },
  env: Env,
): Promise<Result<{ body: ReadableStream<Uint8Array>; size: number | null; mime: string; fileName: string }>> {
  void [i, env];
  throw TODO();
}

export async function deleteFileObjects(rows: readonly { id: string; blobPath: string | null; quarantinePath: string | null }[], env: Env): Promise<number> {
  void [rows, env];
  return 0;
}

/** Gli oggetti dei file segnati come cancellati, tolti dall'archivio (dopo la risposta). */
export async function cleanupDeletedFiles(i: { workspaceId: string | null; limit?: number }, env: Env): Promise<number> {
  void [i, env];
  return 0;
}
