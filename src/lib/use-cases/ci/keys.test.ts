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
  checkCiRun,
  ciIdempotencyOwner,
  ciKeyCandidates,
  ciKeyDisplayPrefix,
  ciKeyFromAuthorization,
  ciKeyTodo,
  ciRepoName,
  ciRowState,
  hashCiKey,
  isCiKey,
  newCiKey,
  normalizeCiRepo,
  rotateRefusal,
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

test("la chiave: il prefisso della CI e 32 byte casuali in base64url, l'impronta SHA-256, il prefisso da mostrare", () => {
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
  // Il registro dell'idempotenza: il repository nel suo workspace, non la chiave (le due chiavi di una rotazione lo condividono).
  const WS = "ABCDEF00-0000-4000-8000-000000000001";
  assert.equal(ciIdempotencyOwner(WS, REPO), `${CI_IDEMPOTENCY_PREFIX}abcdef00-0000-4000-8000-000000000001:voltaen/esempio-rosa`);
  assert.equal(ciIdempotencyOwner(WS.toLowerCase(), "VOLTAEN/Esempio-Rosa"), ciIdempotencyOwner(WS, REPO), "senza badare alle maiuscole");
  const long = `Voltaen/${"a".repeat(100)}`;
  const hashed = ciIdempotencyOwner(WS, long);
  assert.equal(hashed.length, 80, "la colonna tiene 80 caratteri");
  assert.equal(hashed, `${CI_IDEMPOTENCY_PREFIX}abcdef00-0000-4000-8000-000000000001:${createHash("sha256").update(long.toLowerCase(), "utf8").digest("hex").slice(0, 40)}`);
  assert.equal(ciIdempotencyOwner(WS, long.toUpperCase()), hashed);
  for (const repo of ["Voltaen/esempio-rosa", `Voltaen/${"b".repeat(100)}`, `${"c".repeat(39)}/${"d".repeat(100)}`]) assert.ok(ciIdempotencyOwner(WS, repo).length <= 80, repo);
  assert.throws(() => ciIdempotencyOwner(ci, REPO));
  assert.throws(() => ciIdempotencyOwner(WS, "non un repository"));
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

// La durata, i 7 giorni della vecchia, l'avviso a 14 giorni e la cancellazione dopo 12 mesi stanno nell'SQL del modulo
// delle chiavi: le prove sono sul database (src/lib/db/queries/use-case-ci-keys.integration.test.ts). Qui le costanti e
// le regole che usa anche la pagina.
test("la rotazione: mai più di due vive; in corso solo finché la vecchia vale; poi si ruota di nuovo", () => {
  assert.equal(CI_KEY_DAYS, 180);
  assert.equal(CI_KEY_ROTATION_GRACE_DAYS, 7);
  assert.equal(CI_KEY_MAX_LIVE, 2);
  assert.equal(CI_KEY_REMINDER_DAYS, 14);
  const old = key();
  const fresh = key({ replacesKeyId: old.id, createdAt: NOW, expiresAt: new Date(NOW.getTime() + 180 * DAY) });
  const oldInGrace = { ...old, expiresAt: new Date(NOW.getTime() + 7 * DAY) };
  assert.equal(rotateRefusal([], NOW), "nessuna_chiave");
  assert.equal(rotateRefusal([old], NOW), null);
  assert.equal(rotateRefusal([oldInGrace, fresh], NOW), "rotazione_in_corso", "due vive");
  assert.equal(rotationPending([oldInGrace, fresh], NOW), true);
  // La vecchia è finita (scaduta o revocata) e la nuova non è mai arrivata da GitHub: la rotazione non è più in corso e
  // si può ruotare di nuovo (la chiave mostrata una volta può essere persa).
  assert.equal(rotationPending([{ ...oldInGrace, expiresAt: new Date(NOW.getTime() - 1) }, fresh], NOW), false);
  assert.equal(rotateRefusal([{ ...oldInGrace, expiresAt: new Date(NOW.getTime() - 1) }, fresh], NOW), null);
  assert.equal(rotateRefusal([{ ...oldInGrace, revokedAt: NOW, revokedReason: "esposta" }, fresh], NOW), null);
  assert.equal(rotateRefusal([fresh], NOW), null, "la riga della vecchia non c'è più");
  // Il primo invio con la nuova ha revocato la vecchia: si può ruotare di nuovo.
  const used = { ...fresh, lastUsedAt: NOW };
  assert.equal(rotateRefusal([{ ...oldInGrace, revokedAt: NOW, revokedReason: "ruotata" }, used], NOW), null);
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
  const fresh = key({ createdAt: new Date(NOW.getTime() - 2 * DAY), replacesKeyId: old.id, expiresAt: new Date(NOW.getTime() + 178 * DAY) });
  const rotation = ciRowState([old, fresh], NOW);
  assert.equal(rotation.kind, "rotazione");
  assert.equal(rotation.kind === "rotazione" && rotation.old.id, old.id);
  assert.equal(rotation.kind === "rotazione" && rotation.fresh.id, fresh.id);
  // La nuova di una rotazione mai arrivata su GitHub, con la vecchia già finita: da mettere, con il giorno della fine.
  const dead = key({ lastUsedAt: new Date(NOW.getTime() - 9 * DAY), expiresAt: new Date(NOW.getTime() - 2 * DAY) });
  const orphan = key({ createdAt: new Date(NOW.getTime() - 9 * DAY), replacesKeyId: dead.id });
  assert.deepEqual(ciRowState([orphan, dead], NOW), { kind: "da_mettere", key: orphan, oldEndedAt: dead.expiresAt });
  const revokedOld = { ...dead, expiresAt: new Date(NOW.getTime() + DAY), revokedAt: new Date(NOW.getTime() - 3 * DAY), revokedReason: "esposta" as const };
  assert.deepEqual(ciRowState([orphan, revokedOld], NOW), { kind: "da_mettere", key: orphan, oldEndedAt: revokedOld.revokedAt });
  assert.deepEqual(ciRowState([orphan], NOW), { kind: "da_mettere", key: orphan, oldEndedAt: null });
  assert.equal(ciRowState([{ ...orphan, lastUsedAt: NOW }, dead], NOW).kind, "usata", "usata: la rotazione è finita");
  assert.equal(ciRowState([{ ...orphan, expiresAt: new Date(NOW.getTime() + 5 * DAY) }, dead], NOW).kind, "in_scadenza", "in scadenza: serve una chiave nuova");
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
  assert.equal(ciKeyTodo(ciRowState([orphan, dead], NOW), { approvedCases: 0 }, NOW), "metti", "la vecchia è finita: subito");
  assert.equal(ciKeyTodo(ciRowState([used], NOW), { approvedCases: 3 }, NOW), null);
  assert.equal(ciKeyTodo({ kind: "non_disponibile" }, { approvedCases: 3 }, NOW), null);
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
