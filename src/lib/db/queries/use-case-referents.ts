import "server-only";
import type { UseCaseReferentPanel } from "@/lib/use-cases/referent/contract";
import type { UseCaseNeedLists } from "@/lib/use-cases/needs";
import type { UseCaseViewer } from "@/lib/use-cases/permissions";
import type { ServiceResult, WriteContext } from "@/lib/use-cases/service";
import type { UcMailer } from "@/lib/uc/notify/dispatch";

// Giorno 0: firme definitive, corpi in arrivo.

export type Env = Readonly<Record<string, string | undefined>>;
export type ReferentFailure = { ok: false; error: string; message: string; fieldErrors?: Record<string, string> };

const TODO = () => new Error("non implementato");

export async function referentStoreReady(): Promise<boolean> {
  return false;
}

export class ReferentUnavailableError extends Error {
  readonly code: "spenta" | "non_disponibile";
  constructor(code: "spenta" | "non_disponibile") {
    super(code === "spenta" ? "Funzione spenta." : "Funzione non disponibile.");
    this.name = "ReferentUnavailableError";
    this.code = code;
  }
}

export async function ensureReferentAvailable(workspaceId: string): Promise<void> {
  void workspaceId;
  throw new ReferentUnavailableError("non_disponibile");
}

export async function loadUseCaseReferentPanel(i: {
  workspaceId: string;
  useCaseId: string;
  viewer: UseCaseViewer;
  session: { id: string; name: string | null; email: string; emailVerified: boolean };
  role: string | null;
  needs: UseCaseNeedLists;
  env?: Env;
  now?: Date;
}): Promise<UseCaseReferentPanel | null> {
  void i;
  return null;
}

export const prepareReferentQuestions = async (ctx: WriteContext, useCaseId: string): Promise<ServiceResult<{ added: number }>> => {
  void ctx;
  void useCaseId;
  throw TODO();
};
export const sendReferentRequest = async (
  ctx: WriteContext,
  useCaseId: string,
  input: unknown,
  deps: { env: Env; requester: { name: string | null; emailVerified: boolean }; now?: Date },
): Promise<ServiceResult<{ requestId: string; contactName: string }> | ReferentFailure> => {
  void ctx;
  void useCaseId;
  void input;
  void deps;
  throw TODO();
};
export const addToReferentRequest = async (
  ctx: WriteContext,
  useCaseId: string,
  requestId: string,
  expectedVersion: number,
  input: unknown,
  deps: { env: Env; now?: Date },
): Promise<ServiceResult<{ added: number; emailQueued: boolean; contactName: string }> | ReferentFailure> => {
  void [ctx, useCaseId, requestId, expectedVersion, input, deps];
  throw TODO();
};
export const remindReferentRequest = async (
  ctx: WriteContext,
  useCaseId: string,
  requestId: string,
  expectedVersion: number,
  deps: { env: Env; now?: Date },
): Promise<ServiceResult<{ scheduledAt: string; now: boolean }> | ReferentFailure> => {
  void [ctx, useCaseId, requestId, expectedVersion, deps];
  throw TODO();
};
export const revokeReferentRequest = async (ctx: WriteContext, useCaseId: string, requestId: string, expectedVersion: number): Promise<ServiceResult<null> | ReferentFailure> => {
  void [ctx, useCaseId, requestId, expectedVersion];
  throw TODO();
};
export const retryReferentRequestEmail = async (
  ctx: WriteContext,
  useCaseId: string,
  requestId: string,
  expectedVersion: number,
  deps: { env: Env; now?: Date },
): Promise<ServiceResult<null> | ReferentFailure> => {
  void [ctx, useCaseId, requestId, expectedVersion, deps];
  throw TODO();
};
export const revealReferentContactEmail = async (ctx: WriteContext, useCaseId: string, contactId: string): Promise<ServiceResult<{ email: string | null }> | ReferentFailure> => {
  void [ctx, useCaseId, contactId];
  throw TODO();
};
export const correctReferentEmail = async (ctx: WriteContext, useCaseId: string, contactId: string, input: unknown, deps: { env: Env }): Promise<ServiceResult<{ contactName: string }> | ReferentFailure> => {
  void [ctx, useCaseId, contactId, input, deps];
  throw TODO();
};
export const eraseReferentData = async (ctx: WriteContext, useCaseId: string, contactId: string, deps: { env: Env }): Promise<ServiceResult<{ contactAnonymized: boolean }> | ReferentFailure> => {
  void [ctx, useCaseId, contactId, deps];
  throw TODO();
};
export const addReviewerAnswer = async (ctx: WriteContext, useCaseId: string, needId: string, input: unknown): Promise<ServiceResult<{ answerId: string }> | ReferentFailure> => {
  void [ctx, useCaseId, needId, input];
  throw TODO();
};
export const removeNeedAnswer = async (ctx: WriteContext, useCaseId: string, answerId: string): Promise<ServiceResult<null> | ReferentFailure> => {
  void [ctx, useCaseId, answerId];
  throw TODO();
};
export const deleteNeedFile = async (ctx: WriteContext, useCaseId: string, fileId: string, env: Env): Promise<ServiceResult<null> | ReferentFailure> => {
  void [ctx, useCaseId, fileId, env];
  throw TODO();
};
export const reviewNeedFile = async (ctx: WriteContext, useCaseId: string, fileId: string, outcome: unknown, env: Env): Promise<ServiceResult<{ status: "pulito" | "rifiutato" }> | ReferentFailure> => {
  void [ctx, useCaseId, fileId, outcome, env];
  throw TODO();
};

export async function runReferentCron(o: { env: Env; now?: Date; mailer?: UcMailer; lsDomains?: readonly string[] }): Promise<{
  expired: number;
  completed: number;
  revoked: number;
  cleaned: number;
  quarantine: number;
  blobs: number;
  purged: number;
  queued: number;
  sent: number;
  failed: number;
  held: number;
  cancelled: number;
  errors: number;
}> {
  void o;
  throw TODO();
}
