import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// (Rilascio 10, §3.4) Il pannello laterale (`?apri=`) è già il modello e resta: cambiano due cose (tag e titolo senza
// prefisso; le stime non ufficiali in una riga grigia), la fonte del costo sta qui (D7) e lo stato del referente si
// legge qui per tutti. Il pannello si apre in un portale, che la resa sul server non disegna: qui il sorgente; la
// pagina vera la provano hub-page.integration.test.ts e il harness delle schermate (use-cases-pannello).
const PANEL = readFileSync(new URL("./use-case-panel.tsx", import.meta.url), "utf8");
const HUB = readFileSync(new URL("./hub.tsx", import.meta.url), "utf8").replace(/\s+/g, " ");

test("tag e titolo senza prefisso: il tag nel colore dell'agente, il prefisso solo per i lettori di schermo", () => {
  assert.match(PANEL, /const agent = titleAgent\(item\.title\);/);
  assert.match(PANEL, /\{agent \? <AgentTag label=\{agent\.label\} tone=\{agentToneOf\(agents, agent\.agent\)\} decorative \/> : null\}/);
  assert.match(PANEL, /<SheetTitle className="text-base leading-snug font-semibold">\s*\{agent \? \(\s*<>\s*<span className="sr-only">\{agent\.prefix\}<\/span>\s*\{agent\.rest\}/);
  // I colori sono quelli del workspace, gli stessi delle card.
  const panel = HUB.slice(HUB.indexOf("<UseCasePanel "), HUB.indexOf("/>", HUB.indexOf("<UseCasePanel ")));
  assert.match(panel, /\bagents=\{agents\}/);
});

test("le stime non ufficiali in una riga grigia, non più un riquadro che attira l'occhio più del passo", () => {
  const block = PANEL.slice(PANEL.indexOf('data-slot="claude-estimate"') - 40, PANEL.indexOf("<RiskChips"));
  assert.match(block, /<p data-slot="claude-estimate" className="text-xs break-words text-muted-foreground">/);
  assert.ok(!block.includes("rounded-lg bg-muted"), "niente riquadro");
  assert.match(block, /\{ESTIMATES_TEXT\.title\}<\/span>\s*\{FIGURE_SEPARATOR\}/);
});

test("lo stato del referente nel pannello per tutti, accanto alla fase; la fonte del costo resta (D7)", () => {
  const reviewer = PANEL.slice(PANEL.indexOf("function ReviewerBody("), PANEL.indexOf("function PanelValueLine("));
  assert.match(reviewer, /<PhasePill label=\{shownPhaseLabel\(item, dossierDown\)\} tone=\{item\.tone\} \/>\s*<ReferentChip state=\{referentState\} \/>/);
  assert.match(PANEL, /<ReviewerBody[\s\S]*?referentState=\{referentState\}[\s\S]*?\/>/);
  const contributor = PANEL.slice(PANEL.indexOf("function ContributorBody("));
  assert.match(contributor, /<ReferentChip state=\{referentState\} \/>/);
  // La fonte del costo («team», «stimato»): nel pannello, non più nelle card e nelle righe.
  assert.match(PANEL, /<SourceTag figure="costo" source=\{cost\.source\} \/>/);
  assert.match(PANEL, /<PanelCostLine cost=\{item\.cost\} bands=\{bands\} \/>/);
});

test("il resto resta: il passo con il «?», «Cosa serve · N», «Quando» e «Apri la scheda»", () => {
  for (const piece of ["<NextStepRow", "<PanelNeedsBlock needs={needs} href={needsHref} />", "<WhenControl", "{PANEL_TEXT.openDetail}", "focusPanelStart("]) assert.ok(PANEL.includes(piece), piece);
});
