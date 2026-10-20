import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { CONNECTOR_TOOL_NAMES } from "./contract.ts";
import { EXAMPLE_CONNECTOR_PROFILE_INPUT, EXAMPLE_INSTRUCTIONS_TEMPLATE, EXAMPLE_PROFILE, EXAMPLE_PROFILE_FILE } from "./contract.fixtures.ts";
import { toConnectorRuntimeConfig, type ConnectorConfigRow } from "./config.ts";
import {
  connectorProfileFromStored,
  parseConnectorProfile,
  parseConnectorProfileFile,
  PROFILE_FILE_TEMPLATE_KEY,
  storedConnectorProfile,
} from "./profile.ts";
import { guideProfileMismatches, parseConnectorGuide } from "./guide-schema.ts";
import { connectorToolDefinitions } from "./tools.ts";

// Profilo del cliente per workspace (decisione 1 dell'arresto B, K8). Dati sintetici.

test("profilo salvato: assente, non valido o valido; letto una volta per valore", () => {
  assert.deepEqual(connectorProfileFromStored(null), { ok: false, fieldErrors: { profile: "Profilo non caricato." } });
  assert.deepEqual(connectorProfileFromStored(undefined), { ok: false, fieldErrors: { profile: "Profilo non caricato." } });
  const onlyContract = connectorProfileFromStored({ contract: EXAMPLE_PROFILE });
  assert.equal(onlyContract.ok, false);
  if (!onlyContract.ok) assert.deepEqual(Object.keys(onlyContract.fieldErrors).sort(), ["reviewNotes", "tools"]);
  const secret = connectorProfileFromStored({ ...EXAMPLE_CONNECTOR_PROFILE_INPUT, contract: { ...EXAMPLE_PROFILE, areas: ["Valore Segreto"] } });
  assert.equal(secret.ok, false);
  assert.doesNotMatch(JSON.stringify(secret), /Segreto/);

  // Lo stesso valore (anche un oggetto nuovo, come a ogni richiesta) dà lo stesso profilo,
  // così le definizioni dei tool non si ricostruiscono.
  const first = connectorProfileFromStored(JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)));
  const second = connectorProfileFromStored(JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)));
  assert.ok(first.ok && second.ok);
  if (!first.ok || !second.ok) return;
  assert.equal(first.profile, second.profile);
  assert.equal(connectorToolDefinitions(first.profile), connectorToolDefinitions(second.profile));
  assert.deepEqual(first.profile.contract, EXAMPLE_PROFILE);
});

test("profilo salvato: la forma da salvare si rilegge uguale", () => {
  const parsed = parseConnectorProfile(EXAMPLE_CONNECTOR_PROFILE_INPUT);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const stored = storedConnectorProfile(parsed.profile);
  assert.deepEqual(stored, JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)));
  const again = parseConnectorProfile(JSON.parse(JSON.stringify(stored)));
  assert.ok(again.ok);
  if (again.ok) assert.deepEqual(again.profile, parsed.profile);
});

test("file del profilo: profilo e modello delle istruzioni, validati e separati", () => {
  const file = parseConnectorProfileFile(JSON.parse(JSON.stringify(EXAMPLE_PROFILE_FILE)));
  assert.ok(file.ok);
  if (!file.ok) return;
  assert.equal(file.instructionsTemplate, EXAMPLE_INSTRUCTIONS_TEMPLATE);
  assert.deepEqual(file.profile.contract, EXAMPLE_PROFILE);
  for (const name of CONNECTOR_TOOL_NAMES) assert.ok(file.profile.tools[name].title);

  // Senza modello, con un modello non valido o con un profilo incompleto: errori per campo, mai i valori.
  const noTemplate = parseConnectorProfileFile(EXAMPLE_CONNECTOR_PROFILE_INPUT);
  assert.equal(noTemplate.ok, false);
  if (!noTemplate.ok) assert.deepEqual(Object.keys(noTemplate.fieldErrors), [PROFILE_FILE_TEMPLATE_KEY]);
  const badTemplate = parseConnectorProfileFile({ ...EXAMPLE_PROFILE_FILE, instructionsTemplate: "Testo Segreto senza segnaposto" });
  assert.equal(badTemplate.ok, false);
  assert.doesNotMatch(JSON.stringify(badTemplate), /Segreto/);
  const both = parseConnectorProfileFile({ contract: EXAMPLE_PROFILE, instructionsTemplate: 7 });
  assert.equal(both.ok, false);
  if (!both.ok) assert.deepEqual(Object.keys(both.fieldErrors).sort(), [PROFILE_FILE_TEMPLATE_KEY, "reviewNotes", "tools"].sort());
  for (const input of [null, [], "testo", 3]) assert.equal(parseConnectorProfileFile(input).ok, false);
  // Un campo in più nel file non passa (il profilo è strict).
  assert.equal(parseConnectorProfileFile({ ...EXAMPLE_PROFILE_FILE, extra: true }).ok, false);
});

test("docs/connettore/profilo-esempio.json: il file d'esempio di connector-admin profile è EXAMPLE_PROFILE_FILE, valido e coerente con la guida d'esempio", () => {
  const file = JSON.parse(readFileSync(new URL("../../../docs/connettore/profilo-esempio.json", import.meta.url), "utf8")) as unknown;
  // Uguale al profilo sintetico dei test (anche nell'ordine delle chiavi): rigenerarlo da
  // EXAMPLE_PROFILE_FILE quando cambia (README §1, «Configurazione del workspace»).
  assert.equal(JSON.stringify(file), JSON.stringify(EXAMPLE_PROFILE_FILE));
  const parsed = parseConnectorProfileFile(file);
  assert.ok(parsed.ok);
  if (!parsed.ok) return;
  const guide = parseConnectorGuide(JSON.parse(readFileSync(new URL("../../../docs/connettore/guida-esempio.json", import.meta.url), "utf8")));
  assert.ok(guide.ok);
  if (guide.ok) assert.deepEqual(guideProfileMismatches(guide.guide, parsed.profile.contract), []);
});

test("configurazione: profilo e modello del workspace validati; i problemi solo come nomi di campo", () => {
  const row = (patch: Partial<ConnectorConfigRow> = {}): ConnectorConfigRow => ({
    workspaceId: "11111111-1111-4111-8111-111111111111",
    slug: "prova-a",
    enabled: true,
    codePrefix: "XA",
    identityMode: "dichiarata",
    authMode: "header",
    workspaceDisplayName: "Alfa",
    guide: null,
    guideVersion: null,
    allowedOrigins: [],
    limits: {},
    profile: JSON.parse(JSON.stringify(EXAMPLE_CONNECTOR_PROFILE_INPUT)),
    instructionsTemplate: EXAMPLE_INSTRUCTIONS_TEMPLATE,
    ...patch,
  });
  const ok = toConnectorRuntimeConfig(row());
  assert.ok(ok.profile);
  assert.equal(ok.instructionsTemplate, EXAMPLE_INSTRUCTIONS_TEMPLATE);
  assert.deepEqual(ok.profileProblems, []);
  const missing = toConnectorRuntimeConfig(row({ profile: undefined, instructionsTemplate: undefined }));
  assert.equal(missing.profile, null);
  assert.equal(missing.instructionsTemplate, null);
  assert.deepEqual(missing.profileProblems, ["profile", "instructions_template"]);
  const bad = toConnectorRuntimeConfig(row({ profile: { contract: { ...EXAMPLE_PROFILE, areas: ["Valore Segreto"] } }, instructionsTemplate: "{{altro}}" }));
  assert.equal(bad.profile, null);
  assert.equal(bad.instructionsTemplate, null);
  assert.ok(bad.profileProblems.every((field) => /^(profile(\.[A-Za-z0-9_.]+)?|instructions_template)$/.test(field)));
  assert.doesNotMatch(JSON.stringify(bad.profileProblems), /Segreto/);
});
