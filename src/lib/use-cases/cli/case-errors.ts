/**
 * La risposta della CLI e dell'MCP del caso quando l'accesso al dossier non si legge (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md
 * §16): un guasto (`non_disponibile`, le tabelle dei dossier che non rispondono) è 503, da riprovare; la sezione spenta
 * per il workspace (`disattivata`) e il caso che la persona non vede (`non_trovato`) sono «non trovato», come un caso che
 * non esiste. Prima un guasto diceva «caso non trovato», e chi costruisce lo leggeva come un permesso tolto.
 *
 * (9b) Lo stesso per il contesto del cliente: lo strato `contesto`, `contesto`, `nota` e `impara` con l'archivio di «Contesto»
 * (o la 0041) che non risponde sono 503, da riprovare, mai «caso non trovato».
 *
 * Modulo puro.
 */
import { AGENT_CONTEXT_TEXT } from "../../context/work/agent-text.ts";

export const CLI_CASE_NOT_FOUND = "Caso non trovato in questo workspace (o non sei nel suo team).";

/**
 * (8.0c) A chi costruiva il caso da fuori e ora nel workspace ha un ruolo sotto Analista (Contributore): il ruolo nel caso
 * c'è, è quello nel workspace che manca, e lo cambia chi gestisce il workspace.
 */
export const CLI_NEEDS_REVIEWER_ROLE = "Per costruire serve almeno il ruolo di Analista nel workspace: lo cambia chi gestisce il workspace, da Impostazioni › Persone.";

/** Il perché di un no di chi costruisce: con il ruolo nel workspace che manca, quello; altrimenti il testo della porta. */
export function notBuilderMessage(blocked: string | null, fallback: string): string {
  return blocked === "ruolo_workspace" ? CLI_NEEDS_REVIEWER_ROLE : fallback;
}
export const CLI_CASE_UNAVAILABLE = "Unbundle non risponde per questo caso: riprova tra qualche minuto.";

/**
 * (8.0d, D7) `unbundle contesto` a chi costruisce solo questo caso: la domanda cercherebbe in tutta la memoria del
 * cliente; i fatti del suo caso li legge con lo strato `contesto`.
 */
export const CLI_CASE_ONLY_ASK = (code: string) =>
  `Le domande sulla memoria del cliente non sono per chi costruisce solo questo caso: i fatti del caso li leggi con «unbundle context ${code} --contesto».`;

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

/**
 * (9b) Il contesto del cliente non si legge o non si scrive (l'archivio di «Contesto» che non risponde, o la 0041 non ancora
 * applicata): 503 con «Unbundle non risponde», da riprovare tra un minuto.
 */
export const CLI_CONTEXT_UNAVAILABLE: CliCaseAccessFailure = Object.freeze({
  status: 503,
  code: "non_disponibile",
  message: AGENT_CONTEXT_TEXT.unavailable,
  headers: Object.freeze({ "Retry-After": "60" }),
});
