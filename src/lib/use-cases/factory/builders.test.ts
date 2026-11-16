import test from "node:test";
import assert from "node:assert/strict";
import { CASE_ROLES, CLIENT_CASE_ROLES, LS_CASE_ROLES, SHARED_CASE_ROLES, type CaseRole } from "../../uc/vocab.ts";
import { can, type CaseAction } from "../../uc/permissions.ts";
import type { UcCommandContext } from "../../db/queries/uc-cases.ts";
import { EXTERNAL_BUILDER_ROLE, FACTORY_BUILDER_ROLES, factoryAccessOf, isFactoryBuilderRole, mayBeExternalBuilder, type FactoryCaseAccess, type FactoryRole } from "./builders.ts";
import { aiBoardOkRule, canApproveProject, canReadFactory, canReopenProject, canRequestProjectChange, canWriteFactory, FACTORY_RECIPIENTS } from "./permissions.ts";

// I ruoli dell'Agent Factory (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §7 e §9, U1, U2 e U5).

/** Tutti i sottoinsiemi dei ruoli del caso: 2^7 combinazioni. */
function subsets<T>(items: readonly T[]): T[][] {
  return items.reduce<T[][]>((acc, item) => acc.concat(acc.map((s) => [...s, item])), [[]]);
}

type UserKind = "ls" | "cliente" | "non_verificata";
const USERS: Record<UserKind, FactoryCaseAccess["user"]> = {
  ls: { isLateralSpace: true, emailVerified: true },
  cliente: { isLateralSpace: false, emailVerified: true },
  non_verificata: { isLateralSpace: false, emailVerified: false },
};

/**
 * L'accesso di oggi per una combinazione (la regola di `caseAccessFromRow`): i ruoli che valgono, l'osservatore implicito
 * per chi gestisce il workspace, la sola lettura. Serve solo a generare combinazioni realistiche: la prova vera è che la
 * fabbrica le restituisce uguali.
 */
function accessToday(stored: CaseRole[], kind: UserKind, manager: boolean, lsConfigured: boolean): FactoryCaseAccess | null {
  const user = USERS[kind];
  const allowed = (r: CaseRole) =>
    (LS_CASE_ROLES as readonly string[]).includes(r) ? user.isLateralSpace && lsConfigured : (CLIENT_CASE_ROLES as readonly string[]).includes(r) ? !user.isLateralSpace && user.emailVerified : true;
  let roles = stored.filter(allowed);
  let implicitObserver = false;
  if (roles.length === 0) {
    if (stored.length === 0 && !manager) return null;
    roles = ["osservatore"];
    implicitObserver = stored.length === 0;
  }
  return { roles, storedRoles: stored, implicitObserver, readOnly: !lsConfigured || roles.every((r) => r === "osservatore"), lsConfigured, user };
}

test("U1: per chi non è esterno ruoli e sola lettura della fabbrica sono quelli di oggi, per ogni combinazione", () => {
  let checked = 0;
  for (const stored of subsets(CASE_ROLES)) {
    for (const kind of Object.keys(USERS) as UserKind[]) {
      for (const manager of [false, true]) {
        for (const lsConfigured of [false, true]) {
          const today = accessToday(stored, kind, manager, lsConfigured);
          if (!today) continue;
          const factory = factoryAccessOf(today, false);
          assert.deepEqual(factory.roles, today.roles);
          assert.equal(factory.readOnly, today.readOnly);
          assert.equal(factory.external, false);
          checked++;
        }
      }
    }
  }
  assert.ok(checked > 1000, `${checked} combinazioni`);
});

test("U1: il filtro senza database apre la lettura solo a chi ha soltanto la riga osservatore, è del cliente, verificato, con i domini", () => {
  for (const stored of subsets(CASE_ROLES)) {
    for (const kind of Object.keys(USERS) as UserKind[]) {
      for (const manager of [false, true]) {
        for (const lsConfigured of [false, true]) {
          const today = accessToday(stored, kind, manager, lsConfigured);
          if (!today) continue;
          const expected = lsConfigured && kind === "cliente" && stored.length === 1 && stored[0] === "osservatore";
          assert.equal(mayBeExternalBuilder(today), expected, JSON.stringify({ stored, kind, manager, lsConfigured }));
        }
      }
    }
  }
  // Leo (Lateral Space, sviluppatore) non passa mai dal predicato: per lui non cambia niente.
  const leo = accessToday(["ls_sviluppatore"], "ls", false, true)!;
  assert.equal(mayBeExternalBuilder(leo), false);
  assert.deepEqual(factoryAccessOf(leo, false), { roles: ["ls_sviluppatore"], readOnly: false, external: false, blocked: null });
});

test("U1: chi è esterno ha osservatore più builder_esterno e scrive; senza domini resta in sola lettura", () => {
  const alessio = accessToday(["osservatore"], "cliente", false, true)!;
  assert.equal(alessio.readOnly, true, "oggi l'osservatore legge soltanto");
  assert.deepEqual(factoryAccessOf(alessio, true), { roles: ["osservatore", "builder_esterno"], readOnly: false, external: true, blocked: null });
  assert.equal(factoryAccessOf({ ...alessio, lsConfigured: false }, true).readOnly, true);
  // La 0037 non pronta e una concessione: legge come oggi, e le porte dicono «riprova».
  assert.deepEqual(factoryAccessOf(alessio, false, "non_disponibile"), { roles: ["osservatore"], readOnly: true, external: false, blocked: "non_disponibile" });
});

test("U2: con osservatore e builder_esterno si scrive, ma non si approva, non si riapre, niente ok dell'AI Board né modifiche", () => {
  const roles: FactoryRole[] = ["osservatore", "builder_esterno"];
  assert.equal(canReadFactory(roles), true);
  assert.equal(canWriteFactory(roles), true);
  assert.equal(canApproveProject(roles), false);
  assert.equal(canReopenProject(roles), false);
  assert.deepEqual(aiBoardOkRule(roles), { allowed: false, noteRequired: false });
  assert.equal(canRequestProjectChange(roles), false);
  // Il responsabile approva come oggi; un osservatore da solo non scrive.
  assert.equal(canApproveProject(["ls_lead"]), true);
  assert.equal(canWriteFactory(["osservatore"]), false);
  assert.equal(canWriteFactory(["owner_cliente", "ai_board"]), false);
});

test("chi costruisce: i tre ruoli di Lateral Space più builder_esterno; le notifiche che lo comprendono", () => {
  assert.deepEqual([...FACTORY_BUILDER_ROLES], [...LS_CASE_ROLES, "builder_esterno"]);
  assert.equal(EXTERNAL_BUILDER_ROLE, "builder_esterno");
  assert.ok(isFactoryBuilderRole("builder_esterno") && isFactoryBuilderRole("ls_lead") && !isFactoryBuilderRole("osservatore"));
  for (const kind of ["pacchetto_nuovo", "progetto_ok", "modifica_chiesta"] as const) assert.ok(FACTORY_RECIPIENTS[kind].includes("builder_esterno"), kind);
  // Restano a Lateral Space e all'AI Board.
  for (const kind of ["progetto_appr", "strumento_nuovo", "ok_decaduto", "domanda_agente"] as const) assert.ok(!FACTORY_RECIPIENTS[kind].includes("builder_esterno"), kind);
});

test("U5: CASE_ROLES = ruoli di Lateral Space + del cliente + osservatore, senza resti; builder_esterno non è un ruolo del dossier", () => {
  const known = [...LS_CASE_ROLES, ...CLIENT_CASE_ROLES, ...SHARED_CASE_ROLES];
  assert.deepEqual([...CASE_ROLES].sort(), [...known].sort(), "un ruolo nuovo del dossier deve trovare il suo posto");
  assert.equal(new Set(known).size, known.length);
  assert.ok(!(CASE_ROLES as readonly string[]).includes("builder_esterno"));
});

test("U5: i ruoli della fabbrica non entrano nei comandi del dossier (lo controlla il compilatore)", () => {
  const factoryRoles: FactoryRole[] = ["osservatore", "builder_esterno"];
  const action: CaseAction = "vedere_sintesi";
  // @ts-expect-error `can()` vuole i ruoli del caso, non quelli della fabbrica
  assert.equal(can(factoryRoles, action), true, "a runtime builder_esterno non dà niente: vale solo osservatore");
  // @ts-expect-error builder_esterno non è un ruolo del caso
  const ctx: UcCommandContext = { workspaceId: "w", caseId: "c", actor: { type: "utente", userId: "u", roles: factoryRoles }, user: null, lsDomains: [] };
  assert.equal(ctx.actor.type, "utente");
  // @ts-expect-error nemmeno da solo
  const role: CaseRole = EXTERNAL_BUILDER_ROLE;
  assert.equal(role, "builder_esterno");
});
