/**
 * (Rilascio 10, ondata 7a «Formazione», docs/ui-10/PROPOSTA-10.md §3.9, audit Fuori §4.11) «Gestisci» un corso in
 * regole pure: le quattro schede e il loro indirizzo (`?scheda=`), il prossimo passo della scheda «Lezioni» (il solo
 * pulsante pieno: creare il link della prossima lezione, o aprirne l'ingresso), lo stato di un link e delle attività di
 * una lezione in parole, e il nome di un modulo senza il suo codice. Modulo puro: lo provano i test.
 */

export const ADMIN_TABS = ["lezioni", "materiali", "persone", "impostazioni"] as const;
export type AdminTab = (typeof ADMIN_TABS)[number];

/** La scheda dell'indirizzo; un valore sconosciuto vale «Lezioni», quella dell'aula. */
export function adminTab(raw: string | null | undefined): AdminTab {
  return (ADMIN_TABS as readonly string[]).includes(raw ?? "") ? (raw as AdminTab) : "lezioni";
}

/** L'indirizzo della scheda: «Lezioni» è quella di partenza e non ha bisogno del parametro. */
export function adminTabHref(pathname: string, search: string, tab: AdminTab): string {
  const query = new URLSearchParams(search);
  if (tab === "lezioni") query.delete("scheda");
  else query.set("scheda", tab);
  const rest = query.toString();
  return `${pathname}${rest ? `?${rest}` : ""}`;
}

export type LessonRow = { cohortId: string; startsAt: string; endsAt: string };
export type LinkRow = { id: string; cohortId: string; doorOpen: boolean; revokedAt: string | null; expiresAt: string };

/** Un link che vale ancora: non disattivato e non scaduto. */
export function linkUsable(link: Pick<LinkRow, "revokedAt" | "expiresAt">, now: number): boolean {
  return !link.revokedAt && Date.parse(link.expiresAt) > now;
}

/** Lo stato di un link in parole, con il tono del semaforo. */
export function linkState(link: Pick<LinkRow, "doorOpen" | "revokedAt" | "expiresAt">, now: number): { label: string; tone: "verde" | "giallo" | "grigio" } {
  if (link.revokedAt) return { label: "Disattivato", tone: "grigio" };
  if (Date.parse(link.expiresAt) <= now) return { label: "Scaduto", tone: "grigio" };
  return link.doorOpen ? { label: "Ingresso aperto", tone: "verde" } : { label: "Ingresso chiuso", tone: "giallo" };
}

/** Le attività di una lezione in parole, con il tono del semaforo: «secondo la scaletta», «aperte», «sospese». */
export function activitiesState(status: string): { label: string; tone: "blu" | "verde" | "giallo" } {
  if (status === "open") return { label: "Attività aperte", tone: "verde" };
  if (status === "closed") return { label: "Risposte sospese", tone: "giallo" };
  return { label: "Attività secondo la scaletta", tone: "blu" };
}

/**
 * Il prossimo passo della scheda «Lezioni», il suo solo pulsante pieno: per la prossima lezione non ancora finita
 * (la prima per data), creare il link se non ne ha uno valido, aprirne l'ingresso se è chiuso. Ingresso già aperto, o
 * nessuna lezione davanti: nessun pulsante pieno.
 */
export function lessonsNextStep(lessons: readonly LessonRow[], links: readonly LinkRow[], now: number): { cohortId: string; step: "create" | "openDoor"; linkId: string | null } | null {
  const next = [...lessons].filter((lesson) => Date.parse(lesson.endsAt) > now).sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt))[0];
  if (!next) return null;
  const usable = links.filter((link) => link.cohortId === next.cohortId && linkUsable(link, now));
  if (!usable.length) return { cohortId: next.cohortId, step: "create", linkId: null };
  if (usable.some((link) => link.doorOpen)) return null;
  return { cohortId: next.cohortId, step: "openDoor", linkId: usable[0].id };
}

/** «Modulo 2» al posto di «M2»: il codice del modulo non va a schermo. */
export function moduleLabel(moduleId: string | null | undefined): string {
  if (!moduleId) return "Tutto il corso";
  const match = /^m(\d+)$/i.exec(moduleId);
  return match ? `Modulo ${match[1]}` : moduleId;
}
