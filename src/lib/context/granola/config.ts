/**
 * Che cosa serve perché Granola funzioni (rilascio 9a, docs/contesto/RILASCIO-9a-COSTRUZIONE.md §8.1):
 * - `CONTEXT_TOKEN_KEY` valida (32 byte in base64, letta come `UC_PERSONAL_ZONE_KEY` da `parsePersonalZoneKey`): cifra
 *   i token. È una chiave sua: `UC_PERSONAL_ZONE_KEY` apre la zona personale dei dossier e non si riusa;
 * - un indirizzo pubblico noto (`emailOrigin`, cioè `NEXT_PUBLIC_APP_URL`): è nel documento del cliente OAuth;
 * - non un'anteprima di Vercel (le anteprime usano il database di produzione);
 * - `CONTEXT_GRANOLA` diverso da `off` (l'interruttore di riserva).
 * `CONTEXT_GRANOLA_CLIENT=dcr` sceglie la registrazione dinamica al posto del documento di metadati.
 * Modulo puro: nessuna lettura dell'ambiente, il chiamante passa `process.env`.
 */
import { parsePersonalZoneKey } from "../../uc/crypto.ts";
import { emailOrigin } from "../../uc/notify/dispatch.ts";

export type GranolaClientMode = "cimd" | "dcr";

export interface GranolaConfig {
  available: boolean;
  /** L'origine pubblica dell'app, o null. */
  origin: string | null;
  /** `CONTEXT_TOKEN_KEY`, solo se valida. Non si registra e non lascia il server. */
  tokenKey: string | null;
  clientMode: GranolaClientMode;
}

export function granolaConfig(env: Readonly<Record<string, string | undefined>>): GranolaConfig {
  const rawKey = env.CONTEXT_TOKEN_KEY;
  const key = parsePersonalZoneKey(rawKey);
  if (key.ok) key.value.fill(0);
  const tokenKey = key.ok && typeof rawKey === "string" ? rawKey.trim() : null;
  const origin = emailOrigin(env);
  const preview = (env.VERCEL_ENV ?? "").trim().toLowerCase() === "preview";
  const off = (env.CONTEXT_GRANOLA ?? "").trim().toLowerCase() === "off";
  const clientMode: GranolaClientMode = (env.CONTEXT_GRANOLA_CLIENT ?? "").trim().toLowerCase() === "dcr" ? "dcr" : "cimd";
  return { available: tokenKey !== null && origin !== null && !preview && !off, origin, tokenKey, clientMode };
}
