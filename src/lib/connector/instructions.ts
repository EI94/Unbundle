/**
 * Istruzioni del server MCP del connettore (prompt WP5): il testo che Claude riceve
 * con `initialize` e che vale anche senza la skill.
 *
 * Il modello è per workspace (decisione 1 dell'arresto B, pacchetto K8): sta in
 * `workspace_connector_configs.instructions_template`, lo carica lo script operatore
 * insieme al profilo del cliente (`profile.ts`), e la rotta non parte senza (500, nessun
 * testo di riserva). Qui non c'è nessun modello: il testo del cliente (quello del prompt
 * WP5) sta solo nel suo file privato del profilo, fuori da git; i test, l'app di prova e
 * lo smoke usano il modello sintetico `EXAMPLE_INSTRUCTIONS_TEMPLATE` di
 * `contract.fixtures.ts`, scritto con parole nostre.
 *
 * Un solo segnaposto, `{{workspaceName}}`, sostituito con
 * `workspace_connector_configs.workspace_display_name`. Dopo la sostituzione il testo non
 * supera 2.048 caratteri, anche con un nome lungo quanto la colonna (120 caratteri):
 * `validateInstructionsTemplate` lo controlla prima di salvare e a ogni lettura.
 *
 * Il nome arriva dalla configurazione, che scrive solo Lateral Space: qui lo si
 * ripulisce lo stesso (una riga sola, niente parentesi graffe, al massimo 120
 * caratteri). Senza nome si usa un'espressione generica.
 *
 * Modulo puro: gira con `node --test`.
 */
import { CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS } from "../db/connector-ddl.ts";

/** Il segnaposto del modello. */
export const WORKSPACE_NAME_PLACEHOLDER = "{{workspaceName}}";

/** Tetto delle istruzioni del server (prompt WP5). */
export const CONNECTOR_INSTRUCTIONS_MAX_CHARS = 2048;

/** Lunghezza massima del nome (colonna `workspace_display_name varchar(120)`). */
export const WORKSPACE_NAME_MAX_CHARS = 120;

/** Al posto del nome, quando la configurazione non ne ha uno. */
export const WORKSPACE_NAME_FALLBACK = "questa organizzazione";

/**
 * Il nome da mettere nelle istruzioni: spazi e a capo ridotti a uno spazio, senza
 * parentesi graffe né caratteri di controllo, al massimo 120 caratteri.
 */
export function instructionsWorkspaceName(name: string | null | undefined): string {
  if (typeof name !== "string") return WORKSPACE_NAME_FALLBACK;
  const clean = name
    .replace(/[\p{Cc}\p{Cf}{}]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return WORKSPACE_NAME_FALLBACK;
  return [...clean].slice(0, WORKSPACE_NAME_MAX_CHARS).join("").trim();
}

/**
 * Le istruzioni del server per un workspace (`initialize.instructions`): il modello del
 * workspace (già validato) con il nome al posto del segnaposto.
 */
export function connectorServerInstructions(workspaceName: string | null | undefined, template: string): string {
  return template.replace(WORKSPACE_NAME_PLACEHOLDER, () => instructionsWorkspaceName(workspaceName));
}

export type InstructionsTemplateValidation = { ok: true; template: string } | { ok: false; message: string };

/** Nome più lungo ammesso dalla colonna: con questo il testo deve restare sotto il tetto. */
const LONGEST_NAME = "N".repeat(WORKSPACE_NAME_MAX_CHARS);

/**
 * Il modello delle istruzioni di un workspace, validato: un testo di righe (a capo `\n`;
 * `\r\n` diventa `\n`), senza altri caratteri di controllo, con esattamente un
 * `{{workspaceName}}` e nessun'altra doppia graffa, al massimo 2.048 caratteri, e sotto
 * 2.048 anche dopo la sostituzione con il nome più lungo ammesso. Spazi e righe vuote ai
 * due estremi si tolgono. I messaggi non ripetono il testo.
 */
export function validateInstructionsTemplate(input: unknown): InstructionsTemplateValidation {
  if (typeof input !== "string") return { ok: false, message: "Serve il modello delle istruzioni (testo)." };
  const template = input.replace(/\r\n/g, "\n").trim();
  if (!template) return { ok: false, message: "Il modello delle istruzioni è vuoto." };
  if (/[\p{Cc}\p{Cf}]/u.test(template.replace(/\n/g, ""))) return { ok: false, message: "Il modello contiene caratteri di controllo." };
  if (template.split(WORKSPACE_NAME_PLACEHOLDER).length !== 2) {
    return { ok: false, message: `Il modello deve contenere esattamente un ${WORKSPACE_NAME_PLACEHOLDER}.` };
  }
  if (/\{\{|\}\}/.test(template.replace(WORKSPACE_NAME_PLACEHOLDER, ""))) {
    return { ok: false, message: `Il modello ha un segnaposto diverso da ${WORKSPACE_NAME_PLACEHOLDER}.` };
  }
  if (template.length > CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS) {
    return { ok: false, message: `Il modello supera ${CONNECTOR_INSTRUCTIONS_TEMPLATE_MAX_CHARS} caratteri.` };
  }
  if (connectorServerInstructions(LONGEST_NAME, template).length > CONNECTOR_INSTRUCTIONS_MAX_CHARS) {
    return { ok: false, message: `Con un nome di ${WORKSPACE_NAME_MAX_CHARS} caratteri le istruzioni superano ${CONNECTOR_INSTRUCTIONS_MAX_CHARS} caratteri.` };
  }
  return { ok: true, template };
}
