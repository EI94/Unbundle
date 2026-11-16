/**
 * I token di Granola e il `code_verifier` del collegamento, cifrati (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md
 * §8.3). Si riusa la busta dell'app (`src/lib/uc/crypto.ts`, AES-256-GCM), senza modificarla:
 * - chiave master `CONTEXT_TOKEN_KEY` (non `UC_PERSONAL_ZONE_KEY`, che apre la zona personale dei dossier);
 * - una chiave per persona: `deriveWorkspaceKek(chiave, userId)` (qui l'id è quello della persona);
 * - dati associati `granola-token|<userId>` per i token, `granola-stato|<userId>` per il verifier.
 * Una busta copiata sulla riga di un'altra persona non si apre. Esce in base64.
 *
 * Mai un token in chiaro: non in una colonna, non in un log, non in una risposta. Senza chiave le funzioni
 * restituiscono un esito (`chiave_assente`, `chiave_non_valida`), non un'eccezione.
 * Modulo puro.
 */
import { deriveWorkspaceKek, openJson, sealJson } from "../../uc/crypto.ts";
import { fail, ok, type Result } from "../../uc/types.ts";

export interface GranolaTokens {
  accessToken: string;
  refreshToken: string | null;
  tokenType: string;
  scope: string | null;
}

const TOKEN_AAD = "granola-token";
const VERIFIER_AAD = "granola-stato";
const BAD = () => fail<never>("busta_non_valida", "Il dato cifrato non si può aprire.");

function seal(masterKey: string | undefined, userId: string, aad: string, value: Record<string, string | null>): Result<string> {
  const kek = deriveWorkspaceKek(masterKey, userId);
  if (!kek.ok) return kek;
  try {
    return ok(sealJson(kek.value, value, `${aad}|${kek.value.workspaceId}`).toString("base64"));
  } finally {
    kek.value.key.fill(0);
  }
}

function open(masterKey: string | undefined, userId: string, aad: string, sealed: string): Result<Record<string, unknown>> {
  if (typeof sealed !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(sealed)) return BAD();
  const kek = deriveWorkspaceKek(masterKey, userId);
  if (!kek.ok) return kek;
  try {
    const opened = openJson(kek.value, Buffer.from(sealed, "base64"), `${aad}|${kek.value.workspaceId}`);
    if (!opened.ok) return opened;
    const value = opened.value;
    return value && typeof value === "object" && !Array.isArray(value) ? ok(value as Record<string, unknown>) : BAD();
  } finally {
    kek.value.key.fill(0);
  }
}

export function sealGranolaTokens(masterKey: string | undefined, userId: string, tokens: GranolaTokens): Result<string> {
  if (!tokens || typeof tokens.accessToken !== "string" || !tokens.accessToken) return fail("token_non_valido", "Token non valido.");
  return seal(masterKey, userId, TOKEN_AAD, {
    accessToken: tokens.accessToken,
    refreshToken: typeof tokens.refreshToken === "string" && tokens.refreshToken ? tokens.refreshToken : null,
    tokenType: typeof tokens.tokenType === "string" && tokens.tokenType ? tokens.tokenType : "Bearer",
    scope: typeof tokens.scope === "string" && tokens.scope ? tokens.scope : null,
  });
}

export function openGranolaTokens(masterKey: string | undefined, userId: string, sealed: string): Result<GranolaTokens> {
  const opened = open(masterKey, userId, TOKEN_AAD, sealed);
  if (!opened.ok) return opened;
  const v = opened.value;
  if (typeof v.accessToken !== "string" || !v.accessToken) return BAD();
  return ok({
    accessToken: v.accessToken,
    refreshToken: typeof v.refreshToken === "string" && v.refreshToken ? v.refreshToken : null,
    tokenType: typeof v.tokenType === "string" && v.tokenType ? v.tokenType : "Bearer",
    scope: typeof v.scope === "string" && v.scope ? v.scope : null,
  });
}

export function sealGranolaVerifier(masterKey: string | undefined, userId: string, verifier: string): Result<string> {
  if (typeof verifier !== "string" || !/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return fail("verifier_non_valido", "Verifier non valido.");
  return seal(masterKey, userId, VERIFIER_AAD, { verifier });
}

export function openGranolaVerifier(masterKey: string | undefined, userId: string, sealed: string): Result<string> {
  const opened = open(masterKey, userId, VERIFIER_AAD, sealed);
  if (!opened.ok) return opened;
  return typeof opened.value.verifier === "string" && opened.value.verifier ? ok(opened.value.verifier) : BAD();
}
