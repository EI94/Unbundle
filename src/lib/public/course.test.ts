import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { KEPT_OTHER_COHORT_TEXT } from "../learning/join-arrival.ts";
import { COURSE_DOOR_CHECK_SECONDS, COURSE_JOIN_TEXT, COURSE_LINK_TEXT, courseHelp, courseLine, courseRetention, courseWhen } from "./course.ts";
import { DOOR_CHECK_MAX_SECONDS, DOOR_CHECK_PROBE, doorCheckAfter, doorCheckDelayMs, doorCheckRuns } from "../../app/c/[token]/door-check.ts";

// (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11 «Corso `/c`», audit Fuori §3.7) Il link di un corso:
// una card con H1 = il titolo del corso, la riga della data una volta sola, un solo pulsante pieno, la privacy in una
// frase più «Cosa viene registrato ▸», l'attesa da sola con l'ingresso chiuso. Dati inventati.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "");

/** Tutte le stringhe di un valore (oggetti e array), per i controlli dei testi. */
function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

test("the date once: «Martedì 24 novembre · 14:30–16:30 · con {formatore}», in Rome time", () => {
  assert.equal(courseWhen("2026-11-24T13:30:00Z", "2026-11-24T15:30:00Z", "Europe/Rome"), "Martedì 24 novembre · 14:30–16:30");
  assert.equal(
    courseLine({ startsAt: "2026-11-24T13:30:00Z", endsAt: "2026-11-24T15:30:00Z", timezone: "Europe/Rome", trainerName: " Giulia Esempio " }),
    "Martedì 24 novembre · 14:30–16:30 · con Giulia Esempio",
  );
  assert.equal(courseLine({ startsAt: "2026-11-24T13:30:00Z", endsAt: "2026-11-24T15:30:00Z", timezone: "Europe/Rome", trainerName: null }), "Martedì 24 novembre · 14:30–16:30");
  // Su due giorni, inizio e fine per intero; un fuso diverso cambia le ore.
  assert.equal(courseWhen("2026-11-24T22:00:00Z", "2026-11-25T08:00:00Z", "Europe/Rome"), "Martedì 24 novembre 23:00 – mercoledì 25 novembre 09:00");
  assert.equal(courseWhen("2026-11-24T13:30:00Z", "2026-11-24T15:30:00Z", "Europe/London"), "Martedì 24 novembre · 13:30–15:30");
  for (const line of [courseWhen("2026-11-24T13:30:00Z", "2026-11-24T15:30:00Z", "Europe/Rome")]) {
    assert.doesNotMatch(line, /Europe|Rome|UTC/, "nessun fuso a schermo");
  }
});

test("what is recorded: true sentences, the retention after the course closes, the group of 5 from the results rule", () => {
  assert.equal(courseRetention(30), "Le risposte restano conservate per 30 giorni dopo la chiusura del corso.");
  assert.equal(courseRetention(1), "Le risposte restano conservate per 1 giorno dopo la chiusura del corso.");
  assert.doesNotMatch(courseRetention(30), /eliminat/, "la cancellazione è a mano: niente «poi vengono eliminate»");
  assert.equal(COURSE_LINK_TEXT.privacy, "Il formatore vede le tue risposte. L'azienda registra presenza ed esercizi consegnati, senza voti.");
  assert.equal(COURSE_LINK_TEXT.recorded, "Cosa viene registrato");
  assert.ok(COURSE_LINK_TEXT.recordedTrainer.includes("{N}"), "il 5 viene da RESULTS_MINIMUM_GROUP, non scritto a mano");
  const page = code("src/app/c/[token]/page.tsx");
  assert.match(page, /fillPublic\(T\.recordedTrainer, \{ N: RESULTS_MINIMUM_GROUP \}\)/);
  assert.match(page, /<li>\{participantNotice\}<\/li>/, "l'informativa del registro resta, nella piega");
  assert.match(read("src/lib/learning/register-legal.ts"), /formazione sull'AI, la tua azienda/, "«AI», non «IA»");
  assert.equal(courseHelp("Giulia Esempio"), "Problemi a entrare? Chiedi a Giulia Esempio.");
  assert.equal(courseHelp(null), "Problemi a entrare? Chiedi al formatore.");
});

test("the texts: the words outside the dashboard, neutral gender, no jargon, the real names of the buttons", () => {
  const texts = [...strings(COURSE_LINK_TEXT), ...strings(COURSE_JOIN_TEXT)];
  assert.ok(texts.length > 50, `${texts.length} testi`);
  assert.deepEqual(findHubForbiddenIn(texts, "esterno"), []);
  for (const text of texts) {
    assert.doesNotMatch(text, /\b(?:iscritt[oa]|entrat[oa]|benvenut[oa]|rigenerar\w*|reso visibile)\b|\bIA\b/i, text);
  }
  // L'errore di Firebase nomina il pulsante che c'è davvero.
  assert.equal(COURSE_JOIN_TEXT.firebase["auth/user-not-found"], "Nessun account con questa email: tocca «Non ho un account: creane uno».");
  assert.equal(COURSE_JOIN_TEXT.toRegister, "Non ho un account: creane uno");
  assert.doesNotMatch(strings(COURSE_JOIN_TEXT.firebase).join(" "), /«Crea un account»/);
  assert.equal(COURSE_LINK_TEXT.waiting, "Ti facciamo entrare appena si apre la lezione.");
  assert.equal(COURSE_DOOR_CHECK_SECONDS, 10);
});

test("the page: the public shell, the course title as H1, one card, the door checked by itself every 10 seconds", () => {
  const page = code("src/app/c/[token]/page.tsx");
  assert.match(page, /<PublicShell client=\{preview\.workspaceName\} footer=\{helpFooter\(preview\.trainerName\)\}>/);
  assert.match(page, /<PublicCard title=\{course\.programTitle\} titleClassName="text-2xl tracking-tight">/, "H1 = il titolo del corso");
  assert.match(page, /\{courseLine\(course\)\}/);
  assert.match(page, /<Fold id="cosa-viene-registrato" title=\{T\.recorded\}/, "chiusa, si apre a richiesta");
  assert.match(page, /<p className="mt-5 font-medium" role="status" data-testid="join-waiting">\s*\{T\.waiting\}\s*<\/p>/);
  assert.equal(page.match(/<DoorWatch \/>/g)?.length, 2, "con l'ingresso chiuso, con o senza il corso");
  // Un link che non vale: la scheda unica, con il testo di chi l'ha avuto in chat; chi è già nel corso rientra.
  assert.match(page, /<PublicStateCard kind="link" body=\{body\}>\s*\{comeBack\}\s*<\/PublicStateCard>/);
  assert.match(page, /href=\{`\/login\?callbackUrl=\$\{encodeURIComponent\(`\/c\/\$\{token\}`\)\}`\}/);
  assert.match(page, /if \(enrolled\) redirect\(`\/dashboard\/\$\{enrolled\.workspaceId\}\/learning\/\$\{enrolled\.programId\}`\);/);
  // Niente più badge, «Formatore:», il nome del formatore due volte, «Entrando ti iscrivi», il marchio cliccabile.
  for (const gone of ["<Badge", "Formatore:", "Entrando ti iscrivi", 'href="/"', "rigenerare", "CardTitle", "Questa pagina non si aggiorna da sola"]) {
    assert.ok(!page.includes(gone), gone);
  }
  const watch = code("src/app/c/[token]/door-watch.tsx");
  assert.match(watch, /if \(!doorCheckRuns\(\{ online: navigator\.onLine, visible: document\.visibilityState === "visible" \}\)\) \{\s*schedule\(\);\s*return;\s*\}/, "senza rete o con la scheda nascosta, niente");
  assert.match(watch, /const next = doorCheckAfter\(failures, await reachable\(\)\);/);
  assert.match(watch, /if \(next\.refresh\) router\.refresh\(\);/, "rilegge la pagina solo se la rete arriva al sito");
  assert.match(watch, /await fetch\(DOOR_CHECK_PROBE, \{ method: "HEAD", cache: "no-store" \}\)/);
  assert.match(watch, /window\.addEventListener\("online", onOnline\)/, "appena torna la rete");
  assert.match(watch, /document\.addEventListener\("visibilitychange", onVisible\)/, "e appena si torna dalla chat");
  assert.match(watch, /timer = window\.setTimeout\(\(\) => void check\(\), doorCheckDelayMs\(failures\)\)/, "il ritmo dal modulo puro");
  assert.doesNotMatch(watch, /setInterval/);
  const layout = code("src/app/c/layout.tsx");
  assert.match(layout, /return <PublicRoot>\{children\}<\/PublicRoot>;/, "chiara, resa dal server");
  assert.match(layout, /export const viewport: Viewport = PUBLIC_VIEWPORT;/);
  const error = code("src/app/c/[token]/error.tsx");
  assert.match(error, /<PublicErrorScreen retry=\{retry\} body=\{COURSE_LINK_TEXT\.error\} \/>/, "solo «Riprova», che rilegge la pagina");
  assert.doesNotMatch(error, /\breset\b|reload/);
});

test("the door check: every 10 s, never offline or hidden, doubling after a failure up to 2 minutes, back to 10 s once the site answers", () => {
  assert.equal(doorCheckDelayMs(0), 10_000);
  assert.equal(doorCheckDelayMs(1), 20_000);
  assert.equal(doorCheckDelayMs(2), 40_000);
  assert.equal(doorCheckDelayMs(3), 80_000);
  assert.equal(doorCheckDelayMs(4), DOOR_CHECK_MAX_SECONDS * 1000);
  assert.equal(doorCheckDelayMs(50), 120_000, "mai oltre i 2 minuti");
  assert.equal(doorCheckDelayMs(-3), 10_000);
  assert.equal(doorCheckRuns({ online: true, visible: true }), true);
  assert.equal(doorCheckRuns({ online: false, visible: true }), false, "senza rete la rilettura diventerebbe la pagina «offline» del browser");
  assert.equal(doorCheckRuns({ online: true, visible: false }), false);
  // Una serie: due fallimenti (la rete non arriva al sito), poi il sito risponde.
  let state = { failures: 0, refresh: false };
  state = doorCheckAfter(state.failures, false);
  assert.deepEqual(state, { failures: 1, refresh: false });
  state = doorCheckAfter(state.failures, false);
  assert.deepEqual(state, { failures: 2, refresh: false });
  assert.equal(doorCheckDelayMs(state.failures), 40_000);
  state = doorCheckAfter(state.failures, true);
  assert.deepEqual(state, { failures: 0, refresh: true });
  assert.equal(doorCheckDelayMs(state.failures), 10_000);
  assert.equal(DOOR_CHECK_PROBE, "/favicon.ico", "un file piccolo del sito, non la pagina");
});

test("the join form: one filled button; «Usa email e password» a 44 px link; «Non sono io» offers Google and e-mail again", () => {
  const form = code("src/components/learning/join-course-form.tsx");
  // Il pieno è Google finché il modulo è chiuso; aperto, il pieno è «Entra» e Google diventa bordato.
  assert.match(form, /<Button className=\{PUBLIC_PRIMARY\} variant=\{showEmail \? "outline" : "default"\} type="button" data-testid="join-google" onClick=\{withGoogle\}>/);
  assert.match(form, /<button className=\{PUBLIC_LINK\} type="button" data-testid="join-use-email" onClick=\{\(\) => setShowEmail\(true\)\}>/);
  assert.match(form, /<Button className=\{PUBLIC_PRIMARY\} type="submit" disabled=\{busy\} data-testid="join-email-submit">/);
  assert.match(form, /onClick=\{\(\) => \{\s*setNotMe\(true\);\s*setError\(null\);\s*\}\}/, "«Non sono io» non apre Google da solo");
  assert.match(form, /const asSignedIn = signedInAs && !notMe \? signedInAs : null;/);
  // Campi a 16 px e 44 px; nessun testo scritto nel componente, nessun colore fisso.
  assert.equal(form.match(/className=\{PUBLIC_FIELD\}/g)?.length, 3);
  assert.doesNotMatch(form, /emerald|amber|text-white|text-xs/);
  assert.doesNotMatch(form, /"[A-ZÈ][a-zàèéìòù']+\s[^"\n]*"/, "nessuna frase scritta a mano");
  assert.doesNotMatch(form, /window\.(?:confirm|prompt|alert)\b/);
  // Il bivio di `kept_other_cohort` resta com'è.
  assert.match(form, /\{T\.reopen\}/);
  assert.equal(KEPT_OTHER_COHORT_TEXT.open, "Apri il corso");
});
