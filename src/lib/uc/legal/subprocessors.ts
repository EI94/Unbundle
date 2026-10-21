/**
 * Sub-responsabili di Lateral Space e autorizzazione del cliente (GDPR art. 28,
 * par. 2: autorizzazione scritta generale, anche in forma elettronica, par. 9).
 *
 * Lateral Space deve tenere questo elenco allineato ai contratti con i propri
 * fornitori. Cambiare una voce (nome, attività, dove stanno i dati), toglierla o
 * aggiungerne una richiede di aumentare `SUBPROCESSORS_VERSION`: con una
 * versione nuova il cliente deve confermare di nuovo in Impostazioni.
 *
 * Modulo puro: lo usano la pagina delle impostazioni, l'azione, la query
 * (`src/lib/db/queries/uc-subprocessors.ts`) e i test.
 */
import { romeParts } from "../calendar.ts";
import { isClientUser } from "../lateral-space.ts";
import { fail, ok, type Result, type UserContext } from "../types.ts";

export const SUBPROCESSORS_VERSION = "2026-10";

export interface Subprocessor {
  readonly nome: string;
  readonly cosaFa: string;
  readonly doveStannoIDati: string;
}

const FUORI_UE = "fuori UE, con le garanzie dell'art. 46 GDPR";

export const SUBPROCESSORS: readonly Subprocessor[] = Object.freeze([
  { nome: "Vercel", cosaFa: "hosting dell'applicazione, funzioni e archivio dei file", doveStannoIDati: "UE (Francoforte)" },
  { nome: "Neon", cosaFa: "database", doveStannoIDati: "UE (Francoforte)" },
  { nome: "Google Firebase", cosaFa: "accesso degli utenti (login)", doveStannoIDati: FUORI_UE },
  { nome: "Anthropic", cosaFa: "analisi con l'AI di testi e documenti", doveStannoIDati: FUORI_UE },
  { nome: "Resend", cosaFa: "invio delle email di notifica, quando attivo", doveStannoIDati: FUORI_UE },
]);

/** Ruoli del workspace che possono autorizzare, per una persona del cliente. */
export const SUBPROCESSOR_DECLARER_ROLES: readonly string[] = Object.freeze(["exec_sponsor", "transformation_lead", "function_lead"]);

export const SUBPROCESSORS_POWERS_TEXT = "Ho i poteri per dare questa autorizzazione per la mia società.";

function company(name: string | null | undefined): string {
  const trimmed = name?.trim();
  return trimmed ? trimmed : "la società";
}

/** Il testo dell'autorizzazione, mostrato così com'è sopra la casella. */
export function subprocessorsStatement(companyName: string | null | undefined): string {
  return (
    `Per conto di ${company(companyName)}, titolare del trattamento, autorizzo Lateral Space a ricorrere ai sub-responsabili elencati, ` +
    "ai sensi dell'art. 28, paragrafo 2, del GDPR. Lateral Space impone loro gli stessi obblighi di protezione dei dati del nostro accordo " +
    "(art. 28, paragrafo 4) e ci informa prima di aggiungerne o sostituirne uno, così possiamo opporci."
  );
}

/**
 * Il testo salvato in `uc_subprocessor_acks.statement_text`: l'autorizzazione,
 * l'elenco della versione e la frase della casella, cioè tutto ciò che la
 * persona ha approvato. Così la riga si legge da sola, anche dopo un cambio
 * dell'elenco.
 */
export function subprocessorsRecordText(companyName: string | null | undefined): string {
  return [
    subprocessorsStatement(companyName),
    "",
    `Sub-responsabili (lista ${SUBPROCESSORS_VERSION}):`,
    ...SUBPROCESSORS.map((s) => `- ${s.nome}: ${s.cosaFa}. Dati: ${s.doveStannoIDati}.`),
    "",
    SUBPROCESSORS_POWERS_TEXT,
  ].join("\n");
}

type DeclarerUser = Pick<UserContext, "isLateralSpace" | "emailVerified" | "emailDomain">;

/**
 * Chi può autorizzare: una persona del cliente (email verificata, mai Lateral
 * Space, `isClientUser`) con ruolo di workspace Sponsor esecutivo,
 * Responsabile della trasformazione o Responsabile di funzione. Gli altri
 * leggono soltanto. Senza `UC_LS_EMAIL_DOMAINS` non si distingue Lateral Space
 * dal cliente: nessuno può autorizzare, come il resto della sezione in sola
 * lettura.
 */
export function canDeclareSubprocessors(user: DeclarerUser | null | undefined, workspaceRole: string | null | undefined, lsDomains: readonly string[]): boolean {
  if (lsDomains.length === 0) return false;
  if (!user || !workspaceRole || !SUBPROCESSOR_DECLARER_ROLES.includes(workspaceRole)) return false;
  return isClientUser(user, lsDomains);
}

/** Controlli dell'autorizzazione, nell'ordine: chi, versione dell'elenco, casella. */
export function checkSubprocessorDeclaration(i: {
  user: DeclarerUser | null;
  workspaceRole: string | null;
  lsDomains: readonly string[];
  listVersion: unknown;
  confirmed: unknown;
}): Result<null> {
  if (!canDeclareSubprocessors(i.user, i.workspaceRole, i.lsDomains)) {
    return fail("non_autorizzato", "Questa conferma la dà un responsabile della società.");
  }
  if (i.listVersion !== SUBPROCESSORS_VERSION) {
    return fail("versione_superata", "L'elenco è cambiato. Ricarica la pagina e leggilo di nuovo.");
  }
  if (i.confirmed !== true) return fail("conferma_mancante", "Spunta la casella per confermare.");
  return ok(null);
}

const pad = (n: number) => String(n).padStart(2, "0");

/** «21/10/2026 alle 14:05», ora di Roma. */
export function romeDateTimeLabel(at: Date): string {
  const p = romeParts(at);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} alle ${pad(p.hour)}:${pad(p.minute)}`;
}

export function subprocessorsDeclaredLine(i: { declaredByName: string; declaredAt: Date; listVersion: string }): string {
  return `Autorizzati da ${i.declaredByName} il ${romeDateTimeLabel(i.declaredAt)} (lista ${i.listVersion}).`;
}

export function subprocessorsWaitingLine(companyName: string | null | undefined): string {
  return `La conferma la dà un responsabile di ${company(companyName)} (ruolo Responsabile di funzione o superiore).`;
}

/** Avviso per Lateral Space nella lista dei Casi d'uso; «Impostazioni» diventa un link. */
export function subprocessorsLsNoticeParts(companyName: string | null | undefined): { before: string; link: string; after: string } {
  return { before: `Sub-responsabili non ancora autorizzati da ${company(companyName)}: chiedi la conferma in `, link: "Impostazioni", after: "." };
}

export function subprocessorsLsNotice(companyName: string | null | undefined): string {
  const p = subprocessorsLsNoticeParts(companyName);
  return `${p.before}${p.link}${p.after}`;
}
