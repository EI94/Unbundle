/**
 * I testi della CI di una famiglia nell'Agent Factory (rilascio 8.2b, docs/rilascio-8/RILASCIO-8.2b-SPEC.md §2.6): la
 * riga sotto i casi, i pulsanti, le finestre («Collega la CI», «Ruota», «Revoca», la chiave che si vede una volta) e
 * «Da fare per te». Le regole (lo stato di un repository, chi gestisce le chiavi, la rotazione) stanno in
 * `src/lib/use-cases/ci/keys.ts`; i rifiuti delle azioni in `CI_KEY_ACTION_TEXT`, nello stesso modulo.
 *
 * - Nella dashboard «casi» e «use case», mai «caso d'uso»; testi senza genere.
 * - `{nome}` è il repository senza l'organizzazione, `{repo}` quello intero.
 * - Le date come le altre della pagina: «17/05/2027», a Roma.
 * - Il passo su GitHub è quello dei segreti del repository (GitHub Free, D10): il job «unbundle» del modello 1.7.0 non
 *   usa ancora l'ambiente `unbundle`, quindi un segreto d'ambiente oggi non lo leggerebbe.
 *
 * Modulo puro e senza import: lo usano la pagina (sul server) e i pulsanti della riga (nel browser), che non devono
 * portarsi dietro le regole della chiave (`node:crypto`).
 */

/** Il nome del segreto su GitHub: lo stesso di `CI_SECRET_NAME` (una prova li tiene uguali). */
export const CI_SECRET = "UNBUNDLE_CI_TOKEN";

const DAY = new Intl.DateTimeFormat("it-IT", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
/** Il giorno a Roma come «2026-11-18», per contare i giorni di calendario. */
const ROME_DAY = new Intl.DateTimeFormat("en-CA", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Europe/Rome" });
const DAY_MS = 86_400_000;

/** «17/05/2027», a Roma; una data che non si legge: stringa vuota. */
export function ciDay(at: Date | string): string {
  const date = at instanceof Date ? at : new Date(at);
  return Number.isNaN(date.getTime()) ? "" : DAY.format(date);
}

/** I giorni di calendario a Roma da `from` a `to` (0 lo stesso giorno). */
function romeDaysBetween(from: Date, to: Date): number {
  const day = (d: Date) => Date.parse(`${ROME_DAY.format(d)}T00:00:00Z`);
  return Math.round((day(to) - day(from)) / DAY_MS);
}

/** L'ultimo invio della CI: «oggi», «ieri», altrimenti «il 15/11/2026». */
export function ciLastSendText(at: Date, now: Date): string {
  const days = romeDaysBetween(at, now);
  if (days <= 0) return "oggi";
  if (days === 1) return "ieri";
  return `il ${ciDay(at)}`;
}

/** `{nome}`: il repository senza l'organizzazione (`Voltaen/esempio-rosa` → `esempio-rosa`). */
export function ciRepoShortName(repo: string): string {
  const at = repo.indexOf("/");
  return at >= 0 ? repo.slice(at + 1) : repo;
}

/** L'ancora della famiglia nella pagina, a cui portano «Da fare per te»: `famiglia-<nome>`. */
export function familyAnchor(repo: string): string {
  return `famiglia-${ciRepoShortName(repo)}`;
}

export const CI_TEXT = Object.freeze({
  /** La riga della famiglia, sotto i casi: una frase per stato, con il puntino del suo colore. */
  row: Object.freeze({
    notReady: "Non ancora disponibile: riprova tra qualche minuto.",
    notConnected: "CI non collegata: le evals di main restano su GitHub.",
    neverUsed: (since: string) => `CI collegata il ${since}: le evals arrivano alla prossima unione su main.`,
    used: (lastSend: string, until: string) => `CI collegata · ultimo invio ${lastSend} · la chiave scade il ${until}`,
    expiring: (until: string) => `La chiave della CI scade il ${until}.`,
    rotation: (oldUntil: string) => `Chiave nuova da mettere su GitHub. La vecchia vale fino al primo invio con la nuova, al massimo fino al ${oldUntil}.`,
    expired: (on: string) => `La chiave della CI è scaduta il ${on}: la CI non manda più le evals.`,
  }),
  /** I pulsanti della riga e il «⋯», solo per chi gestisce le chiavi. */
  action: Object.freeze({
    connect: "Collega la CI",
    rotate: "Ruota la chiave",
    createNew: "Crea una chiave nuova",
    revoke: "Revoca la chiave",
    /** Il nome del «⋯» per i lettori di schermo. */
    menu: (name: string) => `Altre azioni sulla CI di ${name}`,
  }),
  connect: Object.freeze({
    title: (name: string) => `Collega la CI di ${name}`,
    body: "Dopo ogni unione su main, la CI di GitHub manderà qui le evals dei casi di questo repository. Serve una chiave, da mettere tra i segreti del repository.",
    confirm: "Crea la chiave",
  }),
  rotate: Object.freeze({
    title: (name: string) => `Ruotare la chiave della CI di ${name}?`,
    body: "Nasce una chiave nuova, da mettere su GitHub al posto della vecchia. La vecchia vale fino al primo invio con la nuova, al massimo 7 giorni.",
    confirm: "Ruota",
  }),
  revoke: Object.freeze({
    title: (name: string) => `Revocare la chiave della CI di ${name}?`,
    body: `Da subito la CI non manda più le evals a Unbundle. Su GitHub togli anche il segreto ${CI_SECRET}.`,
    confirm: "Revoca",
  }),
  /** La chiave, una volta sola: dopo «Fatto», o ricaricando la pagina, non si vede più. */
  key: Object.freeze({
    title: (name: string) => `La chiave della CI di ${name}`,
    titleRotated: (name: string) => `La chiave nuova della CI di ${name}`,
    copyNow: "Copiala adesso: dopo non si vede più.",
    /** Il nome del campo per i lettori di schermo. */
    field: "La chiave della CI",
    copy: "Copia",
    copied: "Copiata",
    copyFailed: "Non riesco a copiarla: selezionala nel campo e copiala a mano.",
    steps: (repo: string) => `Su GitHub, in ${repo}: Settings › Secrets and variables › Actions › New repository secret. Nome ${CI_SECRET}, valore la chiave.`,
    stepsRotated: (repo: string) => `Su GitHub, in ${repo}: Settings › Secrets and variables › Actions › ${CI_SECRET}. Mettila al posto della vecchia, con lo stesso nome.`,
    validity: (until: string) => `Vale fino al ${until}, solo per mandare le evals di main di questo repository.`,
    done: "Fatto",
  }),
  /** Dopo l'azione: l'avviso breve. */
  done: Object.freeze({
    created: "Chiave nuova creata: mettila su GitHub.",
    revoked: "Chiave revocata.",
  }),
  /** Un errore che non è un rifiuto con il suo testo (la rete, il server). */
  failed: "Non è stato possibile: riprova tra poco.",
  /** «Da fare per te», solo a chi gestisce le chiavi, con il link alla famiglia. */
  todo: Object.freeze({
    connect: (name: string) => `Collega la CI di ${name}: le evals di main arriveranno da sole.`,
    rotate: (name: string, until: string) => `Ruota la chiave della CI di ${name}: scade il ${until}.`,
    put: (name: string) => `Metti su GitHub la chiave nuova della CI di ${name}.`,
  }),
});
