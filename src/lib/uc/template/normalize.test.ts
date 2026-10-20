import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  normalizeAvailability,
  normalizeCardinality,
  normalizePerimeter,
  normalizePrivacy,
  normalizeTemplate,
  parseEstimatedMinutes,
  resolveRolePhrase,
  rolePhraseHead,
  type NormalizeReport,
} from "./normalize.ts";
import { validateTemplate } from "./schema.ts";

type Obj = Record<string, unknown>;

// Raw template in the old, Italian-keyed shape. Invented content: no client data.
function rawTemplate(): Obj {
  return {
    schema: "unbundle.uc-template/1",
    key: "prova.normalizza",
    version: "1.0.0",
    status: "pubblicato",
    language: "it",
    name: "Prova · Normalizzazione",
    archetype: "decisione_assistita",
    description: "Template grezzo inventato per provare il normalizzatore.",
    note_interne: "campo sconosciuto alla radice",
    vocabularies: {
      priority: ["must", "should", "could"],
      serves_for: ["baseline", "modello", "backtest", "monitoraggio", "roi"],
      privacy_class: ["nessuna", "riservato_azienda", "personale", "personale_equipaggio", "escluso_sanitario"],
      availability: ["oggi_export", "con_api_crm", "dopo_a8", "fuori_foundation"],
      perimeter: { in: "caso_base", out: "evoluzione" },
      levers: ["tempo", "output", "qualita", "nuove_capacita", "decisioni", "costi", "ricavi", "rischio"],
    },
    roles: [
      { key: "resp_servizio", label: "Responsabile del servizio (turni)" },
      { key: "controllo_gestione", label: "Controllo di gestione" },
      { key: "referente_sistemi", label: "Referente dei sistemi" },
    ],
    sections: [
      { key: "kpi", title: "KPI" },
      { key: "modello_dati", title: "Modello dati" },
      { key: "regole", title: "Regole" },
      { key: "documenti_dataset", title: "Documenti e dataset" },
    ],
    blockers: [
      { key: "a8", label: "Scheda privacy approvata", blocks_privacy_class: ["personale", "personale_equipaggio"], blocks_real_data: true },
      { key: "decisione_board", label: "Decisione del comitato", blocks_perimeter: ["evoluzione"] },
      { key: "accesso_sistema", label: "Accesso al sistema", blocks_availability: ["con_api_crm"], fallback_ammesso: "export CSV autorizzato" },
      { key: "sanitario", label: "Dati sanitari: mai", permanent: true, blocks_privacy_class: ["escluso_sanitario"] },
    ],
    gates: [{ key: "G1", label: "Pronto per lo sviluppo", phase: "modello", rule: "voci must verdi", approvers: ["ls_lead", "owner_cliente"] }],
    map: {
      kind: "soluzione",
      nodes: [
        { id: "blk.01", label: "Arrivo", descrizione: "Legge ent.richiesta e la richiesta.", input: ["Email"], output: ["richiesta.canale"] },
        { id: "blk.02", label: "Vincoli", descrizione: "Applica hc.* e controlla richiesta.inesistente", input: [], output: [] },
        { id: "blk.03", label: "Vuoto", descrizione: "Nessuna voce citata.", input: [], output: [] },
      ],
      edges: [
        ["blk.01", "blk.02", "dati"],
        ["blk.02", "blk.03"],
      ],
    },
    items: [
      {
        key: "ent.richiesta",
        kind: "entita",
        section: "modello_dati",
        title: "Richiesta",
        spiegazione: "Una richiesta di assistenza.",
        perche: "È l'unità di lavoro.",
        esempio: "Una richiesta via email.",
        priority: "must",
        privacy_class: "riservato_azienda",
        availability: "oggi_export",
        perimeter: "caso_base",
        serves_for: ["modello"],
        dominio: "servizio",
        spec: { chiave: "id", granularita: "richiesta" },
        links: [],
      },
      { key: "ent.cliente", kind: "entita", section: "modello_dati", title: "Cliente", priority: "should", links: [] },
      {
        key: "richiesta.canale",
        kind: "campo",
        section: "modello_dati",
        parent: "ent.richiesta",
        title: "Canale",
        priority: "must",
        privacy_class: "nessuna",
        availability: "oggi_export (export giornaliero)",
        perimeter: "caso_base — solo canali attivi",
        qualita: "sempre presente",
        response: { type: "scelta", unit: "email | telefono | Non lo so" },
        spec: { tipo_dato: "testo", unita: null, obbligatorio: true },
        links: [],
      },
      {
        key: "richiesta.cliente_id",
        kind: "campo",
        section: "modello_dati",
        parent: "ent.richiesta",
        title: "Cliente della richiesta",
        privacy_class: "riservato_azienda",
        response: { type: "riferimento", unit: "ent.cliente" },
        links: [],
      },
      {
        key: "richiesta.operatore_id",
        kind: "campo",
        section: "modello_dati",
        parent: "ent.richiesta",
        title: "Operatore",
        privacy_class: "personale, riservato_azienda",
        response: { type: "riferimento", unit: "ent.operatore (proposta)" },
        links: [],
      },
      {
        key: "kpi.servizio.tempo",
        kind: "kpi",
        section: "kpi",
        title: "Tempo di prima risposta",
        unit: "minuti",
        formula: "media dei minuti",
        priority: "must",
        privacy_class: "riservato_azienda",
        default_owner_role: "Controllo di gestione con il team",
        levers: ["tempo"],
        links: [
          { rel: "usa", to: "richiesta.canale", cardinalita: "molti a uno" },
          { rel: "usa", to: "richiesta.canale" },
          { rel: "usa", to: "kpi.servizio.tempo" },
        ],
      },
      {
        key: "rule.servizio.urgenti",
        kind: "regola",
        section: "regole",
        title: "Le urgenti prima",
        tipo_regola: "priorita",
        forma_logica: "SE attesa > soglia ALLORA urgente",
        parametri: ["par.soglia", "par.mai_creato"],
        stato_validazione: "da confermare",
        default_owner_role: "Responsabile del servizio, ogni lunedì",
        response: { type: "conferma regola", domanda: "Confermi la regola?" },
        links: [],
      },
      { key: "par.soglia", kind: "parametro", section: "modello_dati", title: "Soglia di urgenza", unit: "minuti", privacy_class: "nessuna", links: [] },
      { key: "f.tempo_medio", kind: "formula", section: "modello_dati", title: "Tempo medio", privacy_class: "nessuna", response: { type: "conferma formula" }, links: [] },
      { key: "hc.orario", kind: "vincolo_rigido", section: "modello_dati", title: "Orario di servizio", privacy_class: "nessuna", perimeter: "evoluzione", links: [] },
      { key: "hc.ferie", kind: "vincolo_rigido", section: "modello_dati", title: "Ferie", privacy_class: "nessuna", links: [] },
      {
        key: "src.crm.richieste",
        kind: "fonte",
        section: "documenti_dataset",
        title: "Export delle richieste",
        privacy_class: "riservato_azienda",
        availability: "con_api_crm",
        response: { type: "file", periodo: "ultimi 12 mesi", formato: "CSV", metodo: "export manuale" },
        sources: ["E1"],
        links: [{ rel: "alimentato_da", to: "ent.richiesta", cardinalita: "1:N" }],
      },
      {
        key: "src.crm.turni",
        kind: "fonte",
        section: "documenti_dataset",
        title: "Turni",
        privacy_class: "personale_equipaggio + escluso_sanitario (idoneità)",
        response: { type: "file" },
        links: [],
      },
      {
        key: "dq.canale",
        kind: "controllo_qualita",
        section: "modello_dati",
        title: "Canale valido",
        controllo: "canale nella lista",
        azione: "segnala",
        gravita: "errore",
        privacy_class: "nessuna",
        links: [{ rel: "controlla", to: "richiesta.canale", cardinalita: "1 controllo → N righe" }],
      },
      {
        key: "q.servizio.01",
        kind: "domanda",
        section: "modello_dati",
        title: "Come escludete i dati sanitari dai turni?",
        priority: "must",
        privacy_class: "escluso_sanitario",
        modulo: "m.servizio.1",
        default_owner_role: "Persona X del servizio",
        response: { type: "scelta", options: ["sì", "no", "Non lo so"] },
        riferimenti_non_collegati: ["par.vecchio"],
        links: [{ rel: "precisa", to: "richiesta.canale" }],
      },
      {
        key: "q.servizio.02",
        kind: "domanda",
        section: "modello_dati",
        title: "Quante richieste al giorno?",
        priority: "should",
        privacy_class: null,
        modulo: "m.servizio.1",
        response: { type: "numero", unit: "richieste al giorno", options: [] },
        links: [{ rel: "precisa", to: "kpi.servizio.tempo" }],
      },
      {
        key: "q.sistemi.01",
        kind: "domanda",
        section: "documenti_dataset",
        title: "Il CRM ha un export?",
        priority: "must",
        privacy_class: "nessuna",
        modulo: "mod.sistemi.export",
        response: { type: "si_no" },
        links: [{ rel: "precisa", to: "src.crm.richieste" }],
      },
    ],
    request_modules: [
      {
        key: "m.servizio.1",
        title: "Servizio",
        role: "Persona X (servizio)",
        perche: "Per capire il servizio.",
        istruzioni: "Rispondete a stima.",
        tempo_stimato: "1 ora e 30 minuti",
        items: ["q.servizio.01", "q.servizio.02"],
      },
      { key: "mod.sistemi.export", title: "Sistemi", tempo_stimato: "20 minuti (più l'export)", items: ["q.sistemi.01"] },
      { key: "mod.sistemi.vuoto", title: "Vuoto", items: "[]" },
    ],
    roi: { spiegazione: "Stima inventata." },
    glossary: [{ termine: "Urgente", spiegazione: "Oltre la soglia.", esempio: "Attesa di 50 minuti." }],
  };
}

const ALIASES = { servizio: "resp_servizio", sistemi: "referente_sistemi" };

function normalized(): { template: Obj; report: NormalizeReport } {
  const r = normalizeTemplate(rawTemplate(), { roleAliases: ALIASES });
  assert.ok(r.ok, "normalization failed");
  return r;
}

const itemOf = (t: Obj, key: string): Obj => {
  const found = (t.items as Obj[]).find((i) => i.key === key);
  assert.ok(found, key);
  return found;
};

test("the normalized raw template passes the strict canonical validation", () => {
  const { template } = normalized();
  const v = validateTemplate(template);
  assert.equal(v.ok, true, JSON.stringify(v.ok ? [] : v.errors.slice(0, 5)));
  assert.equal(validateTemplate(rawTemplate()).ok, false, "the raw file itself is refused");
});

test("privacy: most restrictive token, default, health rule question, health with personal class", () => {
  const { template, report } = normalized();
  assert.equal(itemOf(template, "ent.cliente").privacy_class, "riservato_azienda");
  const op = itemOf(template, "richiesta.operatore_id");
  assert.equal(op.privacy_class, "personale");
  assert.deepEqual(op.notes, { privacy: "personale, riservato_azienda" });

  const q = itemOf(template, "q.servizio.01");
  assert.equal(q.privacy_class, "riservato_azienda");
  assert.equal((q.spec as Obj).health_rule_question, true);
  assert.equal((q.notes as Obj).privacy, "escluso_sanitario");

  const shifts = itemOf(template, "src.crm.turni");
  assert.equal(shifts.privacy_class, "personale_equipaggio");
  assert.deepEqual((shifts.spec as Obj).forbidden_columns, ["sanitari"]);

  assert.deepEqual(report.lists.health_rule_questions, ["q.servizio.01"]);
  assert.deepEqual(report.lists.health_with_personal, ["src.crm.turni"]);
  assert.equal(report.counts.privacy_null_default, 3);
  assert.equal(report.privacy_classes.escluso_sanitario, 0);
});

test("availability, perimeter and renamed text fields", () => {
  const { template, report } = normalized();
  const canale = itemOf(template, "richiesta.canale");
  assert.deepEqual(canale.availability, ["oggi_export"]);
  assert.equal(canale.perimeter, "in_contratto");
  assert.deepEqual(canale.notes, { availability: "oggi_export (export giornaliero)", perimeter: "caso_base — solo canali attivi" });
  assert.equal(itemOf(template, "hc.orario").perimeter, "evoluzione");
  assert.deepEqual(itemOf(template, "hc.ferie").availability, []);
  const ent = itemOf(template, "ent.richiesta");
  assert.equal(ent.explanation, "Una richiesta di assistenza.");
  assert.equal(ent.why, "È l'unità di lavoro.");
  assert.equal(ent.example, "Una richiesta via email.");
  assert.equal(ent.spiegazione, undefined);
  assert.deepEqual(ent.spec, { chiave: "id", granularita: "richiesta", dominio: "servizio" });
  assert.equal(report.counts.perimeter_free_text, 1);
  assert.equal(report.counts.availability_null, 14);
});

test("responses: renamed types, references to entities, options from units, «Non lo so» removed", () => {
  const { template, report } = normalized();
  assert.deepEqual(itemOf(template, "rule.servizio.urgenti").response, { type: "conferma_regola", config: { domanda: "Confermi la regola?" } });
  assert.deepEqual(itemOf(template, "f.tempo_medio").response, { type: "conferma_formula", config: {} });
  assert.deepEqual(itemOf(template, "richiesta.cliente_id").response, { type: "codice", config: { ref_entity: "ent.cliente" } });
  const op = itemOf(template, "richiesta.operatore_id");
  assert.deepEqual(op.response, { type: "codice", config: { ref_label: "ent.operatore (proposta)" } });
  assert.deepEqual(op.unresolved_refs, ["ent.operatore"]);
  assert.deepEqual(itemOf(template, "richiesta.canale").response, { type: "scelta", config: { options: ["email", "telefono"] } });
  assert.deepEqual(itemOf(template, "q.servizio.01").response, { type: "scelta", config: { options: ["sì", "no"] } });
  assert.deepEqual(itemOf(template, "q.servizio.02").response, { type: "numero", config: { unit: "richieste al giorno" } });
  const src = itemOf(template, "src.crm.richieste");
  assert.deepEqual(src.response, { type: "file", config: {} });
  assert.deepEqual(src.spec, { periodo: "ultimi 12 mesi", formato: "CSV", metodo: "export manuale" });
  assert.deepEqual(src.sources, ["E1"]);
  assert.equal(report.counts.response_conferma_regola, 1);
  assert.equal(report.counts.response_conferma_formula, 1);
  assert.equal(report.counts.response_riferimento_codice, 2);
  assert.equal(report.counts.response_ref_entity_mentioned, 2);
  assert.equal(report.counts.response_ref_entity_resolved, 1);
  assert.equal(report.counts.campo_unit_options, 1);
  assert.equal(report.counts.options_non_lo_so_removed, 2);
  assert.deepEqual(report.lists.unresolved_ref_entities, ["richiesta.operatore_id"]);
});

test("links: self links and duplicates removed, source→entity flipped, rule parameters materialised", () => {
  const { template, report } = normalized();
  assert.deepEqual(itemOf(template, "kpi.servizio.tempo").links, [{ rel: "usa", to: "richiesta.canale", cardinality: "N:1" }]);
  assert.deepEqual(itemOf(template, "src.crm.richieste").links, []);
  assert.deepEqual(itemOf(template, "ent.richiesta").links, [{ rel: "alimentato_da", to: "src.crm.richieste", cardinality: "N:1" }]);
  const rule = itemOf(template, "rule.servizio.urgenti");
  assert.deepEqual(rule.links, [{ rel: "usa", to: "par.soglia" }]);
  assert.deepEqual(rule.unresolved_refs, ["par.mai_creato"]);
  assert.deepEqual((rule.spec as Obj).parametri, ["par.soglia", "par.mai_creato"]);
  assert.deepEqual(itemOf(template, "dq.canale").links, [{ rel: "controlla", to: "richiesta.canale", note: "1 controllo → N righe" }]);
  assert.deepEqual(itemOf(template, "q.servizio.01").unresolved_refs, ["par.vecchio"]);
  assert.equal(report.counts.links_input, 8);
  assert.equal(report.counts.links_self_removed, 1);
  assert.equal(report.counts.links_duplicate_removed, 1);
  assert.equal(report.counts.links_flipped_source_entity, 1);
  assert.equal(report.counts.links_from_rule_params, 1);
  assert.equal(report.counts.rule_params_unresolved, 1);
  assert.equal(report.counts.links_cardinality_input, 3);
  assert.equal(report.counts.links_total, 8 - 1 - 1 + 1);
  assert.deepEqual(report.lists.unresolved_rule_params, ["par.mai_creato"]);
});

test("owners: questions by area, other items by generic role phrases, free-text roles dropped", () => {
  const { template, report } = normalized();
  assert.equal(itemOf(template, "q.servizio.01").owner_role_key, "resp_servizio");
  assert.equal(itemOf(template, "q.sistemi.01").owner_role_key, "referente_sistemi");
  assert.equal(itemOf(template, "kpi.servizio.tempo").owner_role_key, "controllo_gestione");
  assert.equal(itemOf(template, "rule.servizio.urgenti").owner_role_key, "resp_servizio");
  for (const item of template.items as Obj[]) assert.equal(item.default_owner_role, undefined);
  assert.equal(report.counts.question_owner_role, 3);
  assert.equal(report.counts.owner_phrase_resolved, 2);
  assert.equal(report.counts.default_owner_role_dropped, 3);
});

test("request modules: role keys, time estimates, items from a string", () => {
  const { template, report } = normalized();
  const [servizio, sistemi, vuoto] = template.request_modules as Obj[];
  assert.deepEqual(servizio, {
    key: "m.servizio.1",
    title: "Servizio",
    role_key: "resp_servizio",
    why: "Per capire il servizio.",
    instructions: "Rispondete a stima.",
    estimated_minutes: 90,
    estimated_label: "1 ora e 30 minuti",
    items: ["q.servizio.01", "q.servizio.02"],
  });
  assert.equal(sistemi.role_key, "referente_sistemi");
  assert.equal(sistemi.estimated_minutes, 20);
  assert.deepEqual(vuoto.items, []);
  assert.equal(report.counts.module_items_from_string, 1);
  assert.equal(report.counts.module_role_dropped, 1);
  assert.deepEqual(report.lists.empty_modules, ["mod.sistemi.vuoto"]);
  assert.equal(itemOf(template, "q.servizio.01").request_module, "m.servizio.1");
});

test("map, blockers, gate policy, glossary and root fields", () => {
  const { template, report } = normalized();
  const map = template.map as { nodes: Obj[]; edges: Obj[] };
  assert.deepEqual(map.edges, [
    { from: "blk.01", to: "blk.02", label: "dati" },
    { from: "blk.02", to: "blk.03" },
  ]);
  assert.deepEqual(map.nodes[0].items, ["ent.richiesta", "richiesta.canale"]);
  assert.equal(map.nodes[0].description, "Legge ent.richiesta e la richiesta.");
  assert.deepEqual(map.nodes[1].items, ["hc.orario", "hc.ferie"]);
  assert.deepEqual(map.nodes[2].items, []);
  assert.deepEqual(report.lists.map_nodes_without_items, ["blk.03"]);
  assert.equal(report.counts.map_edges_converted, 2);
  assert.equal(report.counts.map_wildcards_expanded, 1);
  assert.equal(report.counts.map_mentions_unresolved, 1);

  const blockers = Object.fromEntries((template.blockers as Obj[]).map((b) => [b.key, b]));
  assert.deepEqual(blockers.a8, {
    key: "a8",
    label: "Scheda privacy approvata",
    scope: { privacy_classes: ["escluso_sanitario", "personale_equipaggio", "personale"], availability: ["dopo_a8"], real_data: true },
  });
  assert.deepEqual(blockers.decisione_board.scope, { perimeters: ["evoluzione"] });
  assert.deepEqual(blockers.accesso_sistema, {
    key: "accesso_sistema",
    label: "Accesso al sistema",
    scope: { availability: ["con_api_crm"] },
    fallback_allowed: "export CSV autorizzato",
  });
  assert.deepEqual(blockers.sanitario, { key: "sanitario", label: "Dati sanitari: mai", scope: { privacy_classes: ["escluso_sanitario"] }, permanent: true });

  assert.deepEqual(template.gate_policy, { scope: "request_modules", default_serves_for: ["modello"], default_perimeter: "in_contratto" });
  assert.deepEqual((template.vocabularies as Obj).perimeter, { in: "in_contratto", out: "evoluzione" });
  assert.deepEqual(template.glossary, [{ term: "Urgente", explanation: "Oltre la soglia.", example: "Attesa di 50 minuti." }]);
  assert.equal(template.confidential, true);
  assert.equal(template.note_interne, undefined);
  assert.deepEqual(report.lists.dropped_root_fields, ["note_interne"]);
  assert.equal(normalizeTemplate(rawTemplate(), { confidential: false }).ok && true, true);
});

test("deterministic output, and a report with keys and counts only", () => {
  const a = normalizeTemplate(rawTemplate(), { roleAliases: ALIASES });
  const b = normalizeTemplate(rawTemplate(), { roleAliases: ALIASES });
  assert.equal(JSON.stringify(a), JSON.stringify(b));
  const text = JSON.stringify(normalized().report);
  for (const prose of ["Persona X", "Rispondete", "richiesta di assistenza", "idoneità", "Confermi"]) assert.ok(!text.includes(prose), prose);
  const counts = normalized().report.counts;
  assert.deepEqual(Object.keys(counts), [...Object.keys(counts)].sort());
});

test("the canonical example template is a fixed point of the normalizer", () => {
  const example = JSON.parse(readFileSync(new URL("../../../../templates/uc/esempio.minimo/1.0.0.json", import.meta.url), "utf8")) as Obj;
  const r = normalizeTemplate(example, { confidential: false });
  assert.equal(r.ok, true);
  if (!r.ok) return;
  const before = validateTemplate(example);
  const after = validateTemplate(r.template);
  assert.equal(after.ok, true, JSON.stringify(after.ok ? [] : after.errors.slice(0, 5)));
  if (!before.ok || !after.ok) return;
  assert.deepEqual(after.template, before.template);
});

test("helpers: privacy, availability, perimeter, cardinality, role phrases, minutes", () => {
  assert.deepEqual(normalizePrivacy("nessuna", "campo"), { cls: "nessuna" });
  assert.deepEqual(normalizePrivacy("dato interno", "campo"), { cls: "riservato_azienda", note: "dato interno" });
  assert.deepEqual(normalizePrivacy("escluso_sanitario", "campo"), { cls: "escluso_sanitario" });
  assert.deepEqual(normalizePrivacy("escluso_sanitario", "domanda"), { cls: "riservato_azienda", healthRuleQuestion: true, note: "escluso_sanitario" });
  assert.deepEqual(
    normalizePrivacy("personale + escluso_sanitario", "domanda"),
    { cls: "personale", healthRuleQuestion: true, note: "personale + escluso_sanitario" },
    "a personal class named with health keeps the a8 lock",
  );
  assert.deepEqual(normalizeAvailability(["oggi_export", "oggi_export"], []), { tokens: ["oggi_export"] });
  assert.deepEqual(normalizeAvailability("oggi_export o con_api_crm", ["oggi_export", "con_api_crm"]), {
    tokens: ["oggi_export", "con_api_crm"],
    note: "oggi_export o con_api_crm",
  });
  assert.deepEqual(normalizePerimeter("altro", { in: "caso_base" }), { note: "altro" });
  assert.deepEqual(normalizePerimeter("in_contratto", {}), { perimeter: "in_contratto" });
  assert.deepEqual(normalizeCardinality("n:1"), { cardinality: "N:1" });
  assert.deepEqual(normalizeCardinality("N:N"), { cardinality: "N:M" });
  assert.deepEqual(normalizeCardinality("1:0..N"), { cardinality: "1:0..N" });
  assert.deepEqual(normalizeCardinality("uno a molti"), { cardinality: "1:N" });
  assert.deepEqual(normalizeCardinality("nessuna diretta"), { note: "nessuna diretta" });
  assert.deepEqual(normalizeCardinality(""), {});
  assert.equal(rolePhraseHead("Responsabile Operativo (turni), con il team"), "responsabile operativo");
  const roles = [
    { key: "operativo", label: "Responsabile operativo (turni)" },
    { key: "controllo_gestione", label: "Controllo di gestione" },
  ];
  assert.equal(resolveRolePhrase("Responsabile operativo per i turni", roles, {}), "operativo");
  assert.equal(resolveRolePhrase("Amministrazione, a fine mese", roles, { amministrazione: "controllo_gestione" }), "controllo_gestione");
  assert.equal(resolveRolePhrase("Persona X (ufficio)", roles, {}), null);
  assert.equal(parseEstimatedMinutes("2 ore"), 120);
  assert.equal(parseEstimatedMinutes("45 minuti"), 45);
  assert.equal(parseEstimatedMinutes("mezza giornata"), undefined);
});

test("a canonical blocker scope is kept and merged with the raw fields", () => {
  const raw = rawTemplate();
  (raw.vocabularies as Obj).availability = ["oggi_export", "con_api_crm", "dopo_a8", "fuori_foundation"];
  (raw.blockers as Obj[])[0] = { key: "a8", label: "Scheda privacy approvata", scope: { availability: ["fuori_foundation"], real_data: true } };
  const r = normalizeTemplate(raw, { roleAliases: ALIASES });
  assert.ok(r.ok);
  const a8 = (r.template.blockers as Obj[]).find((b) => b.key === "a8")!;
  assert.deepEqual(a8.scope, { availability: ["fuori_foundation", "dopo_a8"], real_data: true });
});

test("inputs that are not templates are refused", () => {
  assert.equal(normalizeTemplate(null).ok, false);
  assert.equal(normalizeTemplate({ key: "x.y" }).ok, false);
});
