/**
 * Log degli errori senza dati di chi scrive.
 *
 * I messaggi di zod, del database (Neon/Postgres: `detail`, valori dei vincoli)
 * e dell'SDK AI possono contenere pezzi del payload: testi delle segnalazioni,
 * nomi, email. Qui si tiene solo ciò che serve a capire il guasto: nome
 * dell'errore, codice (es. SQLSTATE 23505), nome del vincolo e, per zod, i
 * percorsi dei campi. Mai `message`, `detail`, `cause`, corpo o header.
 * Modulo puro: lo usano anche i test con Node.
 */

export type SafeErrorSummary = {
  name: string;
  code?: string;
  constraint?: string;
  fields?: string[];
};

const TOKEN = /^[A-Za-z0-9_.:-]{1,60}$/;

function safeToken(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" && TOKEN.test(value) ? value : undefined;
}

export function summarizeError(error: unknown): SafeErrorSummary {
  if (!error || typeof error !== "object") return { name: typeof error };
  const record = error as Record<string, unknown>;
  const summary: SafeErrorSummary = { name: safeToken(record.name) ?? "Error" };
  const code = safeToken(record.code);
  if (code) summary.code = code;
  const constraint = safeToken(record.constraint);
  if (constraint) summary.constraint = constraint;
  if (Array.isArray(record.issues)) {
    const fields = record.issues
      .map((issue) => {
        const path = (issue as { path?: unknown })?.path;
        return Array.isArray(path) ? path.filter((p) => typeof p === "string" || typeof p === "number").join(".") : "";
      })
      .filter((path) => path && TOKEN.test(path));
    if (fields.length) summary.fields = [...new Set(fields)].slice(0, 20);
  }
  return summary;
}

/** Una riga JSON: `[scope] event {"name":…,"code":…}`, più campi extra non personali. */
export function logSafeError(
  scope: string,
  event: string,
  error: unknown,
  extra: Record<string, string | number | boolean | null> = {},
  log: Pick<Console, "error"> = console
) {
  log.error(`[${scope}] ${event}`, JSON.stringify({ ...extra, error: summarizeError(error) }));
}
