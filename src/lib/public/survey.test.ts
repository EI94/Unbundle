import test, { before } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { findHubForbiddenIn } from "../use-cases/copy-guard.ts";
import { SURVEY_TEXT, expertCount, expertDone, surveyDay, surveyFacts, surveyMinutes, surveyNotice, surveyPrivacyLine, surveyProgressLabel } from "./survey.ts";
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

test("the header facts: «10 minuti · anonimo · si salva da solo», the privacy in one calm line", () => {
  assert.equal(surveyMinutes(19), 10);
  assert.equal(surveyMinutes(1), 2, "almeno 2 minuti");
  assert.equal(surveyFacts(10, false), "10 minuti · anonimo · si salva da solo");
  assert.equal(surveyFacts(10, true), "10 minuti · nominativo · si salva da solo");
  assert.equal(surveyPrivacyLine(false, 5), "Le risposte sono anonime: le leggiamo solo insieme a quelle di almeno 5 colleghi.");
  assert.equal(surveyPrivacyLine(true, 5), "Le risposte si leggono solo per gruppi di almeno 5 persone.");
  assert.equal(SURVEY_TEXT.title, "Com'è l'AI nel tuo lavoro?");
  assert.equal(expertCount(1), "1 caso d'uso inviato");
  assert.equal(expertCount(2), "2 casi d'uso inviati");
  assert.equal(expertDone(1), "Hai inviato 1 caso d'uso. Il team lo esaminerà per capire dove l'AI può aiutare davvero.");
  assert.equal(expertDone(3), "Hai inviato 3 casi d'uso. Il team li esaminerà per capire dove l'AI può aiutare davvero.");
});

test("the single notice «Come usiamo le tue risposte»: who, why, who sees, on what basis, how long, from the assessment", () => {
  const rows = surveyNotice({
    privacyConfig: { controllerName: "Cliente Demo S.p.A.", processorName: "Unbundle / Lateral Space", legalBasis: "Legittimo interesse", dataRetentionDays: 180 },
    threshold: 5,
  });
  assert.deepEqual(rows, [
    { label: "Chi le raccoglie", value: "Cliente Demo S.p.A., con l'aiuto di Unbundle / Lateral Space." },
    { label: "Perché", value: "Per capire dove l'AI può aiutare il lavoro di tutti." },
    { label: "Chi le vede", value: "Solo risultati di gruppo: servono almeno 5 risposte." },
    { label: "Su quale base", value: "Legittimo interesse." },
    { label: "Per quanto tempo", value: "180 giorni." },
  ]);
  // Senza i valori, quelli di sempre; nessuna base inventata.
  assert.deepEqual(surveyNotice({ privacyConfig: null, threshold: 5 }).map((r) => r.value), [
    "La tua azienda, con l'aiuto di Unbundle / Lateral Space.",
    "Per capire dove l'AI può aiutare il lavoro di tutti.",
    "Solo risultati di gruppo: servono almeno 5 risposte.",
    "365 giorni.",
  ]);
  const html = readable(
    renderToStaticMarkup(
      h(notice.SurveyNotice, {
        privacyConfig: { controllerName: "Cliente Demo", privacyNoticeUrl: "https://cliente-demo.test/privacy" },
        threshold: 5,
        support: { label: "aiuto@cliente-demo.test", mailto: "mailto:aiuto@cliente-demo.test" },
      }),
    ),
  );
  assert.ok(textOf(html).startsWith("Chi le raccoglie Cliente Demo, con l'aiuto di Unbundle / Lateral Space."), textOf(html));
  assert.ok(textOf(html).includes("Domande aiuto@cliente-demo.test Leggi l'informativa completa"));
  assert.match(html, /<a href="https:\/\/cliente-demo\.test\/privacy"[^>]*target="_blank" rel="noreferrer"/);
  // Un indirizzo che non è una pagina web non diventa un link.
  const unsafe = readable(renderToStaticMarkup(h(notice.SurveyNotice, { privacyConfig: { privacyNoticeUrl: "javascript:alert(1)" }, threshold: 5, support: null })));
  assert.ok(!unsafe.includes("javascript:") && !unsafe.includes("Leggi l'informativa completa"));
  assert.ok(textOf(unsafe).includes("Domande Chiedi al referente interno."));
});

test("«I tuoi dati»: download; the comparison only if given; erasing asks in the page, never window.confirm, nothing to type", () => {
  const TOKEN = "tok_XX0001";
  const noop = () => undefined;
  const closed = readable(renderToStaticMarkup(h(controls.RespondentPrivacyActions, { token: TOKEN, benchmarkGiven: false, confirming: false, onAsk: noop, onCancel: noop })));
  assert.equal(textOf(closed), "Scarica una copia Cancella le mie risposte");
  assert.ok(closed.includes(`href="/api/ai-readiness/respondents/${TOKEN}/export"`));
  assert.ok(!closed.includes("benchmark-consent"), "nessuna revoca di un consenso mai dato");
  assert.ok(!closed.includes("anonymize") && !closed.includes("ANONIMIZZA"), "la cancellazione non parte da un tocco solo");
  assert.ok(!/variant="destructive"|bg-destructive\/10 text-destructive hover/.test(closed));

  const given = readable(renderToStaticMarkup(h(controls.RespondentPrivacyActions, { token: TOKEN, benchmarkGiven: true, confirming: false, onAsk: noop, onCancel: noop })));
  assert.equal(textOf(given), "Scarica una copia Ritira il consenso al confronto Cancella le mie risposte");
  assert.match(given, new RegExp(`<form action="/api/ai-readiness/respondents/${TOKEN}/benchmark-consent" method="post">`));

  const asking = readable(renderToStaticMarkup(h(controls.RespondentPrivacyActions, { token: TOKEN, benchmarkGiven: false, confirming: true, onAsk: noop, onCancel: noop })));
  assert.equal(textOf(asking), "Scarica una copia Cancelliamo nome, risposte e testi collegati a questo link. Non si può annullare. Sì, cancella le risposte Annulla");
  assert.match(asking, new RegExp(`<form[^>]*action="/api/ai-readiness/respondents/${TOKEN}/anonymize" method="post"`));
  assert.match(asking, /<input type="hidden" name="confirmation" value="ANONIMIZZA"\/>/, "la rotta di sempre, con la conferma di sempre");
  for (const file of ["src/components/ai-readiness/respondent-privacy-controls.tsx", "src/app/privacy/ai-readiness/[token]/page.tsx"]) {
    assert.doesNotMatch(code(file), /window\.(?:confirm|prompt|alert)\b|Scrivi ANONIMIZZA|JSON|Controller|Retention|Revoca benchmark/, file);
  }
});

test("the privacy page: the single notice as H1, «I tuoi dati ▸» closed unless a link or an action opens it, light", () => {
  const page = code("src/app/privacy/ai-readiness/[token]/page.tsx");
  assert.match(page, /<h1 className="mt-6 text-2xl font-semibold tracking-tight">\{SURVEY_TEXT\.notice\.title\}<\/h1>/);
  assert.match(page, /<Fold id="i-tuoi-dati" title=\{D\.title\} defaultOpen=\{openData\}/);
  assert.match(page, /const openData = first\(query\.dati\) === "1" \|\| withdrawn \|\| error !== "";/);
  assert.match(page, /<RespondentPrivacyControls token=\{token\} benchmarkGiven=\{benchmarkGiven\} \/>/);
  assert.match(page, /if \(!bundle\) return <PublicInvalidScreen body=\{SURVEY_TEXT\.gone\} \/>;/);
  assert.match(page, /<PublicLink href=\{`\/a\/\$\{token\}`\}>\{SURVEY_TEXT\.notice\.back\}<\/PublicLink>/);
  assert.doesNotMatch(page, /inviteStatus\}|Torna al survey|Privacy e dati AI Readiness/);
  assert.match(code("src/app/privacy/layout.tsx"), /return <PublicRoot>\{children\}<\/PublicRoot>;/, "chiara: prima era sempre scura");
  assert.ok(existsSync(new URL("../../../src/app/privacy/ai-readiness/[token]/error.tsx", import.meta.url)), "l'errore ha la sua scheda");
});

test("/s: the question as H1, area from a list, no e-mail (D12), «Inizia» full width; no methodology, no theme switch", () => {
  const page = code("src/app/s/[token]/page.tsx");
  assert.match(page, /<h1 className="mt-6 text-2xl font-semibold tracking-tight break-words">\{SURVEY_TEXT\.title\}<\/h1>/);
  assert.match(page, /\{surveyFacts\(surveyMinutes\(scoredQuestions\(found\)\), named\)\}/);
  assert.match(page, /<Fold id="come-usiamo-le-risposte" title=\{SURVEY_TEXT\.notice\.title\}/, "l'informativa unica, chiusa, in fondo");
  assert.match(page, /if \(!found\) return <PublicInvalidScreen body=\{SURVEY_TEXT\.gone\} \/>;/, "link sbagliato e raccolta chiusa non si confondono");
  for (const gone of ["SurveyThemeToggle", "<Badge", "Alimenta", "track.feeds", "found.assessment.name", 'href="/"', "introCopy"]) assert.ok(!page.includes(gone), gone);
  const form = code("src/components/ai-readiness/open-survey-start-form.tsx");
  assert.ok(!/name="email"|type="email"|Email \(opzionale\)/.test(form), "D12: niente email facoltativa");
  assert.match(form, /\{SURVEY_TEXT\.areas\.map\(\(name\) => \(/);
  assert.match(form, /name=\{area === OTHER_AREA \? undefined : "organizationUnit"\}/, "l'area scritta a mano porta lo stesso nome");
  assert.match(form, /<Button type="submit" className=\{PUBLIC_PRIMARY\} variant=\{existingUrl \? "outline" : "default"\}/, "un solo pieno, anche con un questionario da riprendere");
  assert.equal(new Set(SURVEY_TEXT.areas).size, SURVEY_TEXT.areas.length);
  assert.ok(SURVEY_TEXT.areas.length >= 8 && SURVEY_TEXT.areas.length <= 12);
  // Il server accetta l'avvio senza email, come prima: nessun cambio ai dati.
  assert.match(read("src/lib/actions/ai-readiness.ts"), /email: formString\(formData, "email"\) \|\| undefined,/);
  assert.ok(!existsSync(new URL("../../../src/components/ai-readiness/survey-theme-toggle.tsx", import.meta.url)), "le pagine pubbliche sono chiare: niente interruttore");
});

test("/a: a short header, the acknowledgement recorded at submit with one line and a link, no checkbox, no English", () => {
  const page = code("src/app/a/[token]/page.tsx");
  assert.match(page, /\{isInternalTrack \? SURVEY_TEXT\.internalTitle : SURVEY_TEXT\.title\}/);
  assert.match(page, /useCaseModule=\{!isInternalTrack\}/, "il modulo dei casi d'uso per tutti, mai per i referenti");
  for (const gone of ["survey-track-summary", "survey-howto", "includedPillars", "AI Readiness OS", "<Badge", "🔗", "💡", "SurveyThemeToggle", "Gestisci privacy"]) assert.ok(!page.includes(gone), gone);
  const form = code("src/components/ai-readiness/respondent-survey-form.tsx");
  assert.match(form, /<Button type="submit" name="privacyAccepted" value="on" className=\{PUBLIC_PRIMARY\}/, "la presa visione viaggia con l'invio");
  assert.ok(!/<Checkbox\s+name="privacyAccepted"/.test(form), "nessuna casella dell'informativa");
  assert.match(form, /\{F\.acknowledge\}\{" "\}\s*<a href=\{noticeHref\}/);
  assert.match(form, /payload: \{ \.\.\.payload, consents: \{ \.\.\.payload\.consents, privacyAccepted: true \} \}/);
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
