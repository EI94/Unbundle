import test, { before } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { REFERENT_STATES, REFERENT_STATE_TEXT } from "../../lib/use-cases/referent/use-case-state.ts";
import { findHubForbidden } from "../../lib/use-cases/copy-guard.ts";
import { enableTsxImports } from "./detail/referent/tsx-test-loader.ts";

// Lo stato del referente sulle card, nelle righe, nel pannello (rilascio 5, SPEC §10.3): un'icona con il
// tono e la parola in grigio, mai una pillola; niente senza stato.
let chip: typeof import("./referent-chip.tsx");
before(async () => {
  await enableTsxImports();
  chip = await import("./referent-chip.tsx");
});

test("ogni stato: la sua parola, il tono dell'icona, data-state; nessuno stato, niente", () => {
  // (Rilascio 6) «Chiarimento in attesa» aspetta il referente (blu), «Il referente ha chiesto qualcosa» il team (giallo).
  const tones = { manca: "text-uc-grigio", in_attesa: "text-uc-blu", nessuna_risposta: "text-uc-rosso", da_verificare: "text-uc-giallo", chiarimento: "text-uc-blu", ha_chiesto: "text-uc-giallo", fatto: "text-uc-verde" } as const;
  for (const state of REFERENT_STATES) {
    const html = renderToStaticMarkup(createElement(chip.ReferentChip, { state }));
    assert.match(html, new RegExp(`data-slot="referent-chip" data-state="${state}"`));
    assert.ok(html.includes(`>${REFERENT_STATE_TEXT[state]}<`), state);
    assert.ok(html.includes(tones[state]), state);
    assert.match(html, /aria-hidden="true"/, "l'icona non si legge");
    assert.doesNotMatch(html, /rounded-full|\bborder\b|bg-/, "non è una pillola");
    assert.deepEqual(findHubForbidden(REFERENT_STATE_TEXT[state], "area"), []);
  }
  assert.equal(renderToStaticMarkup(createElement(chip.ReferentChip, { state: null })), "");
  assert.deepEqual(Object.values(REFERENT_STATE_TEXT), [
    "Manca il referente",
    "In attesa del referente",
    "Nessuna risposta",
    "Risposte da verificare",
    "Chiarimento in attesa",
    "Il referente ha chiesto qualcosa",
    "Il referente ha risposto",
  ]);
});

test("(rilascio 10, D7) la forma delle card: puntino più parola, il tono del puntino; senza stato niente", () => {
  const fills = { manca: "bg-uc-grigio", in_attesa: "bg-uc-blu", nessuna_risposta: "bg-uc-rosso", da_verificare: "bg-uc-giallo", chiarimento: "bg-uc-blu", ha_chiesto: "bg-uc-giallo", fatto: "bg-uc-verde" } as const;
  for (const state of REFERENT_STATES) {
    const html = renderToStaticMarkup(createElement(chip.ReferentChip, { state, form: "puntino" }));
    assert.match(html, new RegExp(`^<span data-slot="referent-chip" data-state="${state}" data-form="puntino"`));
    assert.match(html, new RegExp(`<span aria-hidden="true" class="size-1\\.5 shrink-0 rounded-full ${fills[state]}"></span><span class="truncate font-medium text-foreground">${REFERENT_STATE_TEXT[state]}</span>`), state);
    assert.ok(!html.includes("<svg"), "niente icona");
  }
  assert.equal(renderToStaticMarkup(createElement(chip.ReferentChip, { state: null, form: "puntino" })), "");
  // Senza `form`: l'icona di sempre, nelle righe, nel pannello e nella scheda.
  assert.ok(renderToStaticMarkup(createElement(chip.ReferentChip, { state: "manca" })).includes("<svg"));
});

test("il modulo dei chip si usa anche sul server (niente «use client») e solo con i token del tema", () => {
  const source = readFileSync(new URL("./referent-chip.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /["']use client["']/);
  assert.doesNotMatch(source, /#[0-9a-f]{3,8}\b|\bdark:|text-(red|green|blue|yellow|gray)-\d/);
});
