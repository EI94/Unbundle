import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { AI_READINESS_DEFAULT_COPY, brandCopy, withSavedAccents } from "./copy.ts";
import { AI_READINESS_SYSTEM_TEMPLATE } from "./default-template.ts";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.2 voce 0.9) AI Readiness: gli accenti, nel codice e nei testi già salvati, e
// due frasi che non erano vere (il radar «si popola alla soglia», le risposte «salvate sul dispositivo» su /s).

const REPO = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, REPO), "utf8");

const OLD_INTRO = "Questa diagnosi misura la readiness AI dell'organizzazione. Non e un esame: serve a capire dove aiutare meglio team, processi e tecnologia.";
const OLD_COMPLETION = "Grazie. Le risposte saranno aggregate e usate per costruire una roadmap AI piu concreta e sicura.";

test("the proposed opening and closing texts have their accents", () => {
  assert.match(AI_READINESS_DEFAULT_COPY.intro, /Non è un esame/);
  assert.match(AI_READINESS_DEFAULT_COPY.completion, /più concreta/);
});

test("brandCopy: texts saved without accents come back with them; a text written by hand stays as it is", () => {
  assert.equal(brandCopy({ introCopy: OLD_INTRO }, "introCopy"), AI_READINESS_DEFAULT_COPY.intro);
  assert.equal(brandCopy({ completionCopy: OLD_COMPLETION }, "completionCopy"), AI_READINESS_DEFAULT_COPY.completion);
  assert.equal(brandCopy({ introCopy: "Benvenuti: e un questionario breve." }, "introCopy"), "Benvenuti: e un questionario breve.");
  assert.equal(brandCopy({}, "introCopy", "Testo di riserva."), "Testo di riserva.");
  assert.equal(brandCopy(null, "introCopy", "Testo di riserva."), "Testo di riserva.");
  assert.equal(brandCopy({ introCopy: 7 }, "introCopy", "Testo di riserva."), "Testo di riserva.");
  assert.equal(brandCopy({ introCopy: "toString" }, "introCopy"), "toString", "nessuna chiave ereditata");
});

test("withSavedAccents: the system template saved before (ai-readiness-core-4) reads with its accents, nothing else changes", () => {
  const fixed = [
    ["chi controlla: è definito", "chi controlla: e definito"],
    ["processi che è importante sapere?", "processi che e importante sapere?"],
    ["Con costanza: è un tema", "Con costanza: e un tema"],
    ["Se ne è parlato", "Se ne e parlato"],
  ];
  let saved = JSON.stringify(AI_READINESS_SYSTEM_TEMPLATE);
  for (const [now, before] of fixed) {
    assert.ok(saved.includes(now), now);
    saved = saved.replace(now, before);
  }
  const old = JSON.parse(saved) as typeof AI_READINESS_SYSTEM_TEMPLATE;
  assert.notDeepEqual(old, AI_READINESS_SYSTEM_TEMPLATE);
  assert.deepEqual(withSavedAccents(old), AI_READINESS_SYSTEM_TEMPLATE);
  assert.deepEqual(withSavedAccents(AI_READINESS_SYSTEM_TEMPLATE), AI_READINESS_SYSTEM_TEMPLATE, "il modello di oggi resta com'è");
  assert.deepEqual(withSavedAccents({ n: 3, ok: true, none: null, list: ["Se ne e parlato, ma nulla di fatto!"] }), { n: 3, ok: true, none: null, list: ["Se ne e parlato, ma nulla di fatto!"] }, "solo frasi identiche");
  assert.match(read("src/lib/db/queries/ai-readiness.ts"), /return withSavedAccents\(\{\s*pillars: row\.pillars/);
});

test("the pages show the saved texts through brandCopy, and new assessments save the accented defaults", () => {
  assert.match(read("src/app/a/[token]/page.tsx"), /brandCopy\(brand, "introCopy", AI_READINESS_DEFAULT_COPY\.intro\)/);
  // (Rilascio 10, ondata 4) Il testo d'apertura si legge una volta, su /a: /s non lo ripete più.
  assert.doesNotMatch(read("src/app/s/[token]/page.tsx"), /introCopy/);
  assert.match(read("src/components/ai-readiness/respondent-survey-form.tsx"), /brandCopy\(brandConfig, "completionCopy", AI_READINESS_DEFAULT_COPY\.completion\)/);
  assert.match(read("src/components/ai-readiness/assessment-create-form.tsx"), /defaultValue=\{AI_READINESS_DEFAULT_COPY\.intro\}/);
  const action = read("src/lib/actions/ai-readiness.ts");
  assert.match(action, /introCopy: parsed\.data\.introCopy \|\| AI_READINESS_DEFAULT_COPY\.intro,/);
  assert.match(action, /completionCopy: parsed\.data\.completionCopy \|\| AI_READINESS_DEFAULT_COPY\.completion,/);
});

/** I sorgenti dell'AI Readiness (senza test), più l'action e le pagine pubbliche. */
function sources(): string[] {
  const dirs = ["src/lib/ai-readiness/", "src/components/ai-readiness/", "src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/", "src/app/s/", "src/app/a/", "src/app/privacy/ai-readiness/", "src/app/api/ai-readiness/"];
  const files = dirs.flatMap((dir) =>
    (readdirSync(new URL(dir, REPO), { recursive: true }) as string[]).filter((f) => /\.tsx?$/.test(f) && !/\.test\.tsx?$/.test(f)).map((f) => `${dir}${f}`),
  );
  return [...files, "src/lib/actions/ai-readiness.ts"].filter((f) => f !== "src/lib/ai-readiness/copy.ts");
}

test("no missing accent in what people read: «non è», «più», «già», «può», «perché», «così», «-ità»", () => {
  // Parole che senza accento non esistono, o sono un'altra parola.
  const WORDS = /(?<![\p{L}'])(?:piu|gia|puo|perche|sara|esaminera|trasformera|fattibilita|opportunita|responsabilita|priorita|attivita)(?![\p{L}])/u;
  // «e» al posto di «è»: le frasi corrette dall'ondata 0, dove «e» non può essere la congiunzione.
  const PHRASES = [
    "Non e un", "non e aperto", "non e aperta", "non e valido", "non e per", "non e reversibile", "non e piu",
    "livello e spiegato", "risposta e disponibile", "E sempre disponibile", "chi controlla: e definito", "Se ne e parlato",
    "readiness e gestita", "} e il fattore", "passo e attivare", "} e attivo", "che e importante", "Con costanza: e un",
    "se e tecnicamente", "vincolo e ", "campione attuale e ", "ricorrente e ", "com'e oggi", "cosi come", "butta li ",
    "qualita output", "qualita e compliance",
    // (Rilascio 10) Le pagine di chi risponde (/a, /s) e il messaggio del modulo nominativo.
    "Qual e il", "survey e nominativa", "questionario e nominativo",
  ];
  // L'accento a macchina da scrivere («e'» per «è»): mai in un testo.
  const TYPEWRITER = /(?<![\p{L}'])[eE]'(?=\s)/u;
  const found: string[] = [];
  for (const file of sources()) {
    read(file)
      .split("\n")
      .forEach((line, i) => {
        if (/^\s*(\/\/|\*|\/\*)/.test(line) || /keywords:/.test(line)) return;
        if (WORDS.test(line) || TYPEWRITER.test(line) || PHRASES.some((p) => line.includes(p))) found.push(`${file}:${i + 1}: ${line.trim().slice(0, 90)}`);
      });
  }
  assert.deepEqual(found, []);
});

test("the radar sentence is true: the profile uses every answer, the threshold is for areas and the comparison", () => {
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx").replace(/\s+/g, " ");
  assert.doesNotMatch(page, /Il radar si popola/);
  assert.ok(page.includes("Il profilo usa le risposte arrivate finora. Punteggi per area e confronto partono da {bundle.assessment.aggregationThreshold} risposte."));
});

test("(rilascio 10) what the page says about anonymity is true: no «anonymous questionnaire» in the header, and the privacy box names «Cancella le mie risposte»", () => {
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/ai-readiness/page.tsx").replace(/\s+/g, " ");
  // Una rilevazione può essere nominativa: la testata non promette l'anonimato. (Rilascio 10, ondata 4) I testi di chi
  // risponde stanno in src/lib/public/survey.ts.
  const survey = read("src/lib/public/survey.ts");
  assert.match(survey, /identityText: "Questo questionario è nominativo/);
  assert.match(read("src/components/ai-readiness/respondent-survey-form.tsx"), /\{F\.identityText\}/);
  assert.ok(page.includes("Una rilevazione su come l&apos;azienda usa l&apos;AI: inviti, questionario, punteggi e report."));
  // Dal link personale chi risponde cancella le sue risposte (le rende anonime: «Cancella le mie risposte»), non resta
  // anonimo.
  assert.match(survey, /erase: "Cancella le mie risposte",/);
  assert.match(read("src/components/ai-readiness/respondent-privacy-controls.tsx"), /\{D\.erase\}/);
  assert.ok(page.includes("togliere il consenso al confronto e rendere anonime le sue risposte dal suo link personale."));
  assert.doesNotMatch(page, /questionario anonimo|restare anonim/);
});

test("(rilascio 10, §4) the respondent pages say «questionario», never Survey or Assessment, with their accents", () => {
  const a = read("src/app/a/[token]/page.tsx").replace(/\s+/g, " ");
  assert.ok(a.includes('title: "Questionario AI Readiness"'), "the tab title, as on /s");
  // (Rilascio 10, ondata 4) I testi stanno in src/lib/public/survey.ts; la pagina li chiede per chiave.
  const survey = read("src/lib/public/survey.ts");
  for (const title of ["Hai già inviato le risposte", "Il questionario non è aperto"]) assert.ok(survey.includes(`title: "${title}"`), title);
  assert.ok(a.includes("<PublicCard title={SURVEY_TEXT.completed.title}>") && a.includes("<PublicCard title={SURVEY_TEXT.closed.title}>"));
  assert.ok(a.includes("if (!found) return <PublicInvalidScreen body={SURVEY_TEXT.gone} />;"), "the single card of a link that no longer works");
  assert.ok(survey.includes("le tue risposte completano il quadro raccolto con il questionario."));
  assert.ok(survey.includes('personalLink: "Questo link è solo tuo: non inoltrarlo. Per invitare altre persone, condividi il link generale del questionario.",'));
  assert.ok(!a.includes("<Badge") && !a.includes("AI Readiness OS"), "no labels, no «OS»");
  assert.match(read("src/lib/actions/ai-readiness.ts"), /errorState\("Questo questionario è nominativo: inserisci nome e cognome\.",/);
  assert.match(survey, /Nessuna risposta è giusta o sbagliata\./);
  // «Survey», «Assessment», «respondent» e «use case» li vieta il copy-guard di fuori, che controlla anche /a e /s.
  const guard = read("src/lib/use-cases/copy-guard.ts");
  assert.ok(guard.includes('  "src/app/a/",\n  "src/app/s/",'));
});

test("/s has no answers yet: its error page does not promise answers saved on the device, and «Riprova» re-reads the page", () => {
  const page = read("src/app/s/[token]/error.tsx");
  assert.doesNotMatch(page, /salvate su questo dispositivo/);
  // (Rilascio 10, ondata 4) La scheda unica dell'errore delle pagine pubbliche: «Questa pagina non si è caricata.» e il
  // solo «Riprova», che chiama `retry`.
  assert.match(page, /return <PublicErrorScreen retry=\{retry\} \/>;/);
  assert.match(read("src/lib/public/text.ts"), /title: "Questa pagina non si è caricata\.",/);
  assert.doesNotMatch(page, /\breset\b/);
});
