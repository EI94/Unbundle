import "server-only";
import type {
  DraftResult,
  ReferentAskView,
  ReferentClientTicket,
  ReferentPageResult,
  ReferentUploadResult,
  SubmitResult,
} from "@/lib/use-cases/referent/contract";
import type { RateLimitKind, RateLimitRule } from "@/lib/uc/http";
import type { PublicOutcome } from "@/lib/uc/public-view";
import type { Result } from "@/lib/uc/types";

// Giorno 0: firme definitive, corpi in arrivo. È l'unico modulo della funzione che le rotte
// pubbliche importano.

export { referentStoreReady } from "./use-case-referents";
export { referentAskEnabled, referentPublicWritesAvailable } from "@/lib/use-cases/referent/availability";

type Env = Readonly<Record<string, string | undefined>>;

const TODO = () => new Error("non implementato");

export function logReferentPublicError(op: string, error: unknown): void {
  void op;
  void error;
}

export interface ReferentLink {
  tokenId: string;
  requestId: string;
  workspaceId: string;
  useCaseId: string;
  contactId: string;
  status: "inviata" | "completata";
  privacyAccepted: boolean;
  expiresAt: Date;
}

export async function resolveReferentToken(token: string, now: Date): Promise<{ access: "ok"; link: ReferentLink } | { access: "non_valido" | "revocato" | "scaduto" }> {
  void [token, now];
  return { access: "non_valido" };
}

export async function loadReferentAskPage(token: string, o: { env: Env; now: Date }): Promise<ReferentPageResult> {
  void [token, o];
  return { access: "non_disponibile" };
}

export async function loadReferentAskView(link: ReferentLink, o: { env: Env; now: Date }): Promise<ReferentAskView> {
  void [link, o];
  throw TODO();
}

export async function acceptReferentPrivacy(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<{ accepted: true }>> {
  void [link, body, now];
  throw TODO();
}

export async function saveReferentDraft(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<DraftResult>> {
  void [link, body, now];
  throw TODO();
}

export async function submitReferentAnswers(link: ReferentLink, body: unknown, now: Date): Promise<PublicOutcome<SubmitResult>> {
  void [link, body, now];
  throw TODO();
}

export async function uploadReferentFileServer(
  link: ReferentLink,
  input: { needId: string; fileName: string; declaration: boolean; bytes: Uint8Array },
  env: Env,
): Promise<Result<ReferentUploadResult>> {
  void [link, input, env];
  throw TODO();
}

export async function beginReferentClientUpload(link: ReferentLink, body: unknown, env: Env): Promise<Result<ReferentClientTicket>> {
  void [link, body, env];
  throw TODO();
}

export async function completeReferentClientUpload(link: ReferentLink, body: unknown, env: Env): Promise<Result<ReferentUploadResult>> {
  void [link, body, env];
  throw TODO();
}

export async function removeReferentFile(link: ReferentLink, body: unknown, env: Env): Promise<PublicOutcome<{ removed: true }>> {
  void [link, body, env];
  throw TODO();
}

export async function confirmReferentFile(link: ReferentLink, body: unknown): Promise<PublicOutcome<{ confirmed: true }>> {
  void [link, body];
  throw TODO();
}

export function referentRateRule(tokenId: string, kind: RateLimitKind): RateLimitRule {
  void [tokenId, kind];
  throw TODO();
}

export function scheduleReferentDispatch(requestId: string): void {
  void requestId;
}

export const REFERENT_PUBLIC_STATUS: Readonly<Record<string, number>> = Object.freeze({});
