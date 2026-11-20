import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { bearerTokenFromHeader } from "../../connector/auth.ts";
import { CLI_TOKEN_PREFIX } from "../cli/codes.ts";
import {
  CI_IDEMPOTENCY_PREFIX,
  CI_KEY_ACTION_TEXT,
  CI_KEY_DAYS,
  CI_KEY_ERRORS,
  CI_KEY_MAX_LIVE,
  CI_KEY_PREFIX,
  CI_KEY_REMINDER_DAYS,
  CI_KEY_ROTATION_GRACE_DAYS,
  CI_MAIN_BRANCH,
  CI_SECRET_NAME,
  canManageCiKeysRule,
  checkCiRun,
  ciIdempotencyOwner,
  ciKeyCandidates,
  ciKeyDisplayPrefix,
  ciKeyExpiresAt,
  ciKeyFromAuthorization,
  ciKeyReminderDue,
  ciKeyRetentionDue,
  ciKeyTodo,
  ciRepoName,
  ciRowState,
  createRefusal,
  hashCiKey,
  isCiKey,
  newCiKey,
  normalizeCiRepo,
  rotateRefusal,
  rotatedOldUntil,
  rotationPending,
  type CiKeyRow,
} from "./keys.ts";

// La chiave della CI senza database (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.2, §2.5, §2.6, §3.2): il formato e
// l'impronta, mai scambiata con un token della CLI; l'ambito (solo main, il commit intero, l'esecuzione di quel
// repository); la rotazione (al più 7 giorni, mai più di due vive, la seconda con la nuova mai usata si rifiuta); l'avviso a
// 14 giorni una volta; gli stati della riga della famiglia e «Da fare per te»; chi gestisce le chiavi (D6).

const NOW = new Date("2026-11-20T10:00:00.000Z");
const DAY = 86_400_000;
const REPO = "Voltaen/esempio-rosa";
const URL_OK = "https://github.com/Voltaen/esempio-rosa/actions/runs/12345678901";
const COMMIT = "a1b2c3d4e5f60718293a4b5c6d7e8f9012345678";

let seq = 0;
function key(over: Partial<CiKeyRow> = {}): CiKeyRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    repo: REPO,
    prefix: "ub_ci_ab12",
    createdAt: new Date(NOW.getTime() - 10 * DAY),
    expiresAt: new Date(NOW.getTime() + 170 * DAY),
    lastUsedAt: null,
    remindedAt: null,
    revokedAt: null,
    revokedReason: null,
    replacesKeyId: null,
    ...over,
  };
}

test("la chiave: ub_ci_ e 32 byte casuali in base64url, l'impronta SHA-256, il prefisso da mostrare", () => {
  const a = newCiKey();
  const b = newCiKey();
  assert.match(a, /^ub_ci_[A-Za-z0-9_-]{43}$/);
  assert.notEqual(a, b);
  assert.equal(CI_KEY_PREFIX, "ub_ci_");
  assert.equal(Buffer.from(a.slice(CI_KEY_PREFIX.length), "base64url").length, 32);
  assert.equal(hashCiKey(a), createHash("sha256").update(a, "utf8").digest("hex"));
  assert.equal(ciKeyDisplayPrefix(a), a.slice(0, 10));
  assert.match(ciKeyDisplayPrefix(a), /^ub_ci_[A-Za-z0-9_-]{4}$/);
  assert.equal(isCiKey(a), true);
  for (const bad of [`${a}x`, a.slice(0, -1), `ub_cli_${a.slice(6)}`, `UB_CI_${a.slice(6)}`, null, 42]) assert.equal(isCiKey(bad), false, String(bad));
});

test("mai scambiata con un token della CLI: prefissi diversi, e nessuno dei due si legge come l'altro", () => {
  const ci = newCiKey();
  const cli = `${CLI_TOKEN_PREFIX}${ci.slice(CI_KEY_PREFIX.length)}`;
  assert.ok(!CLI_TOKEN_PREFIX.startsWith(CI_KEY_PREFIX) && !CI_KEY_PREFIX.startsWith(CLI_TOKEN_PREFIX));
  assert.equal(ciKeyFromAuthorization(`Bearer ${ci}`), ci);
  assert.equal(ciKeyFromAuthorization(`bearer   ${ci}`), ci);
  assert.equal(ciKeyFromAuthorization(`Bearer ${cli}`), null, "un token della CLI non entra in /api/ci/*");
  assert.equal(bearerTokenFromHeader(`Bearer ${ci}`, CLI_TOKEN_PREFIX), null, "una chiave della CI non entra in /api/cli/*");
  for (const header of [null, undefined, "", ci, `Basic ${ci}`, `Bearer ${ci} altro`, `Bearer ub_ci_corta`]) assert.equal(ciKeyFromAuthorization(header), null, String(header));
  assert.deepEqual(ciKeyCandidates([cli, ci, ci, "ub_team_x"]), [ci]);
  assert.equal(ciIdempotencyOwner("ABCDEF00-0000-4000-8000-000000000001"), `${CI_IDEMPOTENCY_PREFIX}abcdef00-0000-4000-8000-000000000001`);
  assert.throws(() => ciIdempotencyOwner(ci));
});

test("il repository: owner/nome, .git tolto, senza badare alle maiuscole; {nome} senza l'organizzazione", () => {
  assert.equal(normalizeCiRepo(" Voltaen/esempio-rosa.git "), REPO);
  for (const bad of ["esempio-rosa", "Voltaen/esempio rosa", "-Voltaen/x", "", null]) assert.equal(normalizeCiRepo(bad), null, String(bad));
  assert.equal(ciRepoName(REPO), "esempio-rosa");
});

test("l'invio della CI: solo main (403), il commit di 40 cifre, l'esecuzione di GitHub di questo repository", () => {
  const ci = { esecuzione: "12345678901", tentativo: 2, url: URL_OK };
  assert.deepEqual(checkCiRun({ ramo: "main", commit: COMMIT, ci }, REPO), { ok: true, value: { runId: "12345678901", attempt: 2, url: URL_OK } });
  assert.deepEqual(checkCiRun({ ramo: "main", commit: COMMIT, ci: { esecuzione: 12345678901, url: URL_OK } }, "voltaen/ESEMPIO-ROSA"), {
    ok: true,
    value: { runId: "12345678901", attempt: 1, url: URL_OK },
  });
  assert.equal(CI_MAIN_BRANCH, "main");
  for (const ramo of ["develop", "Main", "refs/heads/main", undefined]) {
    assert.deepEqual(checkCiRun({ ramo, commit: COMMIT, ci }, REPO), { ok: false, code: "solo_main", message: CI_KEY_ERRORS.solo_main.message });
  }
  for (const commit of ["a1b2c3d", COMMIT.toUpperCase(), `${COMMIT}0`, undefined]) {
    assert.deepEqual(checkCiRun({ ramo: "main", commit, ci }, REPO), { ok: false, code: "dati_non_validi", message: "commit: le 40 cifre del commit di main." });
  }
  const badCi = [
    undefined,
    [],
    { esecuzione: "12345678901", url: "https://github.com/Voltaen/altro/actions/runs/12345678901" },
    { esecuzione: "12345678901", url: `${URL_OK}/attempts/2` },
    { esecuzione: "999", url: URL_OK },
    { esecuzione: "12345678901", url: URL_OK.replace("https:", "http:") },
    { esecuzione: "12345678901", tentativo: 0, url: URL_OK },
    { esecuzione: "12345678901", tentativo: "1", url: URL_OK },
    { esecuzione: "12345678901", tentativo: 101, url: URL_OK },
  ];
  for (const value of badCi) {
    assert.deepEqual(checkCiRun({ ramo: "main", commit: COMMIT, ci: value }, REPO), { ok: false, code: "dati_non_validi", message: "ci.url: l'indirizzo dell'esecuzione su GitHub di questo repository." }, JSON.stringify(value));
  }
});

test("la rotazione: la vecchia vale al più 7 giorni; mai più di due vive; la seconda con la nuova mai usata si rifiuta", () => {
  assert.equal(CI_KEY_DAYS, 180);
  assert.equal(CI_KEY_ROTATION_GRACE_DAYS, 7);
  assert.equal(CI_KEY_MAX_LIVE, 2);
  assert.equal(ciKeyExpiresAt(NOW).getTime() - NOW.getTime(), 180 * DAY);
  assert.equal(rotatedOldUntil(new Date(NOW.getTime() + 100 * DAY), NOW).getTime(), NOW.getTime() + 7 * DAY, "al più tardi adesso più 7 giorni");
  assert.equal(rotatedOldUntil(new Date(NOW.getTime() + 2 * DAY), NOW).getTime(), NOW.getTime() + 2 * DAY, "prima, se scadeva prima");
  const old = key();
  const fresh = key({ replacesKeyId: old.id, createdAt: NOW, expiresAt: ciKeyExpiresAt(NOW) });
  const oldInGrace = { ...old, expiresAt: rotatedOldUntil(old.expiresAt, NOW) };
  assert.equal(createRefusal([], NOW), null);
  assert.equal(createRefusal([old], NOW), "gia_collegata");
  assert.equal(createRefusal([{ ...old, revokedAt: NOW, revokedReason: "a_mano" }], NOW), null);
  assert.equal(createRefusal([{ ...old, expiresAt: new Date(NOW.getTime() - 1) }], NOW), null, "scaduta: se ne crea una nuova");
  assert.equal(rotateRefusal([], NOW), "nessuna_chiave");
  assert.equal(rotateRefusal([old], NOW), null);
  assert.equal(rotateRefusal([oldInGrace, fresh], NOW), "rotazione_in_corso", "due vive");
  assert.equal(rotationPending([oldInGrace, fresh], NOW), true);
  // La vecchia è scaduta (o revocata a mano) ma la nuova non è mai arrivata da GitHub: ancora in corso.
  assert.equal(rotateRefusal([{ ...oldInGrace, expiresAt: new Date(NOW.getTime() - 1) }, fresh], NOW), "rotazione_in_corso");
  // Il primo invio con la nuova ha revocato la vecchia: si può ruotare di nuovo.
  const used = { ...fresh, lastUsedAt: NOW };
  assert.equal(rotateRefusal([{ ...oldInGrace, revokedAt: NOW, revokedReason: "ruotata" }, used], NOW), null);
});

test("l'avviso a 14 giorni: una volta, mai alla vecchia di una rotazione, mai a una chiave finita; dopo 12 mesi si cancella", () => {
  assert.equal(CI_KEY_REMINDER_DAYS, 14);
  const soon = key({ expiresAt: new Date(NOW.getTime() + 14 * DAY) });
  assert.equal(ciKeyReminderDue(soon, [soon], NOW), true);
  assert.equal(ciKeyReminderDue({ ...soon, expiresAt: new Date(NOW.getTime() + 14 * DAY + 1) }, [soon], NOW), false, "a più di 14 giorni");
  assert.equal(ciKeyReminderDue({ ...soon, remindedAt: NOW }, [soon], NOW), false, "una volta sola");
  assert.equal(ciKeyReminderDue({ ...soon, revokedAt: NOW, revokedReason: "a_mano" }, [soon], NOW), false);
  assert.equal(ciKeyReminderDue({ ...soon, expiresAt: new Date(NOW.getTime() - 1) }, [soon], NOW), false);
  const fresh = key({ createdAt: NOW, replacesKeyId: soon.id, expiresAt: ciKeyExpiresAt(NOW) });
  assert.equal(ciKeyReminderDue(soon, [soon, fresh], NOW), false, "superata da una più nuova");
  const month = 30 * DAY;
  assert.equal(ciKeyRetentionDue(key({ expiresAt: new Date(NOW.getTime() - 13 * month) }), NOW), true);
  assert.equal(ciKeyRetentionDue(key({ expiresAt: new Date(NOW.getTime() - 11 * month) }), NOW), false);
  assert.equal(ciKeyRetentionDue(key({ revokedAt: new Date(NOW.getTime() - 13 * month), revokedReason: "esposta", expiresAt: new Date(NOW.getTime() + DAY) }), NOW), true);
  assert.equal(ciKeyRetentionDue(key(), NOW), false);
});

test("la riga della famiglia: ogni stato del §2.6 dalle chiavi; «Da fare per te» solo dove c'è da fare", () => {
  assert.deepEqual(ciRowState([], NOW, false), { kind: "non_disponibile" });
  assert.deepEqual(ciRowState([], NOW), { kind: "non_collegata" });
  const never = key();
  assert.equal(ciRowState([never], NOW).kind, "mai_usata");
  const used = key({ lastUsedAt: NOW });
  assert.equal(ciRowState([used], NOW).kind, "usata");
  const expiring = key({ lastUsedAt: NOW, expiresAt: new Date(NOW.getTime() + 5 * DAY) });
  assert.equal(ciRowState([expiring], NOW).kind, "in_scadenza");
  const old = key({ lastUsedAt: NOW, expiresAt: new Date(NOW.getTime() + 7 * DAY) });
  const fresh = key({ createdAt: new Date(NOW.getTime() - 2 * DAY), replacesKeyId: old.id, expiresAt: ciKeyExpiresAt(NOW) });
  const rotation = ciRowState([old, fresh], NOW);
  assert.equal(rotation.kind, "rotazione");
  assert.equal(rotation.kind === "rotazione" && rotation.old.id, old.id);
  assert.equal(rotation.kind === "rotazione" && rotation.fresh.id, fresh.id);
  const expired = key({ expiresAt: new Date(NOW.getTime() - DAY) });
  assert.deepEqual(ciRowState([expired], NOW), { kind: "scaduta", key: expired });
  assert.deepEqual(ciRowState([{ ...expired, revokedAt: NOW, revokedReason: "a_mano" }], NOW), { kind: "non_collegata" }, "revocata: non collegata");
  // «Da fare per te».
  assert.equal(ciKeyTodo({ kind: "non_collegata" }, { approvedCases: 1 }, NOW), "collega");
  assert.equal(ciKeyTodo({ kind: "non_collegata" }, { approvedCases: 0 }, NOW), null, "solo con un caso dal progetto approvato in poi");
  assert.equal(ciKeyTodo(ciRowState([expired], NOW), { approvedCases: 2 }, NOW), "collega");
  assert.equal(ciKeyTodo(ciRowState([expiring], NOW), { approvedCases: 0 }, NOW), "ruota");
  assert.equal(ciKeyTodo(rotation, { approvedCases: 0 }, NOW), "metti", "una rotazione ferma da più di un giorno");
  assert.equal(ciKeyTodo(ciRowState([old, { ...fresh, createdAt: new Date(NOW.getTime() - 3_600_000) }], NOW), { approvedCases: 0 }, NOW), null, "appena ruotata");
  assert.equal(ciKeyTodo(ciRowState([used], NOW), { approvedCases: 3 }, NOW), null);
  assert.equal(ciKeyTodo({ kind: "non_disponibile" }, { approvedCases: 3 }, NOW), null);
});

test("D6: solo Lateral Space, chi gestisce il workspace o è responsabile di un caso aperto del repository", () => {
  const rule = (isLateralSpace: boolean, workspaceRole: string | null, leadsOpenCaseOfRepo: boolean) => canManageCiKeysRule({ isLateralSpace, workspaceRole, leadsOpenCaseOfRepo });
  assert.equal(rule(true, "transformation_lead", false), true, "chi gestisce il workspace");
  assert.equal(rule(true, "analyst", false), true, "un ruolo da revisore, come lsManager");
  assert.equal(rule(true, "contributor", true), true, "il responsabile del caso");
  assert.equal(rule(true, "contributor", false), false, "sviluppatore o analista di Lateral Space");
  assert.equal(rule(false, "transformation_lead", true), false, "il cliente, chi costruisce da fuori");
  assert.equal(rule(true, "learner", true), false, "chi segue un corso");
  assert.equal(rule(true, null, true), false, "fuori dal workspace");
});

test("i testi delle azioni e degli errori sono quelli della specifica; il segreto si chiama UNBUNDLE_CI_TOKEN", () => {
  assert.equal(CI_SECRET_NAME, "UNBUNDLE_CI_TOKEN");
  assert.equal(CI_KEY_ACTION_TEXT.permesso_negato, "La chiave della CI la gestisce Lateral Space: chi è responsabile di un caso di questo repository, o chi gestisce il workspace.");
  assert.equal(CI_KEY_ACTION_TEXT.gia_collegata, "Questo repository ha già una chiave: per cambiarla, «Ruota la chiave».");
  assert.equal(CI_KEY_ACTION_TEXT.rotazione_in_corso, "C'è già una chiave nuova da mettere su GitHub: mettila, oppure revoca e ricomincia.");
  assert.equal(CI_KEY_ACTION_TEXT.repo_senza_casi, "Questo repository non ha casi registrati in questo workspace.");
  assert.equal(CI_KEY_ACTION_TEXT.non_disponibile, "Non ancora disponibile: riprova tra qualche minuto.");
  assert.equal(CI_KEY_ACTION_TEXT.creata, "Chiave nuova creata: mettila su GitHub.");
  assert.equal(CI_KEY_ACTION_TEXT.revocata, "Chiave revocata.");
  assert.deepEqual(
    Object.fromEntries(Object.entries(CI_KEY_ERRORS).map(([code, e]) => [code, e.status])),
    { chiave: 401, chiave_nell_indirizzo: 400, non_trovato: 404, solo_main: 403, caso_chiuso: 409, caso_sospeso: 409, senza_dossier: 409, non_disponibile: 503 },
  );
  // I testi dei casi chiusi, in pausa e senza dossier sono quelli della CLI.
  const cliCase = readFileSync(new URL("../cli/case.ts", import.meta.url), "utf8");
  for (const code of ["caso_chiuso", "caso_sospeso", "senza_dossier"] as const) assert.ok(cliCase.includes(`"${CI_KEY_ERRORS[code].message}"`), code);
});
