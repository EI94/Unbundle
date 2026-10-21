/**
 * Nomi e descrizioni dei ruoli, in un posto solo: scheda Collaboratori,
 * pagina dell'invito e messaggi dicono la stessa cosa. Le descrizioni
 * seguono i controlli reali (src/lib/workspace-permissions.ts): chi le
 * cambia deve cambiare anche quelli.
 *
 * Use case (docs/use-case/DESIGN.md §14.4): decidono tutti i revisori (D3); i
 * contributori vedono la fase delle proposte e, delle proprie, codice e nota
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
    can: ["Vede il workspace", "Propone nuovi use case e ne vede la fase; delle proprie vede anche codice e nota pubblica"],
    cannot: ["Non vede valutazioni, costi e note interne"],
  },
  learner: {
    label: "Partecipante al corso",
    summary: "vede solo i propri corsi",
    can: ["Segue i corsi a cui è iscritto"],
  },
};

/** Ruoli che un invito può assegnare, dal più limitato al più ampio. */
export const INVITABLE_ROLES = ["contributor", "analyst", "function_lead", "transformation_lead"] as const;

export function roleLabel(role: string | null | undefined) {
  return (role && ROLE_INFO[role]?.label) ?? role ?? "—";
}
