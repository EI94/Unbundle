/**
 * Nomi e descrizioni dei ruoli, in un posto solo: scheda Collaboratori,
 * pagina dell'invito e messaggi dicono la stessa cosa. Le descrizioni
 * seguono i controlli reali (src/lib/workspace-permissions.ts): chi le
 * cambia deve cambiare anche quelli.
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
    can: ["Vede e modifica tutto il workspace", "Valuta e organizza gli use case", "Invita e rimuove le persone"],
  },
  function_lead: {
    label: "Responsabile di funzione",
    summary: "valuta gli use case e organizza le wave",
    can: ["Vede tutto il workspace", "Propone e valuta gli use case", "Organizza le wave e genera analisi"],
    cannot: ["Non invita persone e non cambia le impostazioni"],
  },
  analyst: {
    label: "Analista",
    summary: "propone e valuta gli use case",
    can: ["Vede tutto il workspace", "Propone e valuta gli use case", "Genera analisi e report"],
    cannot: ["Non invita persone e non cambia le impostazioni"],
  },
  contributor: {
    label: "Contributore",
    summary: "vede il workspace e propone idee",
    can: ["Vede il workspace", "Propone nuovi use case"],
    cannot: ["Non valuta gli use case e non genera analisi"],
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
