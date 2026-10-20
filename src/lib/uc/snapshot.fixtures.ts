/**
 * Dati inventati per i test di fotografia, viste MCP ed export.
 * Nessun contenuto di clienti reali: voci d'esempio di una «gestione richieste».
 */
import type { BuildSnapshotInput, SnapshotAnswerInput, SnapshotItemInput } from "./snapshot.ts";

export function answer(over: Partial<SnapshotAnswerInput> = {}): SnapshotAnswerInput {
  return {
    version: 1,
    kind: "valore",
    value: { text: "Valore d'esempio" },
    valueNormalized: null,
    sourceKind: "referente",
    sourceRef: null,
    sourceBasis: "sistema",
    confidence: "certo",
    validFrom: null,
    validTo: null,
    textHash: null,
    createdAt: "2026-09-01T08:00:00.000Z",
    ...over,
  };
}

export function item(over: Partial<SnapshotItemInput> & { key: string }): SnapshotItemInput {
  return {
    kind: "domanda",
    section: "modello_dati",
    parentKey: null,
    title: `Titolo di ${over.key}`,
    explanation: "Spiegazione d'esempio",
    why: "Perché serve, d'esempio",
    example: "Esempio inventato",
    help: "Dove trovarlo, d'esempio",
    spec: {},
    priority: "must",
    servesFor: ["modello"],
    privacyClass: "nessuna",
    valueVisibility: "owner_e_ls",
    availability: [],
    perimeter: "in_contratto",
    levers: [],
    responseType: "testo",
    responseConfig: {},
    requestModuleKey: "mod.esempio",
    ownerRoleKey: "referente_operativo",
    inGateScope: true,
    status: "da_chiedere",
    statusReason: null,
    staleAt: null,
    validatedAt: null,
    naReason: null,
    naApprovedAt: null,
    waiver: null,
    waiverApprovedAt: null,
    fallback: null,
    fallbackApprovedAt: null,
    sourceRefs: [],
    validatedAnswer: null,
    currentAnswer: null,
    ...over,
  };
}

/** Catalogo d'esempio con tutti i casi che contano per fotografia, MCP ed export. */
export function sampleInput(over: Partial<BuildSnapshotInput> = {}): BuildSnapshotInput {
  const validated = answer({ version: 2, value: { value: 42, unit: "min" }, valueNormalized: { minutes: 42 } });
  return {
    case: {
      id: "11111111-1111-4111-8111-111111111111",
      workspaceId: "22222222-2222-4222-8222-222222222222",
      code: "ES-UC-01",
      title: "Gestione richieste d'esempio",
      perimeterLabel: "Perimetro d'esempio",
      contractRefs: ["art. 1.1"],
      dataControllerLabel: null,
    },
    template: { key: "esempio.minimo", version: "1.0.0", hash: "a".repeat(64) },
    version: 1,
    frozenAt: new Date("2026-10-01T10:00:00.000Z"),
    gate: {
      key: "G1",
      reviewId: "33333333-3333-4333-8333-333333333333",
      decision: "approvato",
      policyScope: "request_modules",
      required: 3,
      ok: 3,
      summaryTextHash: "b".repeat(64),
      waiverKeys: [],
    },
    items: [
      item({ key: "ent.richiesta", kind: "entita", section: "modello_dati", inGateScope: false, requestModuleKey: null, spec: { chiave: "id richiesta", granularita: "una riga per richiesta" }, responseType: null }),
      item({
        key: "richiesta.durata",
        kind: "campo",
        parentKey: "ent.richiesta",
        inGateScope: false,
        requestModuleKey: null,
        spec: { tipo_dato: "numero", unita: "min", obbligatorio: true },
        responseType: "durata",
        status: "validata",
        validatedAt: "2026-09-20T09:00:00.000Z",
        validatedAnswer: validated,
        currentAnswer: validated,
      }),
      item({ key: "richiesta.cliente", kind: "campo", parentKey: "ent.richiesta", privacyClass: "personale", inGateScope: false, requestModuleKey: null, spec: { tipo_dato: "testo" }, status: "bloccata" }),
      item({
        key: "q.esempio.01",
        status: "validata",
        responseType: "valuta",
        privacyClass: "riservato_azienda",
        validatedAt: "2026-09-21T09:00:00.000Z",
        validatedAnswer: answer({ value: { amount: 120, currency: "EUR", vat: "esclusa", per: "ora" }, valueNormalized: { amount_eur: 120 } }),
      }),
      item({
        key: "q.esempio.02",
        status: "non_applicabile",
        naReason: "Non serve in questo esempio inventato",
        naApprovedAt: "2026-09-22T09:00:00.000Z",
      }),
      item({
        key: "q.esempio.03",
        status: "in_verifica",
        currentAnswer: answer({ sourceKind: "dichiarato_in_call", sourceRef: "F001", confidence: "da_verificare" }),
      }),
      item({
        key: "q.esempio.04",
        status: "validata",
        privacyClass: "personale_equipaggio",
        validatedAt: "2026-09-23T09:00:00.000Z",
        validatedAnswer: answer({ value: { text: "dato personale inventato" } }),
      }),
      item({ key: "q.esempio.05", status: "validata", valueVisibility: "solo_ls", validatedAt: "2026-09-23T09:00:00.000Z", validatedAnswer: answer({ value: { text: "=SOMMA(A1)" } }) }),
      item({ key: "rule.esempio.priorita", kind: "regola", section: "regole", spec: { tipo_regola: "vincolo", forma_logica: "SE urgente ALLORA prima" }, status: "da_chiedere", responseType: null, requestModuleKey: null, inGateScope: false }),
      item({ key: "kpi.esempio.tempo", kind: "kpi", section: "kpi", spec: { formula: "media(durata)", unit: "min", direzione: "giu", baseline: "da misurare" }, responseType: null, requestModuleKey: null, inGateScope: false, levers: ["tempo"] }),
    ],
    links: [
      { fromKey: "richiesta.durata", toKey: "ent.richiesta", relation: "deriva_da", cardinality: "N:1", note: null },
      { fromKey: "q.esempio.01", toKey: "richiesta.durata", relation: "precisa", cardinality: null, note: null },
      { fromKey: "kpi.esempio.tempo", toKey: "richiesta.durata", relation: "usa", cardinality: null, note: null },
    ],
    ...over,
  };
}
