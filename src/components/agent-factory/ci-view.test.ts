// La CI delle famiglie nell'Agent Factory, senza database (rilascio 8.2b, RILASCIO-8.2b-SPEC.md §2.5, §2.6): la frase e
// il colore di ogni stato della riga, i pulsanti solo a chi gestisce le chiavi (D6), «Da fare per te» solo a loro e solo
// per le famiglie della pagina, i repository con una chiave viva per «Togli», la 0042 non pronta. I testi sono quelli
// della specifica, nella dashboard senza parole vietate. Dati inventati.
import test from "node:test";
import assert from "node:assert/strict";
import type { CiKeyRepoOverview } from "../../lib/db/queries/use-case-ci-keys.ts";
import { CI_SECRET_NAME, ciRepoName, ciRowState, type CiKeyRow } from "../../lib/use-cases/ci/keys.ts";
import { findHubForbiddenIn } from "../../lib/use-cases/copy-guard.ts";
import { CI_SECRET, CI_TEXT, ciDay, ciLastSendText, ciRepoShortName, familyAnchor } from "./ci-text.ts";
import { ciFamiliesView, ciRowView, ciTodoText, type CiFamiliesView } from "./ci-view.ts";

const REPO = "Voltaen/esempio-rosa";
const OTHER = "Voltaen/esempio-blu";
const NOW = new Date("2026-11-18T20:04:00.000Z");
const DAY_MS = 86_400_000;
const at = (iso: string) => new Date(iso);

let seq = 0;
function key(over: Partial<CiKeyRow> = {}): CiKeyRow {
  seq += 1;
  return {
    id: `00000000-0000-4000-8000-${String(seq).padStart(12, "0")}`,
    repo: REPO,
    prefix: "ub_ci_ab12",
    createdAt: at("2026-11-18T19:04:00.000Z"),
    expiresAt: at("2027-05-17T19:04:00.000Z"),
    lastUsedAt: null,
    remindedAt: null,
    revokedAt: null,
    revokedReason: null,
    replacesKeyId: null,
    ...over,
  };
}

const overview = (keys: CiKeyRow[], approvedCases = 1, repo = REPO): CiKeyRepoOverview => ({ repo, keys, approvedCases });
const reposOf = (...list: CiKeyRepoOverview[]) => new Map(list.map((o) => [o.repo.toLowerCase(), o]));
const view = (keys: CiKeyRow[], now = NOW) => ciRowView(ciRowState(keys, now), keys, now);

test("ogni stato della riga: la frase della specifica, il colore, e i pulsanti per chi gestisce le chiavi", () => {
  assert.deepEqual(ciRowView({ kind: "non_disponibile" }, [], NOW), { tone: "grigio", text: "Non ancora disponibile: riprova tra qualche minuto.", primary: null, menu: [] });
  assert.deepEqual(view([]), { tone: "grigio", text: "CI non collegata: le evals di main restano su GitHub.", primary: "collega", menu: [] });

  const fresh = key();
  assert.deepEqual(view([fresh]), { tone: "blu", text: "CI collegata il 18/11/2026: le evals arrivano alla prossima unione su main.", primary: null, menu: ["ruota", "revoca"] });

  const used = key({ lastUsedAt: at("2026-11-18T20:00:00.000Z") });
  assert.deepEqual(view([used]), { tone: "verde", text: "CI collegata · ultimo invio oggi · la chiave scade il 17/05/2027", primary: null, menu: ["ruota", "revoca"] });

  const expiring = key({ createdAt: at("2026-06-05T10:00:00.000Z"), expiresAt: at("2026-12-02T10:00:00.000Z"), lastUsedAt: at("2026-11-17T09:00:00.000Z") });
  assert.deepEqual(view([expiring]), { tone: "giallo", text: "La chiave della CI scade il 02/12/2026.", primary: "ruota", menu: ["revoca"] });

  const old = key({ createdAt: at("2026-06-05T10:00:00.000Z"), expiresAt: at("2026-11-25T19:04:00.000Z"), lastUsedAt: at("2026-11-17T09:00:00.000Z") });
  const next = key({ replacesKeyId: old.id });
  assert.deepEqual(view([next, old]), {
    tone: "giallo",
    text: "Chiave nuova da mettere su GitHub. La vecchia vale fino al primo invio con la nuova, al massimo fino al 25/11/2026.",
    primary: null,
    menu: ["revoca"],
  });

  const ended = key({ createdAt: at("2026-06-05T10:00:00.000Z"), expiresAt: at("2026-12-02T10:00:00.000Z"), lastUsedAt: at("2026-11-30T09:00:00.000Z") });
  assert.deepEqual(view([ended], at("2026-12-05T10:00:00.000Z")), { tone: "rosso", text: "La chiave della CI è scaduta il 02/12/2026: la CI non manda più le evals.", primary: "crea", menu: [] });

  // Revocata (a mano, esposta, senza casi): la CI non è collegata, e si collega di nuovo.
  assert.deepEqual(view([key({ revokedAt: at("2026-11-18T19:30:00.000Z"), revokedReason: "esposta" })]).primary, "collega");
});

test("«Ruota» solo quando il server la accetta: una chiave nuova mai usata (la vecchia già finita) aspetta GitHub", () => {
  // La vecchia di una rotazione è scaduta; la nuova, mai usata, sostituisce: un'altra rotazione si rifiuterebbe.
  const old = key({ createdAt: at("2026-05-01T10:00:00.000Z"), expiresAt: at("2026-11-12T10:00:00.000Z") });
  const pending = key({ createdAt: at("2026-11-05T10:00:00.000Z"), expiresAt: at("2027-05-04T10:00:00.000Z"), replacesKeyId: old.id });
  const v = view([pending, old]);
  assert.equal(v.text, "CI collegata il 05/11/2026: le evals arrivano alla prossima unione su main.");
  assert.deepEqual(v.menu, ["revoca"], "senza «Ruota»");
  // In scadenza e con la rotazione ferma: nessun pulsante «Ruota», resta «Revoca».
  const expiringPending = key({ createdAt: at("2026-06-05T10:00:00.000Z"), expiresAt: at("2026-12-02T10:00:00.000Z"), replacesKeyId: old.id });
  assert.deepEqual(view([expiringPending, old]), { tone: "giallo", text: "La chiave della CI scade il 02/12/2026.", primary: null, menu: ["revoca"] });
});

test("l'ultimo invio: oggi, ieri, poi la data; i giorni sono quelli di Roma", () => {
  assert.equal(ciLastSendText(at("2026-11-18T00:30:00.000Z"), NOW), "oggi");
  // Le 23:30 del 17 a Roma sono le 22:30 UTC: ieri, anche se a meno di 24 ore.
  assert.equal(ciLastSendText(at("2026-11-17T22:30:00.000Z"), NOW), "ieri");
  assert.equal(ciLastSendText(at("2026-11-17T23:30:00.000Z"), NOW), "oggi", "le 00:30 del 18 a Roma");
  assert.equal(ciLastSendText(at("2026-11-15T09:00:00.000Z"), NOW), "il 15/11/2026");
  assert.equal(ciDay(at("2027-05-17T22:30:00.000Z")), "18/05/2027", "a Roma è già il 18");
  assert.equal(ciDay("non è una data"), "");
});

test("il nome e l'ancora della famiglia: le stesse regole del modulo della chiave e della pagina", () => {
  for (const repo of [REPO, "Voltaen/xx.famiglia_2", "senza-organizzazione"]) assert.equal(ciRepoShortName(repo), ciRepoName(repo), repo);
  assert.equal(familyAnchor(REPO), "famiglia-esempio-rosa");
  assert.equal(CI_SECRET, CI_SECRET_NAME, "il nome del segreto è quello che legge la CI");
});

const manager = { all: true, repos: new Set<string>() };
const leadOf = (...repos: string[]) => ({ all: false, repos: new Set(repos.map((r) => r.toLowerCase())) });

function families(input: Partial<Parameters<typeof ciFamiliesView>[0]> = {}): CiFamiliesView {
  return ciFamiliesView({ ready: true, repos: reposOf(overview([]), overview([], 0, OTHER)), managed: manager, families: [REPO, OTHER], now: NOW, ...input });
}

test("i pulsanti solo a chi gestisce le chiavi del repository; agli altri lo stato senza pulsanti", () => {
  // Chi gestisce il workspace: tutti i repository.
  const all = families();
  assert.deepEqual(
    [...all.rows.values()].map((r) => [r.repo, r.manages, r.primary]),
    [
      [REPO, true, "collega"],
      [OTHER, true, "collega"],
    ],
  );
  // Il responsabile di un caso di un repository: solo quello (il repository registrato con altre maiuscole è lo stesso).
  const lead = families({ managed: leadOf("voltaen/ESEMPIO-ROSA") });
  assert.equal(lead.rows.get(REPO.toLowerCase())?.manages, true);
  assert.deepEqual({ ...lead.rows.get(OTHER.toLowerCase()), text: "" }, { repo: OTHER, kind: "non_collegata", manages: false, tone: "grigio", text: "", primary: null, menu: [] });
  // Chi costruisce, anche da fuori (nessun repository gestito, o null per chi non è di Lateral Space): lo stato, senza pulsanti.
  for (const managed of [leadOf(), null]) {
    const v = families({ managed, repos: reposOf(overview([key({ lastUsedAt: NOW })]), overview([], 0, OTHER)) });
    const row = v.rows.get(REPO.toLowerCase());
    assert.equal(row?.text, "CI collegata · ultimo invio oggi · la chiave scade il 17/05/2027");
    assert.equal(row?.manages, false);
    assert.equal(row?.primary, null);
    assert.deepEqual(row?.menu, []);
    assert.deepEqual(v.todos, []);
  }
});

test("«Da fare per te»: la chiave nuova ferma da più di un giorno, la chiave in scadenza, la CI da collegare con un caso approvato", () => {
  const old = key({ repo: OTHER, createdAt: at("2026-06-05T10:00:00.000Z"), expiresAt: at("2026-11-23T10:00:00.000Z"), lastUsedAt: at("2026-11-16T09:00:00.000Z") });
  const stuck = key({ repo: OTHER, createdAt: at("2026-11-16T10:00:00.000Z"), replacesKeyId: old.id });
  const expiring = key({ repo: "Voltaen/esempio-verde", createdAt: at("2026-06-05T10:00:00.000Z"), expiresAt: at("2026-12-02T10:00:00.000Z"), lastUsedAt: NOW });
  const v = families({
    repos: reposOf(overview([]), overview([stuck, old], 1, OTHER), overview([expiring], 1, "Voltaen/esempio-verde")),
    families: [REPO, OTHER, "Voltaen/esempio-verde"],
  });
  assert.deepEqual(
    v.todos.map((t) => [t.kind, t.text, t.href]),
    [
      ["metti", "Metti su GitHub la chiave nuova della CI di esempio-blu.", "#famiglia-esempio-blu"],
      ["ruota", "Ruota la chiave della CI di esempio-verde: scade il 02/12/2026.", "#famiglia-esempio-verde"],
      ["collega", "Collega la CI di esempio-rosa: le evals di main arriveranno da sole.", "#famiglia-esempio-rosa"],
    ],
  );
  // La rotazione di oggi non è ancora «ferma»; senza un caso dal progetto approvato non si chiede di collegare.
  const today = key({ repo: OTHER, createdAt: at("2026-11-18T10:00:00.000Z"), replacesKeyId: old.id });
  assert.deepEqual(families({ repos: reposOf(overview([], 0), overview([today, old], 1, OTHER)) }).todos, []);
  // Solo a chi gestisce le chiavi di quel repository, e solo per le famiglie della pagina.
  assert.deepEqual(
    families({ managed: leadOf(REPO), repos: reposOf(overview([]), overview([], 1, OTHER)) }).todos.map((t) => t.repo),
    [REPO],
  );
  assert.deepEqual(families({ families: [OTHER], repos: reposOf(overview([]), overview([key({ repo: OTHER, lastUsedAt: NOW })], 1, OTHER)) }).todos, []);
  assert.equal(ciTodoText("ruota", REPO, ciRowState([expiring], NOW)), "Ruota la chiave della CI di esempio-rosa: scade il 02/12/2026.");
});

test("la 0042 non pronta: ogni riga dice «Non ancora disponibile», senza pulsanti, «Da fare per te» né chiavi vive", () => {
  const v = families({ ready: false, repos: reposOf(overview([key({ lastUsedAt: NOW })])) });
  assert.equal(v.ready, false);
  for (const row of v.rows.values()) {
    assert.equal(row.kind, "non_disponibile");
    assert.equal(row.text, CI_TEXT.row.notReady);
    assert.equal(row.manages, false);
  }
  assert.deepEqual(v.todos, []);
  assert.deepEqual([...v.liveRepos], []);
});

test("«Togli»: i repository con una chiave viva, anche fuori dalle famiglie della pagina; mai quelli con la chiave finita", () => {
  const v = families({
    families: [REPO],
    repos: reposOf(
      overview([key({ lastUsedAt: NOW })]),
      overview([key({ repo: OTHER, revokedAt: NOW, revokedReason: "a_mano" })], 1, OTHER),
      overview([key({ repo: "Voltaen/esempio-verde", lastUsedAt: NOW })], 0, "Voltaen/esempio-verde"),
    ),
  });
  assert.deepEqual([...v.liveRepos].sort(), ["voltaen/esempio-rosa", "voltaen/esempio-verde"]);
  // Una chiave scaduta da un giorno non conta.
  const expired = key({ createdAt: at("2026-05-01T10:00:00.000Z"), expiresAt: new Date(NOW.getTime() - DAY_MS) });
  assert.deepEqual([...families({ repos: reposOf(overview([expired])) }).liveRepos], []);
});

test("copy-guard: i testi della CI nella dashboard non hanno parole vietate né «caso d'uso»", () => {
  const name = "esempio-rosa";
  const texts = [
    CI_TEXT.row.notReady,
    CI_TEXT.row.notConnected,
    CI_TEXT.row.neverUsed("18/11/2026"),
    CI_TEXT.row.used("oggi", "17/05/2027"),
    CI_TEXT.row.expiring("02/12/2026"),
    CI_TEXT.row.rotation("25/11/2026"),
    CI_TEXT.row.expired("02/12/2026"),
    ...Object.values(CI_TEXT.action).map((t) => (typeof t === "function" ? t(name) : t)),
    CI_TEXT.connect.title(name),
    CI_TEXT.connect.body,
    CI_TEXT.connect.confirm,
    CI_TEXT.rotate.title(name),
    CI_TEXT.rotate.body,
    CI_TEXT.rotate.confirm,
    CI_TEXT.revoke.title(name),
    CI_TEXT.revoke.body,
    CI_TEXT.revoke.confirm,
    CI_TEXT.key.title(name),
    CI_TEXT.key.titleRotated(name),
    CI_TEXT.key.copyNow,
    CI_TEXT.key.field,
    CI_TEXT.key.copyFailed,
    CI_TEXT.key.steps(REPO),
    CI_TEXT.key.stepsRotated(REPO),
    CI_TEXT.key.validity("17/05/2027"),
    CI_TEXT.done.created,
    CI_TEXT.done.revoked,
    CI_TEXT.failed,
    CI_TEXT.todo.connect(name),
    CI_TEXT.todo.rotate(name, "02/12/2026"),
    CI_TEXT.todo.put(name),
  ];
  assert.deepEqual(findHubForbiddenIn(texts, "area"), []);
  // Le parole della specifica (§2.6), dove contano: il segreto, i passi di GitHub, la chiave che si vede una volta.
  assert.equal(CI_TEXT.revoke.body, "Da subito la CI non manda più le evals a Unbundle. Su GitHub togli anche il segreto UNBUNDLE_CI_TOKEN.");
  assert.equal(CI_TEXT.key.steps(REPO), "Su GitHub, in Voltaen/esempio-rosa: Settings › Secrets and variables › Actions › New repository secret. Nome UNBUNDLE_CI_TOKEN, valore la chiave.");
  assert.match(CI_TEXT.key.stepsRotated(REPO), /Mettila al posto della vecchia, con lo stesso nome\.$/);
  assert.equal(CI_TEXT.key.copyNow, "Copiala adesso: dopo non si vede più.");
  assert.equal(CI_TEXT.key.validity("17/05/2027"), "Vale fino al 17/05/2027, solo per mandare le evals di main di questo repository.");
  assert.equal(CI_TEXT.rotate.body, "Nasce una chiave nuova, da mettere su GitHub al posto della vecchia. La vecchia vale fino al primo invio con la nuova, al massimo 7 giorni.");
  // Nessun genere: «chi», mai «il responsabile» o «lo sviluppatore» nei testi della CI.
  assert.deepEqual(texts.filter((t) => /\b(il|lo|la) (responsabile|sviluppatore|sviluppatrice)\b/i.test(t)), []);
});
