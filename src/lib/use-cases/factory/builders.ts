/**
 * I ruoli dell'Agent Factory (rilascio 8.0c «Esterni al 100%», docs/rilascio-8/RILASCIO-8.0c-ESTERNI.md §2 e §7).
 *
 * - **`builder_esterno`, «Sviluppatore esterno»:** un ruolo che vale solo nella fabbrica. Non è un ruolo del dossier:
 *   non entra in `CASE_ROLES` né in `uc_case_members`, vive solo qui, mai nel database. `FactoryRole` comprende
 *   `CaseRole`, non il contrario: passarlo a `can()` o a `UcCommandContext` non compila.
 * - **Chi costruisce** (`FACTORY_BUILDER_ROLES`): i tre ruoli di Lateral Space più `builder_esterno`. È l'unico elenco
 *   dei moduli della fabbrica: le copie di `ls_lead, ls_analista, ls_sviluppatore` non ci sono più (prova di guardia).
 * - **`factoryAccessOf`:** i ruoli della fabbrica di una persona in un caso. Quelli del caso che valgono adesso
 *   (`uc-access.ts`, invariato), più `builder_esterno` se il predicato (`use-case-builders.ts`) è vero. Per chi non è
 *   esterno ruoli e sola lettura sono quelli di oggi.
 * - **`mayBeExternalBuilder`:** il filtro senza database, prima del predicato. Una persona di Lateral Space, chi nel
 *   caso ha un altro ruolo oltre a osservatore, chi non è nel team (l'osservatore implicito), chi non ha l'e-mail
 *   verificata, o senza domini di Lateral Space configurati: la lettura non si fa. Per Leo non cambia niente.
 *
 * Modulo puro: import relativi `.ts`.
 */
import { LS_CASE_ROLES, type CaseRole } from "../../uc/vocab.ts";

/** Il ruolo della fabbrica di chi costruisce da fuori Lateral Space. */
export const EXTERNAL_BUILDER_ROLE = "builder_esterno" as const;
export type ExternalBuilderRole = typeof EXTERNAL_BUILDER_ROLE;

/** Un ruolo nell'Agent Factory: un ruolo del caso, oppure `builder_esterno`. */
export type FactoryRole = CaseRole | ExternalBuilderRole;

/** Chi costruisce: il team di Lateral Space del caso e chi costruisce da fuori. */
export const FACTORY_BUILDER_ROLES: readonly FactoryRole[] = Object.freeze([...LS_CASE_ROLES, EXTERNAL_BUILDER_ROLE]);

/** I ruoli di Lateral Space che costruiscono, come elenco per le query sui ruoli salvati (`uc_case_members`). */
export const LS_BUILDER_ROLES: readonly CaseRole[] = Object.freeze([...LS_CASE_ROLES]);

export function isFactoryBuilderRole(role: string): role is FactoryRole {
  return (FACTORY_BUILDER_ROLES as readonly string[]).includes(role);
}

/** Quello che serve dell'accesso al caso (`CaseAccess` di `uc-access.ts`). */
export interface FactoryCaseAccess {
  /** I ruoli che valgono adesso. */
  roles: readonly CaseRole[];
  /** I ruoli salvati in `uc_case_members`. */
  storedRoles: readonly CaseRole[];
  implicitObserver: boolean;
  readOnly: boolean;
  lsConfigured: boolean;
  user: { isLateralSpace: boolean; emailVerified: boolean };
}

/** I ruoli della fabbrica di una persona in un caso, e se lì scrive. */
export interface FactoryAccess {
  roles: FactoryRole[];
  /** Sola lettura: domini di Lateral Space non configurati, oppure solo `osservatore`. */
  readOnly: boolean;
  /** Costruisce il caso da fuori Lateral Space (il predicato è vero). */
  external: boolean;
}

/**
 * Il filtro senza database: falso quando la persona non può essere sviluppatore esterno del caso, e allora il
 * predicato non si legge. Vero solo per chi ha nel caso soltanto la riga `osservatore`, ha l'e-mail verificata, non è
 * di Lateral Space, con i domini di Lateral Space configurati. Il resto (concessione, ruolo nel workspace, dominio
 * riletto) lo dice il predicato.
 */
export function mayBeExternalBuilder(a: FactoryCaseAccess): boolean {
  if (!a.lsConfigured || a.implicitObserver || a.user.isLateralSpace || a.user.emailVerified !== true) return false;
  return a.storedRoles.length > 0 && a.storedRoles.every((role) => role === "osservatore");
}

/**
 * I ruoli della fabbrica: quelli del caso più `builder_esterno` se `external` (il predicato). Sola lettura con i domini
 * di Lateral Space non configurati, oppure con solo `osservatore`; per chi non è esterno, il valore di oggi.
 */
export function factoryAccessOf(a: Pick<FactoryCaseAccess, "roles" | "readOnly" | "lsConfigured">, external: boolean): FactoryAccess {
  if (!external) return { roles: [...a.roles], readOnly: a.readOnly, external: false };
  const roles: FactoryRole[] = [...a.roles, EXTERNAL_BUILDER_ROLE];
  return { roles, readOnly: !a.lsConfigured || roles.every((role) => role === "osservatore"), external: true };
}
