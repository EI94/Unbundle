/**
 * Accesso ai cron dei casi d'uso (`/api/cron/uc-reminders`, `/api/cron/uc-freshness`,
 * PIANO §1.3, §5.7).
 *
 * Vercel chiama i cron con `Authorization: Bearer <CRON_SECRET>`. A differenza
 * dei cron esistenti (`Bearer ${process.env.CRON_SECRET}` passa anche quando il
 * segreto manca: «Bearer undefined»), qui un segreto assente o vuoto **rifiuta
 * sempre**. Il confronto è a tempo costante, sulle impronte sha256.
 *
 * Modulo puro (solo `node:crypto`).
 */
import { createHash, timingSafeEqual } from "node:crypto";

export type CronAuthorization = "ok" | "segreto_mancante" | "non_autorizzato";

function digest(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

/** Controlla l'intestazione `Authorization` contro `CRON_SECRET`. */
export function checkCronAuthorization(header: string | null | undefined, secret: string | null | undefined): CronAuthorization {
  const expected = typeof secret === "string" ? secret.trim() : "";
  if (!expected) return "segreto_mancante";
  if (typeof header !== "string") return "non_autorizzato";
  const match = /^Bearer (.+)$/.exec(header.trim());
  if (!match) return "non_autorizzato";
  return timingSafeEqual(digest(match[1]), digest(expected)) ? "ok" : "non_autorizzato";
}
