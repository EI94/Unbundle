/**
 * Perimetro di chi entra da un link di corso.
 *
 * Il layout del workspace apre la navigazione a chiunque abbia una membership,
 * e la barra laterale elenca sedici voci — Strategia, Report, Blueprints,
 * Intelligence comprese. Un partecipante a mezza giornata di corso vedrebbe il
 * piano di trasformazione del proprio datore di lavoro, e un'informazione
 * vista non si ritira.
 *
 * I controlli di ruolo del prodotto sono tutti whitelist, quindi `learner`
 * nega per default. Questo modulo aggiunge la misura positiva: una sola
 * funzione, usata dal layout e dalla barra laterale, che dice se l'account va
 * tenuto dentro la sola area Formazione.
 */

export const LEARNER_ROLE = "learner";

/** True quando l'unico titolo d'accesso e' seguire un corso. */
export function isLearnerOnly(role: string | null | undefined) {
  return role === LEARNER_ROLE;
}

/** Radice consentita a un learner dentro un workspace. */
export function learnerHomePath(workspaceId: string) {
  return `/dashboard/${workspaceId}/learning`;
}

/**
 * Il percorso richiesto e' dentro l'area Formazione del workspace?
 *
 * Confronta sui segmenti e non con startsWith, altrimenti un percorso come
 * `/dashboard/<ws>/learning-admin-altro` passerebbe per il fatto di cominciare
 * con la stessa stringa.
 */
export function isWithinLearnerScope(pathname: string, workspaceId: string) {
  const segments = pathname.split("?")[0].split("#")[0].split("/").filter(Boolean);
  return (
    segments[0] === "dashboard" &&
    segments[1] === workspaceId &&
    segments[2] === "learning"
  );
}

/**
 * Dove mandare un learner che ha chiesto un percorso fuori dal suo perimetro.
 * Restituisce null quando il percorso e' legittimo e non serve nessun
 * reindirizzamento.
 */
export function learnerRedirect(params: {
  role: string | null | undefined;
  pathname: string;
  workspaceId: string;
}) {
  if (!isLearnerOnly(params.role)) return null;
  if (isWithinLearnerScope(params.pathname, params.workspaceId)) return null;
  return learnerHomePath(params.workspaceId);
}
