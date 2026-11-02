import test from "node:test";
import assert from "node:assert/strict";
import { NEED_REQUIREMENT_STATUSES, needRequestGroupView } from "../../lib/use-cases/needs.ts";
import { atLeast, COLOR_VALUE, contrast, declarations, over, parseColor, ratio, readRepo, topLevelRules, type Color, type Rgb } from "./test-support/color.ts";

// La scheda guidata di uno use case (rilascio 3) nel tema «Chiaro»: il percorso, «Prossimo passo»,
// «Impatto» con i chip di rischio, «Come cambia il lavoro» con il bordo dell'agente, i cinque gruppi
// di «Cosa serve», le pieghe e la riga «Prossimo passo:» del pannello. Usano solo i token del tema,
// e qui si misura che nel chiaro, dove l'area torna ai token della pagina, i testi restano almeno
// 4,5:1 e i segni, i bordi e il fuoco almeno 3:1, come nel tema scuro (src/components/use-cases/contrast.test.ts).

const css = readRepo("src/app/globals.css");
const rules = topLevelRules(css);
const LIGHT = ':root[data-theme="light"]:has([data-theme-scope])';
const values = (selector: string) => declarations(rules.find((rule) => rule.selector === selector)!.body);
const palette = (decl: Record<string, string>): Record<string, Color> =>
  Object.fromEntries(Object.keys(decl).filter((name) => COLOR_VALUE.test(decl[name])).map((name) => [name.slice(2), parseColor(decl[name])]));
const light: Record<string, Color> = { ...palette(values(":root")), ...palette(values(LIGHT)) };
const tones = Array.from({ length: 10 }, (_, index) => `uc-agente-${index + 1}`);

const surfaces: Array<[string, Rgb]> = [
  ["background", light.background.rgb],
  ["card", light.card.rgb],
];
/** «◆ Decide una persona»: `bg-muted/40` sulla pagina. */
const persona = over(light.muted.rgb, light.background.rgb, 0.4);

const PATH_RING = `${LIGHT} [data-slot="use-case-path"]:not([data-tone="neutro"]) [data-state="adesso"] > [aria-hidden]`;

test("tema chiaro: il percorso della scheda, l'alone del passo «adesso» al 70% con un agente", () => {
  const rule = rules.find((r) => r.selector === PATH_RING);
  assert.ok(rule, "l'alone del percorso nel tema chiaro");
  const mix = /--tw-ring-color:\s*color-mix\(in oklab, var\(--path-c\) (\d+)%, transparent\);/.exec(rule.body);
  assert.ok(mix, "l'alone nel colore del percorso");
  const alpha = Number(mix[1]) / 100;
  // Il componente dice se il percorso ha un agente, e tiene l'alone al 50% per il tema scuro.
  const path = readRepo("src/components/use-cases/detail/use-case-path.tsx");
  assert.ok(path.includes('data-tone={tone ?? "neutro"}'), "data-tone sul percorso");
  assert.ok(path.includes("ring-[color-mix(in_oklab,var(--path-c)_50%,transparent)]"), "l'alone al 50% nel tema scuro");
  assert.ok(path.includes("<span aria-hidden className={cn(\"flex size-6"), "il pallino è lo span aria-hidden del passo");
  for (const name of tones) {
    const tone = light[name].rgb;
    for (const [surfaceName, surface] of surfaces) {
      atLeast(ratio(over(tone, surface, alpha), surface), 3, `alone «adesso» in ${name} su ${surfaceName}`);
      // Al 50% del tema scuro non basterebbe: per questo la regola.
      assert.ok(ratio(over(tone, surface, 0.5), surface) < 3, `${name}: l'alone al 50% basterebbe`);
      atLeast(ratio(tone, surface), 3, `bordo «adesso», pallino «fatto» e linea in ${name} su ${surfaceName}`);
      atLeast(ratio(tone, surface), 3, `«Con l'agente»: il bordo sinistro in ${name} su ${surfaceName}`);
    }
    atLeast(ratio(light.background.rgb, tone), 4.5, `segno di «fatto» sul pallino ${name}`);
  }
  // Senza agente: il colore del testo, al 50% come nel tema scuro.
  for (const [surfaceName, surface] of surfaces) {
    atLeast(ratio(over(light.foreground.rgb, surface, 0.5), surface), 3, `alone «adesso» senza agente su ${surfaceName}`);
    atLeast(contrast(light.input, surface), 3, `pallino e linea «dopo» su ${surfaceName}`);
  }
  atLeast(ratio(light.background.rgb, light.foreground.rgb), 4.5, "segno di «fatto» sul pallino senza agente");
});

test("tema chiaro: i testi grigi e il fuoco della scheda, del riquadro «Prossimo passo» e delle pieghe", () => {
  for (const [surfaceName, surface] of [...surfaces, ["«Decide una persona»", persona] as [string, Rgb]]) {
    atLeast(contrast(light["muted-foreground"], surface), 4.5, `testo grigio su ${surfaceName}`);
    atLeast(contrast(light.foreground, surface), 4.5, `testo su ${surfaceName}`);
    atLeast(contrast(light.ring, surface, 0.5), 3, `fuoco (ring/50) su ${surfaceName}`);
  }
});

test("tema chiaro: i chip di rischio di «Impatto» e del pannello, il bordo dei campi e l'icona gialla", () => {
  for (const [surfaceName, surface] of surfaces) {
    atLeast(contrast(light.input, surface), 3, `bordo del chip su ${surfaceName}`);
    atLeast(contrast(light["uc-giallo"], surface), 3, `icona gialla su ${surfaceName}`);
  }
});

test("tema chiaro: i cinque gruppi di «Cosa serve» (scheda, vista e pannello) si vedono su ogni superficie", () => {
  const groupTones = new Set(NEED_REQUIREMENT_STATUSES.map((status) => needRequestGroupView(status).tone));
  assert.deepEqual([...groupTones].sort(), ["blu", "giallo", "grigio", "lucchetto", "verde"]);
  for (const tone of groupTones) {
    for (const [surfaceName, surface] of surfaces) atLeast(contrast(light[`uc-${tone}`], surface), 3, `pallino o lucchetto uc-${tone} su ${surfaceName}`);
  }
});
