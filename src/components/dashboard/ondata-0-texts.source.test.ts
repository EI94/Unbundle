import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CURRENCY_PER_SUGGESTIONS, normalizeValuta } from "../../lib/uc/answers/currency.ts";
import { answerContext } from "../../lib/uc/answers/normalize.ts";
import { PRIVACY_LABEL } from "../../lib/uc/views/labels.ts";

// (Ondata 0, docs/ui-10/PROPOSTA-10.md §6.2) I testi sbagliati o di prova, corretti uno per uno: un controllo sul
// sorgente per ognuno, dove una resa costerebbe più del testo stesso.

const read = (path: string) => readFileSync(new URL(`../../../${path}`, import.meta.url), "utf8");

test("0.5 · «Privacy», not «Privacy Policy»: the page, its link from the login, the files for the LLMs", () => {
  const page = read("src/app/legal/privacy/page.tsx");
  assert.match(page, /title: "Privacy",/);
  assert.match(page, /title: "Privacy — Unbundle",/);
  assert.match(page, /\{ name: "Privacy", url: "\/legal\/privacy" \}/);
  assert.match(page, /<h1 className="text-2xl font-semibold tracking-tight">Privacy<\/h1>/);
  for (const file of ["src/app/legal/privacy/page.tsx", "src/app/(auth)/login/page.tsx", "src/app/llms.txt/route.ts", "src/app/llms-full.txt/route.ts"]) {
    assert.doesNotMatch(read(file), /Privacy Policy/, file);
  }
  assert.match(read("src/app/(auth)/login/page.tsx"), /href="\/legal\/privacy" className="underline hover:text-foreground">\s*Privacy\s*<\/a>/);
});

test("0.6 · no words of one industry: «Personale operativo», «a pezzo», no flights or nights in the suggestions", () => {
  assert.equal(PRIVACY_LABEL.personale_equipaggio, "Personale operativo");
  assert.deepEqual(
    CURRENCY_PER_SUGGESTIONS.filter((s) => ["volo", "notte", "tratta"].includes(s)),
    [],
  );
  assert.ok(CURRENCY_PER_SUGGESTIONS.includes("pezzo"));
  const missing = normalizeValuta("1.000 € IVA esclusa", {}, answerContext(new Date("2026-11-18T10:00:00Z"), true));
  const per = missing.errors.find((e) => e.code === "per_mancante");
  assert.equal(per?.message, "Indica a cosa si riferisce l'importo: a pezzo, a ora, a persona…");
  assert.ok(read("src/components/uc/catalog/item-actions.tsx").includes("es. 1.200 € IVA esclusa a pezzo"));
  assert.ok(read("src/components/uc/referente/inputs/currency-input.tsx").includes(`hint="Per esempio a pezzo, a ora, a persona, all'anno."`));
  for (const file of ["src/components/uc/catalog/item-actions.tsx", "src/components/uc/referente/inputs/currency-input.tsx", "src/lib/uc/answers/currency.ts"]) {
    assert.doesNotMatch(read(file), /IVA esclusa a volo|a volo, a ora|a notte, a persona/, file);
  }
});

test("0.7 · the Agent Factory page never says «fabbrica»; the queue is «Repository da aggiornare»", () => {
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/agent-factory/page.tsx");
  assert.doesNotMatch(page, /fabbrica/i);
  assert.match(page, /title="Repository da aggiornare"/);
  assert.ok(page.includes("un caso entra nell&apos;Agent Factory con «Avvia la realizzazione»"));
});

test("0.8 · a Slack error is a sentence, never its key", async () => {
  const page = read("src/app/(dashboard)/dashboard/page.tsx");
  assert.doesNotMatch(page, /`Slack: \$\{/);
  // (Rilascio 10) Le frasi stanno nel modulo dei testi della cornice; la pagina le chiede per chiave.
  assert.match(page, /const slackErrMsg = slackErrorMessage\(sp\.slack_error\);/);
  const { slackErrorMessage } = await import("../../lib/shell/workspaces.ts");
  assert.equal(slackErrorMessage("invalid_state"), "Non siamo riusciti a collegare Slack. Riprova da Impostazioni.");
  assert.equal(slackErrorMessage("forbidden"), "Non hai permesso di installare Slack per quel workspace.");
  assert.equal(slackErrorMessage(""), "");
  assert.equal(slackErrorMessage(undefined), "");
  assert.doesNotMatch(slackErrorMessage("toString"), /toString/, "nessuna chiave, nemmeno di Object");
});

test("0.10 · the course link says what is true: kept N days after the course closes; the real name of the button", () => {
  const page = read("src/app/c/[token]/page.tsx");
  assert.doesNotMatch(page, /poi vengono\s+eliminate/);
  assert.match(page, /\{preview\.retentionDays === 1 \? "giorno" : "giorni"\} dopo la\s+chiusura del corso\./);
  const form = read("src/components/learning/join-course-form.tsx");
  assert.doesNotMatch(form, /«Crea un account»/);
  assert.match(form, /"auth\/user-not-found": "Nessun account con questa email: tocca «Non ho un account: creane uno»\."/);
  assert.match(form, /: "Non ho un account: creane uno"\}/, "the button has that name");
});

test("0.11 · «1 risposta», not «1 risposte»", () => {
  assert.match(read("src/components/learning/results-group.tsx"), /\{item\.answered\} \{item\.answered === 1 \? "risposta" : "risposte"\}/);
});

test("0.12 · deleting a workspace names what goes today, and what stays", () => {
  const form = read("src/components/dashboard/delete-workspace-form.tsx");
  const text = form.replace(/\s+/g, " ");
  assert.ok(text.includes("Elimina per sempre il workspace e tutto quello che contiene: use case, realizzazioni, Agent Factory, Contesto, Programma e documenti. I repository su GitHub restano dove sono."));
  assert.doesNotMatch(text, /discovery|classifiche|simulazioni/);
});

test("0.13 · the WhatsApp webhook button is an action, «Salva», shown only after a change", () => {
  const form = read("src/components/portfolio/team-settings-form.tsx");
  assert.doesNotMatch(form, /Webhook salvato|Salva webhook/);
  assert.match(form, /\{isDirty \|\| pending \? \(\s*<Button type="submit" variant="outline" className="w-full" disabled=\{pending\}>\s*\{pending \? "Salvo…" : "Salva"\}/);
});

test("0.14 · the overview step has no participle to agree with the client's word for its units", () => {
  const page = read("src/app/(dashboard)/dashboard/[workspaceId]/page.tsx");
  assert.doesNotMatch(page, /\$\{term\.plural\} mappate/);
  assert.ok(page.includes("`Mappatura: ${mappedDepts.length} su ${departments.length} ${term.plural}`"));
});
