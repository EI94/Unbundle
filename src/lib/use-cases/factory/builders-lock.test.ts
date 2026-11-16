// Il lock per persona di «Chi costruisce» (rilascio 8.0c, RILASCIO-8.0c-ESTERNI.md §4 e §9): ogni scrittura delle
// concessioni di una persona e la riga `osservatore` che ne dipende si mettono in fila con lo stesso advisory lock, che
// è la prima istruzione della loro transazione. La chiave è in minuscolo: due modi di scrivere lo stesso id prendono lo
// stesso lock. Qui la forma delle istruzioni; le corse vere stanno in external-team.integration.test.ts.
import test from "node:test";
import assert from "node:assert/strict";
import { deleteGrantsStatements, grantGuardStatements, removeGrantsStatements, writeGrantStatements } from "../../db/queries/use-case-builders.ts";

const WS = "3f2a9c1e-0000-4000-8000-0000000000a1";
const USER = "3f2a9c1e-0000-4000-8000-0000000000b1";
const ACTOR = "3f2a9c1e-0000-4000-8000-0000000000c1";
const CASE = "3f2a9c1e-0000-4000-8000-0000000000d1";
const USE_CASE = "3f2a9c1e-0000-4000-8000-0000000000e1";
const LOCK = "SELECT pg_advisory_xact_lock(hashtext('unbundle:external-builders:' || $1::text || ':' || $2::text))";

/** Le transazioni che toccano le concessioni di una persona, con gli id scritti così. */
const transactions = (ws: string, user: string) => ({
  "«Aggiungi» in tutti i casi": writeGrantStatements({ workspaceId: ws, userId: user, where: { all: true }, actorUserId: ACTOR }).statements,
  "«Aggiungi» solo in alcuni casi": writeGrantStatements({ workspaceId: ws, userId: user, where: { all: false, useCaseIds: [USE_CASE] }, actorUserId: ACTOR }).statements,
  "«Togli»": removeGrantsStatements(ws, user).statements,
  "l'uscita dal workspace": deleteGrantsStatements(ws, user),
  "la riga osservatore di un dossier": grantGuardStatements(ws, user, CASE),
});

test("il lock della persona è la prima istruzione di ogni transazione che tocca le sue concessioni", () => {
  for (const [name, statements] of Object.entries(transactions(WS, USER))) {
    assert.equal(statements[0].text, LOCK, name);
    assert.deepEqual(statements[0].params, [WS, USER], name);
    assert.ok(statements.length > 1, `${name}: dopo il lock c'è la scrittura`);
    assert.ok(statements.slice(1).every((st) => !st.text.includes("pg_advisory")), `${name}: un lock solo`);
  }
});

test("due modi di scrivere lo stesso id prendono lo stesso lock: la chiave è in minuscolo", () => {
  const lower = transactions(WS, USER);
  for (const [ws, user] of [
    [WS.toUpperCase(), USER.toUpperCase()],
    [WS.toUpperCase(), USER],
    [WS, USER.toUpperCase()],
  ]) {
    const spelled = transactions(ws, user);
    for (const name of Object.keys(lower) as (keyof typeof lower)[]) assert.deepEqual(spelled[name][0], lower[name][0], `${name} con ${ws} e ${user}`);
  }
  // Persone o workspace diversi: lock diversi.
  assert.notDeepEqual(deleteGrantsStatements(WS, ACTOR)[0].params, deleteGrantsStatements(WS, USER)[0].params);
  assert.notDeepEqual(deleteGrantsStatements(ACTOR, USER)[0].params, deleteGrantsStatements(WS, USER)[0].params);
});
