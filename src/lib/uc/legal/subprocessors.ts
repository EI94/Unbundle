/**
 * Sub-responsabili di Lateral Space e autorizzazione del cliente (GDPR art. 28,
 * par. 2: autorizzazione scritta generale, anche in forma elettronica, par. 9).
 *
 * Lateral Space deve tenere questo elenco allineato ai contratti con i propri
 * fornitori. Cambiare una voce (nome, attività, dove stanno i dati), toglierla o
 * aggiungerne una richiede di aumentare `SUBPROCESSORS_VERSION`: con una
 * versione nuova il cliente deve confermare di nuovo in Impostazioni.
 *
 * (Rilascio 5.1, decisione del titolare del 04/11/2026, senza un documento) L'ok lo può dare anche
 * Lateral Space per conto del cliente, con un clic: una persona di Lateral Space con un ruolo da
 * revisore che autorizza nel workspace (gli stessi tre ruoli, nell'organizzazione o nel workspace).
 * Il testo lo dice com'è («Per conto di {cliente} … L'ok lo registra Lateral Space»), la riga salvata
 * comincia con «Registrato da Lateral Space» e la riga a schermo dice chi l'ha registrato e quando.
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

/** Ruoli del workspace che possono autorizzare: per una persona del cliente e (rilascio 5.1) per Lateral Space. */
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

/** (Rilascio 5.1) Chi dà l'ok: una persona del cliente, oppure Lateral Space per conto del cliente. */
export type SubprocessorDeclarer = "cliente" | "lateral_space";

/**
 * Chi può autorizzare, e come. Una persona del cliente (email verificata, mai
 * Lateral Space, `isClientUser`) con ruolo Sponsor esecutivo, Responsabile della
 * trasformazione o Responsabile di funzione: `cliente`, con la casella dei poteri.
 * (Rilascio 5.1) Una persona di Lateral Space (email verificata di
 * `UC_LS_EMAIL_DOMAINS`) con uno degli stessi ruoli, cioè un revisore che
 * autorizza nel workspace: `lateral_space`, con un clic, per conto del cliente.
 * Gli altri leggono soltanto (null). Senza `UC_LS_EMAIL_DOMAINS` non si distingue
 * Lateral Space dal cliente: nessuno può autorizzare, come il resto della sezione
 * in sola lettura.
 */
export function subprocessorDeclarerOf(user: DeclarerUser | null | undefined, workspaceRole: string | null | undefined, lsDomains: readonly string[]): SubprocessorDeclarer | null {
  if (lsDomains.length === 0) return null;
  if (!user || !workspaceRole || !SUBPROCESSOR_DECLARER_ROLES.includes(workspaceRole)) return null;
  if (user.isLateralSpace && user.emailVerified === true && user.emailDomain !== null && lsDomains.includes(user.emailDomain)) return "lateral_space";
  return isClientUser(user, lsDomains) ? "cliente" : null;
}

/** Può dare l'ok (il cliente o, rilascio 5.1, Lateral Space per suo conto)? */
export function canDeclareSubprocessors(user: DeclarerUser | null | undefined, workspaceRole: string | null | undefined, lsDomains: readonly string[]): boolean {
  return subprocessorDeclarerOf(user, workspaceRole, lsDomains) !== null;
}

/**
 * Controlli dell'autorizzazione, nell'ordine: chi, versione dell'elenco, conferma
 * (la casella dei poteri per il cliente, il clic su «Registra l'ok di …» per
 * Lateral Space). Dice chi la dà.
 */
export function checkSubprocessorDeclaration(i: {
  user: DeclarerUser | null;
  workspaceRole: string | null;
  lsDomains: readonly string[];
  listVersion: unknown;
  confirmed: unknown;
}): Result<SubprocessorDeclarer> {
  const declarer = subprocessorDeclarerOf(i.user, i.workspaceRole, i.lsDomains);
  if (!declarer) {
    return fail("non_autorizzato", "Questa conferma la dà un responsabile della società, oppure Lateral Space per suo conto.");
  }
  if (i.listVersion !== SUBPROCESSORS_VERSION) {
    return fail("versione_superata", "L'elenco è cambiato. Ricarica la pagina e leggilo di nuovo.");
  }
  if (i.confirmed !== true) return fail("conferma_mancante", declarer === "cliente" ? "Spunta la casella per confermare." : "Conferma per registrare l'ok.");
  return ok(declarer);
}

// ─── Lateral Space per conto del cliente (rilascio 5.1) ──────────────

/** L'inizio di ogni riga salvata da Lateral Space per conto del cliente: così la riga si riconosce da sola. */
export const LS_REGISTERED_PREFIX = "Registrato da Lateral Space";

/** La riga salvata l'ha registrata Lateral Space (anche una riga scritta a mano che comincia così)? */
export function isLsRegisteredStatement(statementText: string | null | undefined): boolean {
  return typeof statementText === "string" && statementText.trimStart().startsWith(LS_REGISTERED_PREFIX);
}

/** Il testo che vede Lateral Space sopra «Registra l'ok di {cliente}»: per conto del cliente, detto com'è. */
export function subprocessorsLsStatement(companyName: string | null | undefined): string {
  const c = company(companyName);
  return (
    `Per conto di ${c}: ${c}, titolare del trattamento, autorizza Lateral Space a ricorrere ai sub-responsabili elencati, ` +
    "ai sensi dell'art. 28, paragrafo 2, del GDPR. L'ok lo registra Lateral Space. Lateral Space impone loro gli stessi obblighi di protezione dei dati " +
    `dell'accordo con ${c} (art. 28, paragrafo 4) e informa ${c} prima di aggiungerne o sostituirne uno, così può opporsi.`
  );
}

/** Il pulsante di Lateral Space: un clic. */
export function subprocessorsLsButton(companyName: string | null | undefined): string {
  return `Registra l'ok di ${company(companyName)}`;
}

/** Il testo salvato quando l'ok lo registra Lateral Space: comincia con `LS_REGISTERED_PREFIX`, poi il testo e l'elenco. */
export function subprocessorsLsRecordText(companyName: string | null | undefined): string {
  return [
    `${LS_REGISTERED_PREFIX} per conto di ${company(companyName)}, con «${subprocessorsLsButton(companyName)}» in Impostazioni › Sub-responsabili.`,
    "",
    subprocessorsLsStatement(companyName),
    "",
    `Sub-responsabili (lista ${SUBPROCESSORS_VERSION}):`,
    ...SUBPROCESSORS.map((s) => `- ${s.nome}: ${s.cosaFa}. Dati: ${s.doveStannoIDati}.`),
  ].join("\n");
}

const pad = (n: number) => String(n).padStart(2, "0");

/** «21/10/2026 alle 14:05», ora di Roma. */
export function romeDateTimeLabel(at: Date): string {
  const p = romeParts(at);
  return `${pad(p.day)}/${pad(p.month)}/${p.year} alle ${pad(p.hour)}:${pad(p.minute)}`;
}

/**
 * La riga dell'ok dato: chi e quando. (Rilascio 5.1) Registrato da Lateral Space per conto del
 * cliente (`registeredBy`, dal testo salvato): «Ok di {cliente} registrato da Lateral Space ({Nome}) il …».
 */
export function subprocessorsDeclaredLine(i: { declaredByName: string; declaredAt: Date; listVersion: string; registeredBy?: SubprocessorDeclarer; companyName?: string | null }): string {
  if (i.registeredBy === "lateral_space") {
    const who = i.declaredByName.trim() ? `Lateral Space (${i.declaredByName.trim()})` : "Lateral Space";
    return `Ok di ${company(i.companyName)} registrato da ${who} il ${romeDateTimeLabel(i.declaredAt)} (lista ${i.listVersion}).`;
  }
  return `Autorizzati da ${i.declaredByName} il ${romeDateTimeLabel(i.declaredAt)} (lista ${i.listVersion}).`;
}

export function subprocessorsWaitingLine(companyName: string | null | undefined): string {
  return `La conferma la dà un responsabile di ${company(companyName)} (ruolo Responsabile di funzione o superiore), oppure Lateral Space per suo conto.`;
}

/** Avviso per Lateral Space nella lista dei Casi d'uso; «Impostazioni» diventa un link. */
export function subprocessorsLsNoticeParts(companyName: string | null | undefined): { before: string; link: string; after: string } {
  return { before: `Sub-responsabili non ancora autorizzati da ${company(companyName)}: l'ok si dà in `, link: "Impostazioni", after: "." };
}

export function subprocessorsLsNotice(companyName: string | null | undefined): string {
  const p = subprocessorsLsNoticeParts(companyName);
  return `${p.before}${p.link}${p.after}`;
}
