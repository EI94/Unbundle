/**
 * Chi fa cosa nell'impostazione di un caso (rilascio 8.0a, docs/rilascio-8/RILASCIO-8.0-PIANO.md §2 e §8; 8.0c,
 * RILASCIO-8.0c-ESTERNI.md §3). Si guardano i ruoli della fabbrica (`builders.ts`): i ruoli del caso che valgono
 * adesso (`uc_case_members`, già effettivo: chi gestisce il workspace è osservatore), più `builder_esterno` per chi
 * costruisce il caso da fuori Lateral Space.
 *
 * - **Leggere** progetto, decisioni e pacchetto: chiunque sia nel team del caso.
 * - **Scrivere** il progetto, le decisioni, il pacchetto: chi costruisce (`FACTORY_BUILDER_ROLES`: responsabile,
 *   analisti, sviluppatori di Lateral Space; dalla 8.0c chi costruisce da fuori).
 * - **Approvare** il progetto, e **riaprirlo** quando è da approvare: solo il responsabile del caso (`ls_lead`).
 *   Riaprire fa decadere l'ok dell'AI Board, che va chiesto di nuovo.
 * - **L'ok dell'AI Board** agli strumenti nuovi: chi ha il ruolo `ai_board`; se nel team non c'è, il
 *   responsabile del caso, con una nota obbligatoria su chi l'ha dato e quando (scelta 2 del piano).
 * - **Chiedere una modifica** invece dell'ok: solo chi ha il ruolo `ai_board`, con una nota.
 *
 * Chi costruisce da fuori non approva, non riapre, non dà l'ok dell'AI Board e non chiede modifiche: così chi scrive
 * non approva mai da solo.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { FACTORY_BUILDER_ROLES, type FactoryRole } from "./builders.ts";

/** La nota dell'ok dell'AI Board scritto dal responsabile: chi l'ha dato e quando, almeno così. */
export const AI_BOARD_NOTE_MIN = 10;

export function canReadFactory(roles: readonly FactoryRole[]): boolean {
  return roles.length > 0;
}

export function canWriteFactory(roles: readonly FactoryRole[]): boolean {
  return roles.some((role) => FACTORY_BUILDER_ROLES.includes(role));
}

export function canApproveProject(roles: readonly FactoryRole[]): boolean {
  return roles.includes("ls_lead");
}

/** Riportare in corso un progetto da approvare: chi lo approva, perché fa decadere l'ok dell'AI Board. */
export const canReopenProject = canApproveProject;

/** Chiedere una modifica agli strumenti nuovi invece di dare l'ok: l'AI Board del cliente. */
export function canRequestProjectChange(roles: readonly FactoryRole[]): boolean {
  return roles.includes("ai_board");
}

/**
 * Chi può registrare l'ok dell'AI Board, e se serve la nota. `ai_board` lo registra da sé; il responsabile solo
 * con la nota; nessun altro.
 */
export function aiBoardOkRule(roles: readonly FactoryRole[]): { allowed: boolean; noteRequired: boolean } {
  if (roles.includes("ai_board")) return { allowed: true, noteRequired: false };
  if (roles.includes("ls_lead")) return { allowed: true, noteRequired: true };
  return { allowed: false, noteRequired: false };
}

/**
 * I ruoli che ricevono le notifiche dell'Agent Factory. Con `builder_esterno` nel tipo, anche chi costruisce il caso da
 * fuori, adesso (il predicato di `use-case-builders.ts`).
 */
export const FACTORY_RECIPIENTS = Object.freeze({
  /** «Progetto da approvare». */
  progetto_appr: ["ls_lead"] as readonly FactoryRole[],
  /** «Strumento nuovo da approvare»: l'AI Board del cliente. Il responsabile lo sa da «Progetto da approvare». */
  strumento_nuovo: ["ai_board"] as readonly FactoryRole[],
  /** «Il pacchetto è cambiato»: chi costruisce. */
  pacchetto_nuovo: FACTORY_BUILDER_ROLES,
  /** «Progetto approvato»: chi costruisce, il responsabile del cliente e l'AI Board. */
  progetto_ok: [...FACTORY_BUILDER_ROLES, "owner_cliente", "ai_board"] as readonly FactoryRole[],
  /** «L'AI Board chiede una modifica»: chi costruisce, che la fa. */
  modifica_chiesta: FACTORY_BUILDER_ROLES,
  /** «L'ok dell'AI Board è da rifare»: l'AI Board, quando il responsabile riapre un progetto che aveva il suo ok. */
  ok_decaduto: ["ai_board"] as readonly FactoryRole[],
  /** (8.0b) «Un coding agent propone una domanda»: chi prepara le domande per il referente nel team di Lateral Space. */
  domanda_agente: ["ls_lead", "ls_analista"] as readonly FactoryRole[],
});
