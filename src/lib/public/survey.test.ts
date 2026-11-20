import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { SURVEY_TEXT, expertCount, expertDone, noticeUrlOf, surveyAreas, surveyDay, surveyFacts, surveyMinutes, surveyNotice, surveyPrivacyLine, surveyProgressLabel } from "./survey.ts";
import { enableTsxImports } from "../../components/use-cases/detail/referent/tsx-test-loader.ts";

// (Rilascio 10, ondata 4 «Fuori», docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.8) Il questionario per chi risponde:
// `/s` con l'H1 «Com'è l'AI nel tuo lavoro?», l'area da un elenco e niente email (D12); `/a` con una testata corta, la
// presa visione all'invio senza casella, una barra con un solo numero; l'informativa unica con «I tuoi dati ▸» e la
// cancellazione confermata nella pagina. Dati inventati.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");
const code = (path: string) =>
  read(path)
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

let renderToStaticMarkup: (element: unknown) => string;
let h: (type: unknown, props: unknown, ...children: unknown[]) => unknown;
let notice: typeof import("../../components/public/survey-notice.tsx");
let controls: typeof import("../../components/ai-readiness/respondent-privacy-controls.tsx");
before(async () => {
  await enableTsxImports();
  notice = await import("../../components/public/survey-notice.tsx");
  controls = await import("../../components/ai-readiness/respondent-privacy-controls.tsx");
  const react = await import("react");
  h = (type, props, ...children) => react.createElement(type as never, props as never, ...(children as never[]));
  ({ renderToStaticMarkup } = (await import("react-dom/server")) as unknown as { renderToStaticMarkup: (element: unknown) => string });
});
const readable = (html: string) => html.replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const textOf = (html: string) => readable(html).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();

test("one progress number and one «salvato»: «7 di 19 · salvato 10:42»; before the first answer, the total", () => {
  assert.equal(surveyProgressLabel({ answered: 0, total: 19, status: "idle", savedTime: null }), "19 domande · si salva da solo");
  assert.equal(surveyProgressLabel({ answered: 7, total: 19, status: "saved", savedTime: "10:42" }), "7 di 19 · salvato 10:42");
  assert.equal(surveyProgressLabel({ answered: 7, total: 19, status: "idle", savedTime: "10:42" }), "7 di 19 · salvato 10:42", "una bozza ripresa");
  assert.equal(surveyProgressLabel({ answered: 7, total: 19, status: "dirty", savedTime: "10:42" }), "7 di 19 · salvo…");
  assert.equal(surveyProgressLabel({ answered: 7, total: 19, status: "saving", savedTime: null }), "7 di 19 · salvo…");
  assert.equal(surveyProgressLabel({ answered: 7, total: 19, status: "error", savedTime: "10:42" }), "7 di 19 · non salvato, riprova tra poco");
  assert.equal(surveyProgressLabel({ answered: 3, total: 19, status: "idle", savedTime: null }), "3 di 19");
  for (const status of ["idle", "dirty", "saving", "saved", "error"] as const) {
    const label = surveyProgressLabel({ answered: 7, total: 19, status, savedTime: "10:42" });
    assert.equal(label.match(/\d+ di \d+/g)?.length, 1, `un solo numero: ${label}`);
  }
});

test("the header facts and the privacy line say what the code does: pseudonymous, the threshold for the areas, the named mode", () => {
  assert.equal(surveyMinutes(19), 10);
  assert.equal(surveyMinutes(1), 2, "almeno 2 minuti");
  assert.equal(surveyFacts(10, false), "10 minuti · risposte pseudonime · si salva da solo");
  assert.equal(surveyFacts(10, true), "10 minuti · nominativo · si salva da solo");
  assert.equal(
    surveyPrivacyLine(false, 5),
    "Le risposte sono salvate con un codice al posto del nome e aggregate: i risultati per area si vedono solo con almeno 5 risposte.",
  );
  // Nominativo, la soglia può scendere a 1 (`updateAiReadinessThresholdAction`): il singolare.
  assert.equal(surveyPrivacyLine(true, 1), "Il questionario è nominativo: i risultati per area si vedono solo con almeno 1 risposta.");
  assert.equal(surveyPrivacyLine(true, 3), "Il questionario è nominativo: i risultati per area si vedono solo con almeno 3 risposte.");
  // Mai più di quello che fa il codice: non «anonime», non «solo gruppi» (il profilo dell'azienda usa ogni risposta).
  for (const line of [surveyFacts(10, false), surveyPrivacyLine(false, 5), surveyPrivacyLine(true, 1)]) {
    assert.doesNotMatch(line, /anonim|solo in gruppi|solo risultati di gruppo/i, line);
  }
  assert.equal(SURVEY_TEXT.title, "Com'è l'AI nel tuo lavoro?");
  assert.equal(expertCount(1), "1 caso d'uso inviato");
  assert.equal(expertCount(2), "2 casi d'uso inviati");
  assert.equal(expertDone(1), "Hai inviato 1 caso d'uso. Il team lo esaminerà per capire dove l'AI può aiutare davvero.");
  assert.equal(expertDone(3), "Hai inviato 3 casi d'uso. Il team li esaminerà per capire dove l'AI può aiutare davvero.");
});

test("the single notice «Come usiamo le tue risposte» says, fact by fact, what the notice of before said and what the code does", () => {
  const rows = surveyNotice({
    privacyConfig: { controllerName: "Cliente Demo S.p.A.", processorName: "Unbundle / Lateral Space", legalBasis: "Legittimo interesse", dataRetentionDays: 180 },
    threshold: 5,
    named: false,
  });
  assert.deepEqual(rows, [
    { label: "Chi le raccoglie", value: "Cliente Demo S.p.A., con l'aiuto di Unbundle / Lateral Space." },
    { label: "Perché", value: "Per misurare, in forma aggregata, quanto l'azienda è pronta a usare l'AI." },
    { label: "Come sono salvate", value: "Con un codice al posto del nome (pseudonimo)." },
    {
      label: "Chi le vede",
      value:
        "Chi gestisce la rilevazione vede il profilo dell'azienda, fatto con tutte le risposte, e i risultati per area solo con almeno 5 risposte. Le risposte di una singola persona non le vede, salvo che le impostazioni della privacy lo permettano.",
    },
    { label: "Su quale base", value: "Legittimo interesse." },
    { label: "Per quanto tempo", value: "180 giorni." },
  ]);
  // Nominativo, la vista individuale accesa, la soglia a 1, senza i valori: i fatti di questa rilevazione, nessuno inventato.
  assert.deepEqual(
    surveyNotice({ privacyConfig: { allowIndividualView: true, dataRetentionDays: 1 }, threshold: 1, named: true }).map((r) => r.value),
    [
      "La tua azienda, con l'aiuto di Unbundle / Lateral Space.",
      "Per misurare, in forma aggregata, quanto l'azienda è pronta a usare l'AI.",
      "Con nome e cognome: il questionario è nominativo.",
      "Chi gestisce la rilevazione vede il profilo dell'azienda, fatto con tutte le risposte, e i risultati per area solo con almeno 1 risposta. Con le impostazioni di questa rilevazione può vedere anche le risposte di ogni persona.",
      "La indica l'azienda.",
      "1 giorno.",
    ],
  );
  assert.deepEqual(surveyNotice({ privacyConfig: null, threshold: 5, named: false }).at(-1), { label: "Per quanto tempo", value: "365 giorni." });
  for (const row of rows) assert.doesNotMatch(row.value, /anonim/i, row.label);

  const html = readable(
    renderToStaticMarkup(
      h(notice.SurveyNotice, {
        privacyConfig: { controllerName: "Cliente Demo", privacyNoticeUrl: "https://cliente-demo.test/privacy" },
        threshold: 5,
        named: false,
        support: { label: "aiuto@cliente-demo.test", mailto: "mailto:aiuto@cliente-demo.test" },
      }),
    ),
  );
  assert.ok(textOf(html).startsWith("Chi le raccoglie Cliente Demo, con l'aiuto di Unbundle / Lateral Space."), textOf(html));
  assert.ok(textOf(html).includes("Domande aiuto@cliente-demo.test Leggi l'informativa completa"));
  assert.match(html, /<a href="https:\/\/cliente-demo\.test\/privacy"[^>]*target="_blank" rel="noreferrer"/);
  // Un indirizzo pericoloso non diventa un link, e non si mostra.
  const unsafe = readable(renderToStaticMarkup(h(notice.SurveyNotice, { privacyConfig: { privacyNoticeUrl: "javascript:alert(1)" }, threshold: 5, named: false, support: null })));
  assert.ok(!unsafe.includes("javascript:") && !unsafe.includes("Leggi l'informativa completa"));
  assert.ok(textOf(unsafe).includes("Domande Chiedi al referente interno."));
  // Un indirizzo scritto a mano si mostra ancora, come prima: un link quando lo è, altrimenti il testo.
  const typed = readable(renderToStaticMarkup(h(notice.SurveyNotice, { privacyConfig: { privacyNoticeUrl: "Intranet › Privacy" }, threshold: 5, named: false, support: null })));
  assert.ok(textOf(typed).endsWith("Informativa completa: Intranet › Privacy"), textOf(typed));
});

test("the address of the full notice: web pages and e-mails as links (with https:// when it is missing), other text as text, never another scheme", () => {
  assert.deepEqual(noticeUrlOf("https://cliente-demo.test/privacy"), { href: "https://cliente-demo.test/privacy" });
  assert.deepEqual(noticeUrlOf(" www.cliente-demo.test/privacy "), { href: "https://www.cliente-demo.test/privacy" });
  assert.deepEqual(noticeUrlOf("cliente-demo.test"), { href: "https://cliente-demo.test" });
  assert.deepEqual(noticeUrlOf("privacy@cliente-demo.test"), { href: "mailto:privacy@cliente-demo.test" });
  assert.deepEqual(noticeUrlOf("mailto:privacy@cliente-demo.test"), { href: "mailto:privacy@cliente-demo.test" });
  assert.deepEqual(noticeUrlOf("Vedi: intranet aziendale"), { text: "Vedi: intranet aziendale" });
  for (const unsafe of ["javascript:alert(1)", "data:text/html,x", "JAVASCRIPT:alert(1)"]) assert.equal(noticeUrlOf(unsafe), null, unsafe);
  for (const empty of [null, undefined, "", "   ", 42]) assert.equal(noticeUrlOf(empty), null);
});

test("«La tua area»: the areas the assessment already knows, written as they are, so no unit splits; none, the free field", () => {
  // Il risultato per area raggruppa per il testo esatto senza spazi in testa e in coda (scoring.ts): «Vendite» e
  // «vendite» sono già due aree, e restano due scelte; «  Vendite » è «Vendite».
  assert.deepEqual(surveyAreas(["Vendite", "  Vendite ", "vendite", "Acquisti  e logistica", null, undefined, "", " ", "X", "Privacy deleted", "Amministrazione"]), [
    "Acquisti  e logistica",
    "Amministrazione",
    "vendite",
    "Vendite",
  ]);
  assert.deepEqual(surveyAreas([]), []);
  const page = code("src/app/s/[token]/page.tsx");
  assert.match(page, /const areas = surveyAreas\(\(await listRespondentsByAssessment\(found\.assessment\.id\)\)\.map\(\(respondent\) => respondent\.organizationUnit\)\);/);
  assert.match(page, /<OpenSurveyStartForm openToken=\{token\} named=\{named\} areas=\{areas\} \/>/);
  const form = code("src/components/ai-readiness/open-survey-start-form.tsx");
  assert.match(form, /\{areas\.length > 0 \? \(\s*<select/, "con aree: l'elenco");
  assert.match(form, /\{areas\.map\(\(name\) => \(/);
  assert.match(form, /<option value=\{OTHER_AREA\}>\{S\.areaOther\}<\/option>/, "più «Un'altra area», da scrivere");
  assert.match(form, /\) : \(\s*<Input\s+id="organizationUnit"\s+name="organizationUnit"/, "senza aree: il campo da scrivere di prima");
  assert.ok(!("areas" in SURVEY_TEXT), "nessun elenco scritto a mano");
});

test("«I tuoi dati»: download; the comparison (and what withdrawing it changes) only if given; erasing asks in the page, never window.confirm", () => {
  const TOKEN = "tok_XX0001";
  const noop = () => undefined;
  const closed = readable(renderToStaticMarkup(h(controls.RespondentPrivacyActions, { token: TOKEN, benchmarkGiven: false, confirming: false, onAsk: noop, onCancel: noop })));
  assert.equal(textOf(closed), "Scarica una copia Cancella le mie risposte");
  assert.ok(closed.includes(`href="/api/ai-readiness/respondents/${TOKEN}/export"`));
  assert.ok(!closed.includes("benchmark-consent"), "nessuna revoca di un consenso mai dato");
  assert.ok(!closed.includes("anonymize") && !closed.includes("ANONIMIZZA"), "la cancellazione non parte da un tocco solo");
  assert.ok(!/variant="destructive"|bg-destructive\/10 text-destructive hover/.test(closed));

  const given = readable(renderToStaticMarkup(h(controls.RespondentPrivacyActions, { token: TOKEN, benchmarkGiven: true, confirming: false, onAsk: noop, onCancel: noop })));
  assert.equal(
    textOf(given),
    "Scarica una copia Ritira il consenso al confronto Le risposte restano per la rilevazione interna, ma non servono più ai confronti futuri con altre aziende. Cancella le mie risposte",
  );
  assert.match(given, new RegExp(`<form[^>]*action="/api/ai-readiness/respondents/${TOKEN}/benchmark-consent" method="post"`));

  const asking = readable(renderToStaticMarkup(h(controls.RespondentPrivacyActions, { token: TOKEN, benchmarkGiven: false, confirming: true, onAsk: noop, onCancel: noop })));
  assert.equal(
    textOf(asking),
    "Scarica una copia Cancelliamo i dati che ti identificano, le risposte e i testi collegati a questo link. Non si può annullare. Sì, cancella le risposte Annulla",
  );
  assert.match(asking, /<p id="cancella-domanda" tabindex="-1"/, "la domanda può prendere il fuoco");
  assert.match(asking, new RegExp(`<form[^>]*action="/api/ai-readiness/respondents/${TOKEN}/anonymize" method="post"`));
  assert.match(asking, /<input type="hidden" name="confirmation" value="ANONIMIZZA"\/>/, "la rotta di sempre, con la conferma di sempre");
  for (const file of ["src/components/ai-readiness/respondent-privacy-controls.tsx", "src/app/privacy/ai-readiness/[token]/page.tsx"]) {
    assert.doesNotMatch(code(file), /window\.(?:confirm|prompt|alert)\b|Scrivi ANONIMIZZA|JSON|Controller|Retention|Revoca benchmark/, file);
  }
  // Il fuoco: alla domanda quando la conferma si apre, a «Cancella le mie risposte» con «Annulla»; non al primo disegno.
  const controlsSource = code("src/components/ai-readiness/respondent-privacy-controls.tsx");
  assert.match(controlsSource, /if \(!moved\.current\) return;\s*\(confirming \? questionRef\.current : eraseRef\.current\)\?\.focus\(\);/);
  assert.match(controlsSource, /<Button ref=\{eraseRef\}/);
});

test("the privacy page: the single notice as H1, «I tuoi dati ▸» closed unless a link or an action opens it, light", () => {
  const page = code("src/app/privacy/ai-readiness/[token]/page.tsx");
  assert.match(page, /<h1 className="mt-6 text-2xl font-semibold tracking-tight">\{SURVEY_TEXT\.notice\.title\}<\/h1>/);
  assert.match(page, /<Fold id="i-tuoi-dati" title=\{D\.title\} defaultOpen=\{openData\}/);
  assert.match(page, /const openData = first\(query\.dati\) === "1" \|\| withdrawn \|\| error !== "";/);
  assert.match(page, /<RespondentPrivacyControls token=\{token\} benchmarkGiven=\{benchmarkGiven\} \/>/);
  // Il link di prima, dopo una cancellazione: la scheda unica dice anche che le risposte sono già state cancellate.
  assert.match(page, /if \(!bundle\) return <PublicInvalidScreen body=\{D\.gone\} \/>;/);
  assert.equal(SURVEY_TEXT.data.gone, "Oppure le risposte sono già state cancellate. Per un aiuto, chiedi al referente interno.");
  assert.match(page, /<p className="text-sm text-muted-foreground">\{D\.tracked\}<\/p>/, "le azioni restano registrate, come diceva la pagina di prima");
  assert.match(page, /named=\{bundle\.assessment\.anonymousMode === false\}/);
  assert.match(page, /const canGoBack = bundle\.respondent\.inviteStatus !== "completed" && bundle\.assessment\.status === "open";/);
  assert.match(page, /<Button render=\{<a href=\{`\/a\/\$\{token\}`\} \/>\} nativeButton=\{false\} className=\{`mt-6 \$\{PUBLIC_PRIMARY\}`\} data-testid="privacy-back">/, "il prossimo passo: tornare al questionario");
  assert.doesNotMatch(page, /inviteStatus\}|Torna al survey|Privacy e dati AI Readiness/);
  assert.match(code("src/app/privacy/layout.tsx"), /return <PublicRoot>\{children\}<\/PublicRoot>;/, "chiara: prima era sempre scura");
  assert.ok(existsSync(new URL("../../../src/app/privacy/ai-readiness/[token]/error.tsx", import.meta.url)), "l'errore ha la sua scheda");
});

test("/s: the question as H1, the known areas or the free field, no e-mail (D12), «Inizia» full width; no methodology, no theme switch", () => {
  const page = code("src/app/s/[token]/page.tsx");
  assert.match(page, /<h1 className="mt-6 text-2xl font-semibold tracking-tight break-words">\{SURVEY_TEXT\.title\}<\/h1>/);
  assert.match(page, /\{surveyFacts\(surveyMinutes\(scoredQuestions\(found\)\), named\)\}/);
  assert.match(page, /<Fold id="come-usiamo-le-risposte" title=\{SURVEY_TEXT\.notice\.title\}/, "l'informativa unica, chiusa, in fondo");
  assert.match(page, /if \(!found\) return <PublicInvalidScreen body=\{SURVEY_TEXT\.gone\} \/>;/, "link sbagliato e raccolta chiusa non si confondono");
  for (const gone of ["SurveyThemeToggle", "<Badge", "Alimenta", "track.feeds", "found.assessment.name", 'href="/"', "introCopy"]) assert.ok(!page.includes(gone), gone);
  const form = code("src/components/ai-readiness/open-survey-start-form.tsx");
  assert.ok(!/name="email"|type="email"|Email \(opzionale\)/.test(form), "D12: niente email facoltativa");
  assert.match(form, /name=\{area === OTHER_AREA \? undefined : "organizationUnit"\}/, "l'area scritta a mano porta lo stesso nome");
  assert.match(form, /<Button type="submit" className=\{PUBLIC_PRIMARY\} variant=\{existingUrl \? "outline" : "default"\}/, "un solo pieno, anche con un questionario da riprendere");
  // Il server accetta l'avvio senza email, come prima: nessun cambio ai dati.
  assert.match(read("src/lib/actions/ai-readiness.ts"), /email: formString\(formData, "email"\) \|\| undefined,/);
  assert.ok(!existsSync(new URL("../../../src/components/ai-readiness/survey-theme-toggle.tsx", import.meta.url)), "le pagine pubbliche sono chiare: niente interruttore");
});

test("/a: a short header, the acknowledgement recorded at submit with one line and a link, no checkbox, no English", () => {
  const page = code("src/app/a/[token]/page.tsx");
  assert.match(page, /\{isInternalTrack \? SURVEY_TEXT\.internalTitle : SURVEY_TEXT\.title\}/);
  assert.match(page, /useCaseModule=\{!isInternalTrack\}/, "il modulo dei casi d'uso per tutti, mai per i referenti");
  // Il testo d'apertura solo se chi gestisce la rilevazione l'ha scritto: quello di serie non allunga la testata.
  assert.match(page, /const ownIntro = intro\.trim\(\) && intro !== AI_READINESS_DEFAULT_COPY\.intro \? intro : null;/);
  assert.match(page, /\{ownIntro \? <p>\{ownIntro\}<\/p> : null\}/);
  for (const gone of ["survey-track-summary", "survey-howto", "includedPillars", "AI Readiness OS", "<Badge", "🔗", "💡", "SurveyThemeToggle", "Gestisci privacy"]) assert.ok(!page.includes(gone), gone);
  // Chi raccoglie, perché, come, chi vede, su quale base, per quanto e a chi chiedere: in testa, prima della prima
  // domanda (la bozza arriva al server 2 secondi dopo la prima risposta), e il suo link in fondo.
  assert.match(page, /<Fold id="come-usiamo-le-risposte" title=\{SURVEY_TEXT\.notice\.title\}/);
  assert.match(page, /<SurveyNotice privacyConfig=\{privacy\} threshold=\{found\.assessment\.aggregationThreshold\} named=\{named\} support=\{support\} \/>/);
  assert.ok(page.indexOf("{noticeFold}\n        </header>") > 0, "in testa, prima delle domande");
  assert.ok(page.indexOf("{noticeFold}") < page.indexOf("<UseCaseExpertForm"), "anche nella raccolta dei casi d'uso, prima del modulo");
  assert.match(page, /<PublicNoticeLink href=\{noticeHref\} \/>/);
  assert.equal(
    SURVEY_TEXT.personalLink,
    "Questo link è solo tuo: non inoltrarlo. Per invitare altre persone, condividi il link generale del questionario.",
  );
  const form = code("src/components/ai-readiness/respondent-survey-form.tsx");
  assert.match(form, /<Button type="submit" name="privacyAccepted" value="on" className=\{PUBLIC_PRIMARY\}/, "la presa visione viaggia con l'invio");
  assert.ok(!/<Checkbox\s+name="privacyAccepted"/.test(form), "nessuna casella dell'informativa");
  assert.match(form, /\{F\.acknowledge\}\{" "\}\s*<a href=\{noticeHref\}/);
  assert.match(form, /payload: \{ \.\.\.payload, consents: \{ \.\.\.payload\.consents, privacyAccepted: true \} \}/);
  // In ogni browser: il modulo aggiunge la presa visione all'invio, anche dove FormData non porta il pulsante.
  assert.match(form, /const data = new FormData\(form\);\s*data\.set\("privacyAccepted", "on"\);\s*startTransition\(\(\) => formAction\(data\)\);/);
  assert.match(form, /action=\{formAction\}/, "senza script il modulo resta un modulo, con il pulsante che porta la presa visione");
  assert.match(form, /\["benchmarkConsent", payload\.consents\?\.benchmarkConsent === true\]/);
  assert.doesNotMatch(form, /\["privacyAccepted", /, "il ripristino di una bozza non tocca mai il pulsante d'invio");
  assert.match(form, /\{benchmarkEnabled && \(/);
  assert.match(form, /\{marketingEnabled && \(/);
  assert.match(form, /const showUseCase = useCaseModule && !alreadyAsksForIdeas;/);
  assert.match(form, /<fieldset key=\{question\.id\}/);
  assert.match(form, /<legend id=\{legendId\}/);
  for (const gone of ["Privacy by design", "Titolare:", "Retention", "Pain point", "Outcome desiderato", "Tool attuali", "Use case intake", "surveyPillarTitle", "uppercase", "Bentornato", "emerald", "OK\n", "Invia assessment"]) {
    assert.ok(!form.includes(gone), gone);
  }
  assert.equal(form.match(/className=\{PUBLIC_PRIMARY\}/g)?.length, 1, "un solo pieno: «Invia le risposte»");
  assert.match(form, /\{progressLabel\}/);
  assert.match(form, /className="sticky top-0 z-10/);
  const expert = code("src/components/ai-readiness/use-case-expert-form.tsx");
  assert.match(expert, /\{savedCount > 0 && \(/, "lo zero non si vede");
  assert.match(expert, /<Button type="submit" className=\{PUBLIC_PRIMARY\} disabled=\{finishPending\} data-testid="usecase-finish">/, "«Ho finito» pieno dopo il primo caso");
  assert.match(expert, /<Button type="submit" variant=\{savedCount > 0 \? "outline" : "default"\} className=\{PUBLIC_PRIMARY\}/);
  assert.match(expert, /\{E\.acknowledge\}\{" "\}\s*<a href=\{noticeHref\}/);
  assert.doesNotMatch(expert, /uppercase|emerald|Nessun caso inviato/);
});

test("the texts: «questionario», «caso d'uso», no English, no legal words, neutral gender, «AI»", () => {
  const texts = strings(SURVEY_TEXT);
  assert.ok(texts.length > 100, `${texts.length} testi`);
  assert.deepEqual(findHubForbiddenIn(texts, "esterno"), []);
  for (const text of texts) {
    assert.doesNotMatch(text, /\b(?:benchmark|pain point|outcome|tool|intake|readiness|bentornat[oa]|espert[oa]|iscritt[oa])\b|\bIA\b|\be'/i, text);
  }
  assert.equal(SURVEY_TEXT.form.submit, "Invia le risposte");
  assert.equal(SURVEY_TEXT.notice.title, "Come usiamo le tue risposte");
  assert.equal(surveyDay("2026-11-12T10:00:00Z"), "12 novembre 2026");
  assert.equal(surveyDay(null), null);
  assert.equal(surveyDay("non è una data"), null);
});
