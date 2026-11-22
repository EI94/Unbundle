/**
 * Nomi e descrizioni dei ruoli, in un posto solo: scheda Collaboratori,
 * pagina dell'invito e messaggi dicono la stessa cosa. Le descrizioni
 * seguono i controlli reali (src/lib/workspace-permissions.ts): chi le
 * cambia deve cambiare anche quelli.
 *
 * Use case (docs/use-case/DESIGN.md §14.4): decidono tutti i revisori (D3); i
 * contributori vedono la fase delle proposte e, dei propri use case, codice e nota
 * pubblica, mai valutazioni, costi e note interne (D4, D13), in ogni workspace.
 */

export type RoleInfo = { label: string; summary: string; can: string[]; cannot?: string[] };

export const ROLE_INFO: Record<string, RoleInfo> = {
  exec_sponsor: {
    label: "Sponsor esecutivo",
    summary: "gestisce tutto il workspace",
    can: ["Vede e modifica tutto il workspace", "Invita e rimuove le persone", "Gestisce integrazioni e impostazioni"],
  },
  transformation_lead: {
    label: "Responsabile della trasformazione",
    summary: "gestisce tutto il workspace, anche chi ha accesso",
    can: ["Vede e modifica tutto il workspace", "Valuta e decide gli use case", "Invita e rimuove le persone"],
  },
  function_lead: {
    label: "Responsabile di funzione",
    summary: "valuta e decide gli use case",
    can: ["Vede tutto il workspace", "Propone e valuta gli use case", "Decide se e quando fare gli use case"],
    cannot: ["Non invita persone e non cambia le impostazioni del workspace"],
  },
  analyst: {
    label: "Analista",
    summary: "propone, valuta e decide gli use case",
    can: ["Vede tutto il workspace", "Propone, valuta e decide gli use case", "Genera analisi e report"],
    cannot: ["Non invita persone e non cambia le impostazioni"],
  },
  contributor: {
    label: "Contributore",
    summary: "vede il workspace e propone idee",
    can: ["Vede il workspace", "Propone nuovi use case e ne vede la fase; dei propri vede anche codice e nota pubblica"],
    cannot: ["Non vede valutazioni, costi e note interne"],
  },
  learner: {
    label: "Partecipante al corso",
    summary: "vede solo i propri corsi",
    can: ["Segue i corsi a cui è iscritto"],
  },
  // (8.0d) «Solo questo use case» (`esterno_caso`): lo dà Lateral Space con un invito, mai un invito da Persone
  // (`INVITABLE_ROLES` non lo contiene). Le porte lo tengono nel suo perimetro (src/lib/auth/case-only.ts).
  esterno_caso: {
    label: "Solo questo use case",
    summary: "costruisce un solo use case dall'Agent Factory",
    can: ["Costruisce un solo use case dall'Agent Factory"],
    cannot: ["Non vede il resto del workspace"],
  },
};

/**
 * (Rilascio 10, §4, §3.11) Gli stessi ruoli come li legge chi apre un invito, fuori dalla dashboard: «caso d'uso», mai
 * «use case». I nomi sono gli stessi di `ROLE_INFO`.
 */
export const ROLE_INFO_OUTSIDE: Record<string, RoleInfo> = {
  exec_sponsor: ROLE_INFO.exec_sponsor,
  transformation_lead: {
    label: ROLE_INFO.transformation_lead.label,
    summary: ROLE_INFO.transformation_lead.summary,
    can: ["Vede e modifica tutto il workspace", "Valuta e decide i casi d'uso", "Invita e rimuove le persone"],
  },
  function_lead: {
    label: ROLE_INFO.function_lead.label,
    summary: "valuta e decide i casi d'uso",
    can: ["Vede tutto il workspace", "Propone e valuta i casi d'uso", "Decide se e quando fare i casi d'uso"],
    cannot: ROLE_INFO.function_lead.cannot,
  },
  analyst: {
    label: ROLE_INFO.analyst.label,
    summary: "propone, valuta e decide i casi d'uso",
    can: ["Vede tutto il workspace", "Propone, valuta e decide i casi d'uso", "Genera analisi e report"],
    cannot: ROLE_INFO.analyst.cannot,
  },
  contributor: {
    label: ROLE_INFO.contributor.label,
    summary: ROLE_INFO.contributor.summary,
    can: ["Vede il workspace", "Propone nuovi casi d'uso e ne vede la fase; dei propri vede anche codice e nota pubblica"],
    cannot: ROLE_INFO.contributor.cannot,
  },
  learner: ROLE_INFO.learner,
  // (8.0d) Fuori dalla dashboard «caso d'uso», anche nel nome del ruolo (RILASCIO-8.0d-ESTERNI-FASE-2.md, intestazione).
  esterno_caso: {
    label: "Solo questo caso d'uso",
    summary: "costruisce un solo caso d'uso dall'Agent Factory",
    can: ["Costruisce un solo caso d'uso dall'Agent Factory"],
    cannot: ROLE_INFO.esterno_caso.cannot,
  },
};

/**
 * (8.0d) Il cambio di ruolo di «Solo questo use case» da Impostazioni › Persone non si fa: lo dicono la riga e il rifiuto
 * del server. Per aprirle il workspace serve un invito da collaboratore.
 */
export const CASE_ONLY_ROLE_NOTE = "Questa persona lavora a un solo use case. Per aprirle il workspace serve un invito da collaboratore.";

/** Ruoli che un invito può assegnare, dal più limitato al più ampio. */
export const INVITABLE_ROLES = ["contributor", "analyst", "function_lead", "transformation_lead"] as const;

export function roleLabel(role: string | null | undefined) {
  return (role && ROLE_INFO[role]?.label) ?? role ?? "—";
}
