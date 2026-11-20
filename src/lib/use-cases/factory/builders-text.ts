/**
 * I testi di «Chi costruisce» (rilascio 8.0c, docs/rilascio-8/RILASCIO-8.0c-ESTERNI.md §11): i messaggi dopo «Aggiungi» e
 * «Togli», la riga di ogni persona e la conferma di «Togli». Nella dashboard «casi»; mai un nome nei messaggi, e niente
 * aggettivi o participi che dicono il genere della persona («esce da», non «è uscita da»).
 *
 * Modulo puro: import di soli tipi.
 */
import type { BuilderWhere } from "../../db/queries/use-case-builders.ts";

/** Il risultato di «Aggiungi» da fuori (`addExternalBuilder`), quello che serve ai testi. */
export interface ExternalAddedFacts {
  where: BuilderWhere;
  entered: readonly string[];
  already: readonly string[];
  left: readonly string[];
  skipped: readonly { code: string; reason: string }[];
  repos: readonly string[];
  released: number;
}

/** Il risultato di «Togli» da fuori (`removeExternalBuilder`). */
export interface ExternalRemovedFacts {
  left: readonly string[];
  skipped: readonly { code: string; reason: string }[];
  repos: readonly string[];
}

export const casesText = (n: number) => (n === 1 ? "1 caso" : `${n} casi`);

/** Perché un caso si è saltato, a parole. */
export const SKIP_REASON: Readonly<Record<string, string>> = {
  attore_non_ammesso: "lì non sei responsabile",
  ultimo_ls_lead: "è l'unico responsabile",
  caso_chiuso: "il caso è chiuso",
  non_collaboratore: "non fa parte del workspace",
  conflitto_ruoli: "ha già un ruolo del cliente",
  ruolo_cliente: "lì firma o approva per il cliente",
  concessione_tolta: "non costruisce più",
};

/** I casi saltati, ognuno con il suo motivo (al massimo 5 per nome). */
export function skippedText(skipped: readonly { code: string; reason: string }[], tail = ""): string {
  if (!skipped.length) return "";
  const shown = skipped.slice(0, 5).map((s) => `${s.code} (${SKIP_REASON[s.reason] ?? "non riuscito"})`);
  const more = skipped.length > 5 ? ` e altri ${skipped.length - 5}` : "";
  return ` Saltati: ${shown.join(", ")}${more}.${tail}`;
}

/** I repository, per nome (al massimo 5). */
export function reposText(repos: readonly string[]): string {
  const shown = repos.slice(0, 5).join(", ");
  return repos.length > 5 ? `${shown} e altri ${repos.length - 5}` : shown;
}

/** Sotto «Ruolo», per chi viene da fuori: che cosa fa «Sviluppatore esterno» e che cosa no. */
export const EXTERNAL_ROLE_HINT =
  "Costruisce come il team di Lateral Space: imposta il progetto, prende i compiti, apre le pull request, manda evals e banco. Non approva il progetto, non firma per il cliente e nella realizzazione legge come il cliente.";

/** Il messaggio dopo «Aggiungi» di una persona di Lateral Space: il team del cliente, in tutti i casi aperti. */
export function lsAddedText(r: { done: readonly string[]; unchanged: readonly string[]; skipped: readonly { code: string; reason: string }[] }): string {
  const already = r.unchanged.length ? `, c'era già in ${casesText(r.unchanged.length)}` : "";
  return `Nel team del cliente: entrerà anche nei casi nuovi. Entra in ${casesText(r.done.length)}${already}.${skippedText(r.skipped, " Si cambia dal team della realizzazione.")}`;
}

/** Il messaggio dopo «Togli» di una persona di Lateral Space. */
export function lsRemovedText(r: { done: readonly string[]; skipped: readonly { code: string; reason: string }[]; released: number }): string {
  const tasks = r.released ? ` I compiti che aveva lì tornano da prendere (${r.released}).` : "";
  return `Fuori dal team del cliente: esce da ${casesText(r.done.length)} e non entra nei casi nuovi.${tasks}${skippedText(r.skipped, " Si cambia dal team della realizzazione.")}`;
}

/**
 * Il messaggio dopo «Aggiungi» di chi costruisce da fuori. «Nessun caso aperto ancora» solo quando non ci sono casi
 * aperti da prendere: se ci sono e sono stati tutti saltati, lo dice e dice perché.
 */
export function externalAddedText(r: ExternalAddedFacts): string {
  const building = r.entered.length + r.already.length;
  const where =
    building > 0
      ? `Costruisce in ${casesText(building)}${r.where.all ? " ed entrerà in quelli nuovi" : ""}.`
      : r.skipped.length > 0
        ? r.where.all
          ? "Per ora non costruisce in nessun caso aperto: entrerà in quelli nuovi."
          : "Per ora non costruisce in nessuno dei casi scelti."
        : r.where.all
          ? "Nessun caso aperto ancora: entrerà in ognuno appena lo avvii."
          : "Nessuno dei casi scelti è aperto ancora: entrerà in ognuno appena lo avvii.";
  const left = r.left.length ? ` Esce da ${casesText(r.left.length)}${r.released ? ": i compiti che aveva lì tornano da prendere" : ""}.` : "";
  const github = r.repos.length ? ` Su GitHub dagli la scrittura su ${reposText(r.repos)}.` : " I repository dei casi non ci sono ancora: quando li crei, dagli la scrittura.";
  return `${where}${left}${github}${skippedText(r.skipped)}`;
}

/** Il messaggio dopo «Togli» di chi costruisce da fuori. I casi da cui esce solo se ce ne sono. */
export function externalRemovedText(r: ExternalRemovedFacts): string {
  const github = r.repos.length ? `GitHub (${reposText(r.repos)}) e la sua chiave dell'AI Gateway` : "la sua chiave dell'AI Gateway";
  const stays = r.skipped.length ? ` In ${r.skipped.slice(0, 5).map((s) => s.code).join(", ")} resta nella realizzazione da osservatore, senza poteri: lì non sei responsabile.` : "";
  const left = r.left.length ? `: esce da ${casesText(r.left.length)}` : "";
  return `Non costruisce più${left}. Ricorda ${github}.${stays}`;
}

/**
 * (8.2b) In fondo alla conferma di «Togli», quando un repository dei suoi casi ha una chiave della CI viva: su GitHub
 * Free i workflow dei rami leggono i segreti del repository, e una chiave copiata vale finché nessuno la ruota.
 */
export function ciRotateAfterRemoveText(repos: readonly string[]): string {
  if (!repos.length) return "";
  return repos.length === 1 ? ` Ruota anche la chiave della CI di ${repos[0]}.` : ` Ruota anche le chiavi della CI di ${reposText(repos)}.`;
}

/**
 * La conferma di «Togli» per chi costruisce da fuori: titolo e testo. `openCases`: i dossier aperti dove ha davvero la
 * riga `osservatore` (quelli da cui esce), non quelli che la concessione copre. (8.2b) `ciRepos`: i suoi repository con
 * una chiave della CI viva, da ruotare.
 */
export function externalRemoveConfirm(i: { name: string; openCases: number; repos: readonly string[]; ciRepos?: readonly string[] }): { title: string; text: string } {
  const github = i.repos.length ? ` Su GitHub togli anche il suo accesso a ${reposText(i.repos)}.` : "";
  const cases = i.openCases > 0 ? ` Esce da ${casesText(i.openCases)} e i compiti che ha in corso tornano da prendere.` : "";
  return {
    title: `Togliere ${i.name} da chi costruisce?`,
    text: `Da subito non scrive più nei casi del cliente e non entra in quelli nuovi.${cases}${github}${ciRotateAfterRemoveText(i.ciRepos ?? [])}`,
  };
}

/** Lo stato della riga: la CLI, oppure perché da fuori oggi non costruisce. */
export function builderStateText(i: { cli: boolean; blocked: string | null }): string {
  if (i.blocked === "ruolo_workspace") return "non costruisce: serve il ruolo di Analista";
  if (i.blocked === "email_non_verificata") return "non costruisce: serve l'e-mail verificata";
  if (i.blocked) return "non costruisce";
  return i.cli ? "CLI collegata" : "CLI da collegare";
}

/** Accanto al nome nell'elenco di «Persona»: perché da fuori oggi non può costruire (non si sceglie). */
export const BLOCKED_CANDIDATE_NOTE: Readonly<Record<string, string>> = {
  ruolo_workspace: "serve il ruolo di Analista",
  email_non_verificata: "serve l'e-mail verificata",
  di_lateral_space: "è di Lateral Space",
  non_collaboratore: "non fa parte del workspace",
};

/** Una persona dell'elenco di «Persona», con il perché da fuori oggi non può costruire (null se può, o se è di Lateral Space). */
export interface BuilderCandidateView {
  userId: string;
  name: string;
  isLateralSpace: boolean;
  blocked: string | null;
}

/**
 * I gruppi di «Persona» in «Chi costruisce»: «Lateral Space» ed «Esterni», per nome. Chi da fuori oggi non può costruire
 * (Contributore, e-mail da verificare) c'è, ma non si sceglie, con il perché: «Aggiungi» lo rifiuterebbe.
 */
export function builderCandidateGroups(candidates: readonly BuilderCandidateView[]): { label: string; options: { value: string; label: string; disabled?: boolean; note?: string }[] }[] {
  const sorted = [...candidates].sort((a, b) => a.name.localeCompare(b.name, "it"));
  const option = (c: BuilderCandidateView) =>
    c.blocked ? { value: c.userId, label: c.name, disabled: true, note: BLOCKED_CANDIDATE_NOTE[c.blocked] ?? "non può costruire" } : { value: c.userId, label: c.name };
  return [
    { label: "Lateral Space", options: sorted.filter((c) => c.isLateralSpace).map(option) },
    { label: "Esterni", options: sorted.filter((c) => !c.isLateralSpace).map(option) },
  ].filter((g) => g.options.length > 0);
}

/** «tutti i casi», oppure i codici dei casi scelti (al massimo 3, poi quanti altri). */
export function builderWhereText(where: BuilderWhere, codes: readonly string[]): string {
  if (where.all) return "tutti i casi";
  const shown = codes.slice(0, 3).join(", ");
  return codes.length > 3 ? `${shown} e altri ${codes.length - 3}` : shown || "nessun caso";
}
