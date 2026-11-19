import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Le regole delle schermate di «Contesto nel lavoro» che si leggono nei sorgenti (rilascio 9b,
// RILASCIO-9b-COSTRUZIONE.md §5.2): la scheda legge il contesto solo per i revisori e senza far cadere la pagina; la
// piega apre i fatti in sola lettura.

const ROOT = new URL("../../../", import.meta.url);
const read = (path: string) => readFileSync(new URL(path, ROOT), "utf8");

/** Il sorgente senza i commenti (blocchi e righe; un `//` dopo i due punti è un indirizzo, non un commento). */
function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}
/** I tag di apertura di questi componenti, interi: fino al primo «>» fuori dalle graffe (non quello di «=>»). */
function openingTags(source: string, names: readonly string[]): string[] {
  const out: string[] = [];
  for (const match of source.matchAll(new RegExp(`<(?:${names.join("|")})\\b`, "g"))) {
    let depth = 0;
    let end = match.index + match[0].length;
    for (; end < source.length; end++) {
      const char = source[end];
      if (char === "{") depth++;
      else if (char === "}") depth--;
      else if (char === ">" && depth === 0 && source[end - 1] !== "=") break;
    }
    out.push(source.slice(match.index, end + 1));
  }
  return out;
}

/** Il corpo di una funzione del file, dalla sua firma alla graffa che la chiude in colonna zero. */
function functionBody(source: string, name: string): string {
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `${name} c'è`);
  const end = source.indexOf("\n}\n", start);
  return source.slice(start, end === -1 ? undefined : end + 2);
}

const DASHBOARD = "src/app/(dashboard)/dashboard/[workspaceId]";
const CARD_PAGE = `${DASHBOARD}/use-cases/[useCaseId]/page.tsx`;
const DOSSIER_PAGE = `${DASHBOARD}/casi-duso/[caseId]/progetto/page.tsx`;

test("la scheda legge il contesto solo per i revisori, dentro un try che dà null: senza, la scheda resta", () => {
  const source = withoutComments(read(CARD_PAGE));
  // Chi guarda «Contesto» c'è solo per un revisore (il contributore ha la sua scheda corta).
  assert.match(source, /const reviewer = result\.projection !== "contributore";/);
  assert.match(source, /const contextActor = reviewer \? contextActorFor\(session\.user, access, workspaceId\) : null;/);
  assert.equal((source.match(/\bcontextActorFor\(/g) ?? []).length, 1);
  // Una sola lettura della piega, sotto quella condizione.
  assert.equal((source.match(/\bloadUseCaseContext\(/g) ?? []).length, 1, "una lettura sola");
  assert.equal((source.match(/\bloadContextFold\(/g) ?? []).length, 2, "la funzione e la sua chiamata");
  assert.match(source, /contextActor \? loadContextFold\(contextActor, result\.useCase\.id\) : null,/);
  // La lettura sta in un try/catch che risponde null, come quella delle proposte dei coding agent.
  const fold = functionBody(source, "loadContextFold");
  assert.match(fold, /try \{\s*return await loadUseCaseContext\(actor, useCaseId\);\s*\} catch \(error\) \{[\s\S]*return null;\s*\}/);
  assert.doesNotMatch(fold, /error\.message|String\(error\)/, "nel log solo il nome dell'errore");
  // «Una call risponde»: solo a chi modifica «Cosa serve», e solo con «Cosa serve» letto; anche lei non fa cadere la scheda.
  assert.equal((source.match(/\blistNeedLinks\(/g) ?? []).length, 1);
  assert.match(source, /contextActor && abilities\.canEditNeeds && needLists \? loadNeedLinks\(contextActor, result\.useCase\.id\) : \{\},/);
  assert.match(functionBody(source, "loadNeedLinks"), /try \{\s*return await listNeedLinks\(actor, useCaseId\);\s*\} catch \(error\) \{[\s\S]*return \{\};\s*\}/);
  // La pagina passa i dati alla scheda; la piega e la riga le decide la scheda.
  assert.match(source, /context=\{context\}/);
  assert.match(source, /needLinks=\{needLinks\}/);
});

test("«Chiudi con questo» e «Non risponde»: chi modifica «Cosa serve», poi la strada di sempre, poi il legame", () => {
  const source = withoutComments(read("src/lib/actions/context-work.ts"));
  assert.match(source, /^"use server";/);
  // Il permesso: chi modifica «Cosa serve», con l'area accesa, dalla sessione e dall'accesso appena letti.
  const editor = functionBody(source, "needEditor");
  assert.match(editor, /if \(!access\) return/);
  assert.match(editor, /if \(!isUseCaseHubWorkspace\(workspaceId\)\) return/);
  assert.match(editor, /abilitiesForUseCase\(viewerFromSession\(session\.user, access\.role\)\)\.canEditNeeds/);
  for (const name of ["closeNeedFromCallAction", "dismissNeedLinkAction"]) {
    const body = functionBody(source, name);
    const access = body.indexOf("needEditor(workspaceId, session, await getCollaboratorAccess(session.user.id, workspaceId))");
    assert.ok(access > 0 && access > body.indexOf("await requireSession()"), `${name}: prima la sessione e l'accesso`);
    const write = Math.max(body.indexOf("listNeedLinks("), body.indexOf("dismissNeedLink("));
    assert.ok(body.indexOf("if (!page.ok) return page.result;") < write, `${name}: niente prima del permesso`);
  }
  // «Chiudi con questo»: la riga di questo use case, poi «A posto» con updateNeedAction, e solo se riesce il legame.
  const close = functionBody(source, "closeNeedFromCallAction");
  const order = ["listNeedLinks(page.actor, useCaseId)", 'updateNeedAction(workspaceId, useCaseId, link.needId, needVersion, { status: "validata" })', "if (!closed.ok) return", "markNeedLinkUsed(page.actor, link.id)"].map((piece) => close.indexOf(piece));
  assert.ok(order.every((at) => at > 0), JSON.stringify(order));
  assert.deepEqual([...order].sort((a, b) => a - b), order, "nell'ordine");
  assert.match(close, /message: CONTEXT_TEXT\.needLink\.closed/);
  assert.match(functionBody(source, "dismissNeedLinkAction"), /message: CONTEXT_TEXT\.needLink\.dismissed/);
  // Nessun modello e nessuna tabella di «Contesto» scritta qui.
  assert.doesNotMatch(source, /generateText|generateObject|askContext|readContextSource/);
});

test("la riga di «Cosa serve»: i testi di «Contesto», due pulsanti piccoli e non pieni da 44 px, solo a chi modifica", () => {
  const needs = withoutComments(read("src/components/use-cases/detail/section-needs.tsx"));
  const line = functionBody(needs, "NeedLinkLine");
  assert.match(line, /\{needLinkText\(link\)\}/);
  assert.match(line, /\{T\.close\}/);
  assert.match(line, /\{T\.dismiss\}/);
  assert.match(line, /const T = CONTEXT_TEXT\.needLink;/);
  const buttons = openingTags(line, ["Button"]);
  assert.equal(buttons.length, 2);
  for (const button of buttons) {
    assert.match(button, /variant="(outline|ghost)"/, "mai pieno: il pulsante pieno della pagina è quello del riquadro");
    assert.match(button, /size="sm"/);
    assert.match(button, /\bmin-h-11\b/, "44 px sul telefono");
  }
  assert.doesNotMatch(line, /[àèéìíòóù«»…]/, "nessun testo scritto a mano");
  // La riga c'è solo per chi modifica «Cosa serve»: la scheda passa i legami solo con canEditNeeds, e la lista solo con canEdit.
  assert.match(needs, /needLinks=\{canEdit \? needLinks : null\}/);
  assert.match(needs, /const answeredBy = canEdit \? \(needLinks\?\.\[need\.id\.toLowerCase\(\)\] \?\? null\) : null;/);
  assert.match(withoutComments(read("src/components/use-cases/detail/detail.tsx")), /needLinks=\{abilities\.canEditNeeds \? needLinks : null\}/);
});

test("la piega: chiusa, prima di «Storia», con il pannello del fatto in sola lettura", () => {
  const detail = withoutComments(read("src/components/use-cases/detail/detail.tsx"));
  const fold = detail.indexOf('<Fold id="contesto"');
  assert.ok(fold > 0, "la piega c'è");
  // (Rilascio 10, §3.4) Le pieghe: Valutazione del team · Dettagli · Contesto · Realizzazione · Storia.
  assert.ok(fold > detail.indexOf('<Fold id="dettagli"') && fold < detail.indexOf('<Fold id="realizzazione"') && fold < detail.indexOf('<Fold id="storia"'), "dopo «Dettagli», prima di «Realizzazione» e di «Storia»");
  assert.doesNotMatch(detail.slice(fold, detail.indexOf(">", fold)), /\bopen=/, "chiusa: la apre solo l'arrivo (`?capitolo=contesto`)");
  assert.match(detail, /const contextFold = context && contextFoldShown\(context\) \? context : null;/, "senza niente da mostrare non c'è");
  assert.match(detail, /context: contextFold !== null,/, "l'ancora c'è solo con la piega");

  const view = withoutComments(read("src/components/context/use-case-context.tsx"));
  assert.match(view, /^"use client";/);
  const sheets = [...view.matchAll(/<FactSheet\b[\s\S]*?\/>/g)].map((match) => match[0]);
  assert.equal(sheets.length, 1, "un pannello");
  assert.match(sheets[0], /\bcanEdit=\{false\}/, "in sola lettura: si modifica solo da «Contesto»");
  assert.doesNotMatch(view, /canEdit=\{(?!false\})/, "nessun canEdit diverso da false");
  // Nessun pulsante nella piega: solo il link «Apri il contesto» e i fatti che aprono il pannello.
  assert.doesNotMatch(view, /<Button\b|from "@\/components\/ui\/button"/);
  assert.match(view, /href=\{`\/dashboard\/\$\{workspaceId\}\/contesto`\}/);
  // Senza niente da mostrare (la sezione del dossier) una riga dal modulo dei testi, sopra il link.
  assert.match(view, /\{contextFoldShown\(context\) \? null : <p className="text-sm text-muted-foreground">\{T\.useCase\.empty\}<\/p>\}/);
});

test("il dossier: «Contesto» dopo «Decisioni» e prima di «Pacchetto», con l'ancora della campanella; la riga del pacchetto senza pulsanti nuovi", () => {
  const source = withoutComments(read(DOSSIER_PAGE));
  const at = (needle: string) => {
    const index = source.indexOf(needle);
    assert.ok(index > 0, needle);
    return index;
  };
  // La sezione: `id="contesto"` (l'ancora di «Il contesto è cambiato»), tra «Decisioni» e «Pacchetto», con i testi di «Contesto».
  const section = at('<SettingsSection id="contesto"');
  assert.ok(at('<SettingsSection id="decisioni"') < section && section < at('<SettingsSection id="pacchetto"'));
  assert.match(source, /<SettingsSection id="contesto" icon=\{Building2\} title=\{CONTEXT_TEXT\.useCase\.title\} description=\{CONTEXT_TEXT\.useCase\.dossierDescription\}>/);
  // Con la lettura riuscita la sezione c'è sempre (l'ancora della campanella), anche senza niente: lo dice il contenuto.
  assert.match(source, /\{context \? \(\s*<SettingsSection id="contesto"/, "la sezione con l'ancora, anche vuota");
  assert.doesNotMatch(source, /contextFoldShown/);
  assert.match(source, /<UseCaseContextView workspaceId=\{workspaceId\} today=\{romeToday\(\)\} context=\{context\} \/>/, "lo stesso contenuto della piega");
  // Per chi guarda: la persona di «Contesto» dalla sessione (Lateral Space per l'e-mail verificata), dentro un try.
  assert.match(source, /readContextSection\(contextActorFor\(session\.user, access, workspaceId\), useCase\.useCaseId\)/);
  assert.match(functionBody(source, "readContextSection"), /try \{\s*return await loadUseCaseContext\(actor, useCaseId\);\s*\} catch \(error\) \{[\s\S]*return null;\s*\}/);
  // La riga del pacchetto: solo a chi vede «Pacchetto» e con una versione; le novità sono le righe di CONTESTO.md che
  // cambierebbero, dal file salvato nella versione a quello di adesso con gli stessi nomi coperti (`packageContextDelta`).
  assert.match(source, /builder && view\.latestPackage \? readContextDelta\(executor, target, useCase\.code \?\? "", view\.latestPackage\) : Promise\.resolve\(0\)/);
  const delta = functionBody(source, "readContextDelta");
  assert.match(delta, /const \[context, names\] = await Promise\.all\(\[loadAgentContext\(target\), namesToHide\(executor, target\)\]\);/);
  assert.match(delta, /return packageContextDelta\(\{ context, namesToHide: names, code, latest \}\);/);
  assert.match(delta, /\} catch \(error\) \{[\s\S]*return 0;/);
  assert.match(source, /const deltaLine = packageDeltaLine\(contextDelta\);/);
  const pack = source.slice(section, source.indexOf("</SettingsSection>", at('<SettingsSection id="pacchetto"')));
  assert.match(pack, /\{deltaLine \? <p data-slot="package-context-delta">\{deltaLine\}<\/p> : null\}/);
  assert.ok(pack.indexOf("{deltaLine ?") > pack.indexOf("Versione {view.latestPackage.version}"), "sotto la riga della versione");
  // Nessun pulsante nuovo: l'azione resta «Aggiorna il pacchetto».
  assert.equal((pack.match(/<Button\b/g) ?? []).length, 0);
  assert.equal((pack.match(/<PackageButton\b/g) ?? []).length, 1);
  // La descrizione nuova e «Leggi i file» dai file della versione (con CONTESTO.md quando c'è), non da un elenco scritto a mano.
  assert.match(source, /description="I file che il repository del caso legge e non cambia: senza nomi di persona\."/);
  assert.doesNotMatch(source, /I tre file/);
  assert.match(pack, /\{packageFilesShown\(view\.latestPackage\.files\)\.map\(\(\{ name, text \}\) => \(/);
  assert.doesNotMatch(source, /\["BRIEF\.md", "PACCHETTO\.md", "VERSIONE"\]/);
});

const VERIFY_PAGE = `${DASHBOARD}/contesto/verifica/page.tsx`;

test("«Da verificare»: notFound() per chi non è di Lateral Space, prima di leggere i fatti; 60 secondi per «In breve» dopo «Non più vero»", () => {
  const source = withoutComments(read(VERIFY_PAGE));
  assert.match(source, /await requireWorkspacePage\(workspaceId\)/);
  assert.match(source, /const actor = contextActorFor\(session\.user, access, workspaceId\);/);
  const gate = source.indexOf("if (!contextAbilities(actor).canEditMemory) notFound();");
  assert.ok(gate > 0, "il controllo c'è");
  assert.ok(gate < source.indexOf("contextStoreReady()") && gate < source.indexOf("listFactsToCheck("), "prima di tutto il resto");
  assert.match(source, /const facts = await listFactsToCheck\(actor\);\s*if \(!facts\) notFound\(\);/, "e se la lettura dice che non è per chi guarda");
  assert.match(source, /export const metadata = \{ title: CONTEXT_TEXT\.verify\.title \};/);
  assert.match(source, /export const maxDuration = 60;/, "«Non più vero» riscrive «In breve» con after()");
  assert.doesNotMatch(source, /generateText|generateObject|askContext/, "nessun modello");
});

test("«Da verificare»: un solo pulsante pieno, fisso in fondo con il margine dell'area sicura; caselle mai spuntate all'inizio, da 44 px", () => {
  const view = withoutComments(read("src/components/context/verify-view.tsx"));
  assert.match(view, /^"use client";/);
  const buttons = openingTags(view, ["Button"]);
  const filled = buttons.filter((tag) => !/\bvariant="/.test(tag));
  assert.equal(filled.length, 1, "un solo pulsante pieno");
  assert.match(filled[0], /size="lg"/);
  assert.match(view, /\{verifyButtonLabel\(shown, chosen\)\}/, "«Ancora veri (n)»");
  for (const tag of buttons.filter((t) => t !== filled[0])) assert.match(tag, /variant="(outline|ghost|destructive)"/);
  // Fisso in fondo, con il margine dell'area sicura del telefono.
  assert.match(view, /<div className="sticky bottom-0 [^"]*pb-\[max\(0\.75rem,env\(safe-area-inset-bottom\)\)\][^"]*">\s*<Button type="button" size="lg"/);
  // Nessuna casella spuntata all'inizio; ogni casella in un'area di 44 px sul telefono.
  assert.match(view, /useState<ReadonlySet<string>>\(initialVerifyChoice\)/);
  assert.match(view, /<Checkbox checked=\{chosen\.has\(fact\.id\)\}/);
  assert.equal((view.match(/<Checkbox\b/g) ?? []).length, 1);
  assert.match(view, /<label className="flex min-h-11 [^"]*">\s*<span className="[^"]*\bmin-h-11\b[^"]*\bmin-w-11\b[^"]*">\s*<Checkbox/);
  // «Ancora veri (n)» a gruppi di al massimo 75, «Non più vero» con la conferma.
  assert.match(view, /for \(const chunk of chunkItems\(selected\)\) \{\s*const result = await reconfirmFactsAction\(workspaceId, chunk\);/);
  assert.match(view, /retireFactAction\(workspaceId, fact\.id, fact\.version\)/);
  assert.match(view, /\{T\.fact\.retireConfirm\}/);
});

test("la Memoria: la riga «n fatti da verificare» porta a /contesto/verifica, solo per Lateral Space", () => {
  const memory = withoutComments(read("src/components/context/memory-view.tsx"));
  assert.match(memory, /const toCheck = toCheckRow\(memory\.counts\.toCheck, lateralSpace\);/);
  assert.match(memory, /\{toCheck \? <ServiceLink label=\{toCheck\} href=\{`\/dashboard\/\$\{workspaceId\}\/contesto\/verifica`\} \/> : null\}/);
  // Dentro le righe di servizio, che ci sono solo per Lateral Space.
  const rows = memory.slice(memory.indexOf("{lateralSpace ? ("), memory.indexOf("</ServiceRows>"));
  assert.ok(rows.includes("contesto/verifica"), "dentro il blocco di Lateral Space");
});

test("sul telefono e nel tema «Chiaro»: ogni cosa che si tocca è alta 44 px; solo i token del tema, niente colori fissi né `dark:`", () => {
  const screens = ["src/components/context/use-case-context.tsx", "src/components/context/verify-view.tsx", "src/components/context/memory-view.tsx", VERIFY_PAGE];
  for (const file of screens) {
    const source = withoutComments(read(file));
    // Ogni pulsante, link e casella sta in un'area da 44 px sul telefono (`min-h-11`, o la riga intera).
    const tags = openingTags(source, ["button", "Button", "Link"]);
    if (!file.endsWith("page.tsx")) assert.ok(tags.length > 0, `${file}: i controlli ci sono`);
    for (const tag of tags) assert.match(tag, /\bmin-h-11\b|\bsize-11\b/, `${file}: ${tag.replace(/\s+/g, " ").slice(0, 100)}`);
    // I colori dai token: valgono nel tema scuro e in «Chiaro».
    assert.doesNotMatch(source, /(?<![\w-])(?:dark|light):/, `${file}: una variante dark: o light:`);
    assert.doesNotMatch(source, /\b(?:text|bg|border|ring|fill|stroke)-(?:slate|gray|zinc|neutral|stone|red|orange|amber|yellow|lime|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|white|black)\b/, `${file}: un colore fisso`);
    assert.doesNotMatch(source, /#[0-9a-fA-F]{3,8}\b|\b(?:rgb|hsl|oklch)a?\(/, `${file}: un colore scritto a mano`);
  }
  // La riga di «Cosa serve»: gli stessi due controlli.
  const line = functionBody(withoutComments(read("src/components/use-cases/detail/section-needs.tsx")), "NeedLinkLine");
  for (const tag of openingTags(line, ["Button"])) assert.match(tag, /\bmin-h-11\b/);
  assert.doesNotMatch(line, /(?<![\w-])dark:|#[0-9a-fA-F]{3,8}\b/);
  // «Da verificare» sul telefono: «Non più vero» sotto la frase, allineato a lei; il pulsante pieno in fondo, largo.
  const verify = withoutComments(read("src/components/context/verify-view.tsx"));
  assert.match(verify, /className="ml-14 min-h-11 shrink-0 self-start sm:ml-0 sm:min-h-8"/);
  assert.match(verify, /<Button type="button" size="lg" className="min-h-11 w-full sm:w-auto sm:px-6"/);
});

test("nessun testo in italiano scritto a mano nelle schermate nuove: le parole vengono da CONTEXT_TEXT", () => {
  const ITALIAN = /[àèéìíòóùÀÈÉÌÒÙ«»…]/;
  const files = ["src/components/context/use-case-context.tsx", "src/components/context/verify-view.tsx", VERIFY_PAGE, "src/lib/actions/context-work.ts"];
  const found: string[] = [];
  for (const file of files) {
    withoutComments(read(file))
      .split("\n")
      .forEach((line, index) => {
        if (ITALIAN.test(line)) found.push(`${file}:${index + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(found, []);
  for (const file of files) assert.match(read(file), /CONTEXT_TEXT/, `${file}: i testi da CONTEXT_TEXT`);
  // Nella scheda la piega prende titolo e riga dalle regole e dai testi, mai scritti lì.
  const detail = withoutComments(read("src/components/use-cases/detail/detail.tsx"));
  const fold = detail.slice(detail.indexOf('<Fold id="contesto"'), detail.indexOf("</Fold>", detail.indexOf('<Fold id="contesto"')));
  assert.match(fold, /title=\{t\.contesto\} summary=\{summaries\.contesto\}/);
  assert.doesNotMatch(fold, ITALIAN);
});
