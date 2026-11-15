/**
 * La risposta della CLI e dell'MCP del caso quando l'accesso al dossier non si legge (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md
 * §16): un guasto (`non_disponibile`, le tabelle dei dossier che non rispondono) è 503, da riprovare; la sezione spenta
 * per il workspace (`disattivata`) e il caso che la persona non vede (`non_trovato`) sono «non trovato», come un caso che
 * non esiste. Prima un guasto diceva «caso non trovato», e chi costruisce lo leggeva come un permesso tolto.
 *
 * Modulo puro.
 */

export const CLI_CASE_NOT_FOUND = "Caso non trovato in questo workspace (o non sei nel suo team).";
export const CLI_CASE_UNAVAILABLE = "Unbundle non risponde per questo caso: riprova tra qualche minuto.";

export interface CliCaseAccessFailure {
  status: 404 | 503;
  code: "non_trovato" | "non_disponibile";
  message: string;
  headers: Readonly<Record<string, string>>;
}

export function cliCaseAccessFailure(code: "disattivata" | "non_disponibile" | "non_trovato"): CliCaseAccessFailure {
  if (code === "non_disponibile") return { status: 503, code: "non_disponibile", message: CLI_CASE_UNAVAILABLE, headers: { "Retry-After": "60" } };
  return { status: 404, code: "non_trovato", message: CLI_CASE_NOT_FOUND, headers: {} };
}
