import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OPEN_LINK_CACHE_PREFIX, cachedOpenLink, rememberOpenLink, type LinkStorage } from "./open-link-cache.ts";
import { openLinkVersion, openLinkVersionOf } from "./open-link-version.ts";

// (Revisione 7b) «Copia il link per tutti» non dà mai un link ritirato o di un'altra rilevazione: il browser tiene una
// copia sola per rilevazione e per versione del link, e la testata e la scheda ripartono da capo cambiando rilevazione.
// Dati inventati.

const A = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const B = "bbbbbbbb-cccc-4ddd-8eee-ffffffffffff";
const URL_1 = "https://unbundle.example/s/air_primo";
const URL_2 = "https://unbundle.example/s/air_secondo";

function memory(): LinkStorage & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, getItem: (key) => data.get(key) ?? null, setItem: (key, value) => void data.set(key, value) };
}

test("one copy per rilevazione and per link version: a new link, or another rilevazione, never gets the old one", () => {
  const storage = memory();
  const v1 = openLinkVersion("1".repeat(64));
  const v2 = openLinkVersion("2".repeat(64));
  assert.equal(cachedOpenLink(storage, A, v1), null, "niente da riusare: la copia si chiede al server");
  rememberOpenLink(storage, A, v1, URL_1);
  assert.equal(cachedOpenLink(storage, A, v1), URL_1, "la stessa versione la riusa: nessuna copia nuova");
  // A: «Crea il link per tutti» in testata, poi «Crea un link nuovo» in Raccolta: la versione cambia, il link di prima no.
  assert.equal(cachedOpenLink(storage, A, v2), null);
  rememberOpenLink(storage, A, v2, URL_2);
  assert.equal(cachedOpenLink(storage, A, v1), null, "il link ritirato non torna");
  assert.equal(cachedOpenLink(storage, A, v2), URL_2);
  // B: un'altra rilevazione non prende il link di A.
  assert.equal(cachedOpenLink(storage, B, v2), null);
  assert.deepEqual([...storage.data.keys()], [`${OPEN_LINK_CACHE_PREFIX}${A}`], "una voce sola per rilevazione");
  // Si tiene il link con il suo token, mai l'hash né la versione al posto del link.
  assert.doesNotMatch(storage.data.get(`${OPEN_LINK_CACHE_PREFIX}${A}`) ?? "", /2{64}/);
});

test("without a version, a broken entry, a foreign address or a storage that refuses: nothing is reused", () => {
  const storage = memory();
  const v = openLinkVersion("3".repeat(64));
  rememberOpenLink(storage, A, null, URL_1);
  assert.equal(storage.data.size, 0, "senza link non si tiene niente");
  rememberOpenLink(storage, A, v, "javascript:alert(1)");
  rememberOpenLink(storage, A, v, "https://altro.example/a/air_personale");
  assert.equal(storage.data.size, 0, "solo un link /s/");
  storage.data.set(`${OPEN_LINK_CACHE_PREFIX}${A}`, "{non json");
  assert.equal(cachedOpenLink(storage, A, v), null);
  assert.equal(cachedOpenLink(null, A, v), null);
  const refusing: LinkStorage = {
    getItem: () => {
      throw new Error("negato");
    },
    setItem: () => {
      throw new Error("pieno");
    },
  };
  assert.doesNotThrow(() => rememberOpenLink(refusing, A, v, URL_1));
  assert.equal(cachedOpenLink(refusing, A, v), null);
});

test("the version is a fingerprint of the hash: it changes with a new link, it is never the hash", () => {
  const hash = "4".repeat(64);
  const v = openLinkVersion(hash);
  assert.match(v ?? "", /^[0-9a-f]{16}$/);
  assert.equal(openLinkVersion(hash), v, "sempre la stessa per lo stesso link");
  assert.notEqual(openLinkVersion("5".repeat(64)), v);
  assert.ok(!hash.includes(v ?? "x"));
  assert.equal(openLinkVersionOf({ openLinkTokenHash: hash }), v);
  assert.equal(openLinkVersionOf({}), null);
  assert.equal(openLinkVersion(null), null);
});

test("the page and the hook: a key per rilevazione on the header and the tab, the version passed down, no copy kept in memory", () => {
  const root = new URL("../../../", import.meta.url);
  const page = readFileSync(new URL("src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx", root), "utf8");
  assert.match(page, /<ReadinessHeader\s+key=\{assessment\.id\}/);
  assert.match(page, /<div key=\{assessment\.id\} data-readiness-tab=\{tab\}>/);
  assert.match(page, /linkVersion=\{linkVersion\}/);
  assert.match(page, /version: linkVersion \}\}/);
  const hook = readFileSync(new URL("src/components/ai-readiness/open-link.tsx", root), "utf8");
  assert.doesNotMatch(hook, /useRef/, "nessun link ricordato fuori dalla versione");
  assert.match(hook, /cachedOpenLink\(browserLinkStorage\(\), assessmentId, linkVersion\)/);
  assert.match(hook, /rememberOpenLink\(browserLinkStorage\(\), assessmentId, result\.data\.linkVersion \?\? null, result\.data\.openUrl\)/);
  const action = readFileSync(new URL("src/lib/actions/ai-readiness.ts", root), "utf8");
  assert.match(action, /linkVersion: openLinkVersion\(tokenHash\) \}/, "«Crea» dice al browser la versione nuova");
  // Chi comincia il questionario da una copia la tiene viva: l'ultimo uso si aggiorna dopo la risposta.
  const start = action.slice(action.indexOf("export async function startOpenSurveyAction"), action.indexOf("export async function createAiReadinessRespondentInviteAction"));
  assert.match(start, /const found = await getAssessmentByOpenLinkTokenHash\(openHash\);/);
  assert.match(start, /after\(\(\) =>\s*touchAssessmentOpenLinkCopy\(usedAssessmentId, openHash\)\.catch\(/);
});
