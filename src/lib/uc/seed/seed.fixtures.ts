/**
 * Seed e template inventati per i test del piano di seed: una «gestione
 * richieste» d'esempio. Nessun contenuto di clienti reali; i nomi di persona
 * sono inventati e servono a provare la redazione.
 */
import type { CaseSeed } from "./schema.ts";
import type { SeedRedactor, SeedScanner, SeedTemplate } from "./plan.ts";

export const SAMPLE_NAMES = ["Giulia Esempio", "Paolo Prova"];

export function sampleTemplate(over: Partial<SeedTemplate> = {}): SeedTemplate {
  return {
    key: "esempio.richieste",
    version: "1.0.0",
    roles: [{ key: "resp_vendite" }, { key: "operativo" }],
    blockers: [{ key: "a8" }, { key: "sanitario" }, { key: "accesso_sistema" }],
    map: {
      nodes: [
        { id: "blk.01", items: ["ent.richiesta"] },
        { id: "blk.02", items: [] },
      ],
    },
    items: [
      { key: "ent.richiesta", kind: "entita", title: "Richiesta", privacy_class: "nessuna" },
      { key: "richiesta.durata", kind: "campo", title: "Durata", privacy_class: "nessuna" },
      { key: "kpi.vendite.tempo", kind: "kpi", title: "Tempo di risposta", privacy_class: "nessuna" },
      { key: "kpi.vendite.chiuse", kind: "kpi", title: "Richieste chiuse", privacy_class: "nessuna" },
      { key: "q.vendite.01", kind: "domanda", title: "Quante richieste al giorno?", privacy_class: "nessuna", request_module: "mod.vendite", response: { type: "testo" } },
      { key: "q.vendite.02", kind: "domanda", title: "Quanto vale una richiesta?", privacy_class: "riservato_azienda", request_module: "mod.vendite", response: { type: "valuta" } },
      { key: "q.vendite.03", kind: "domanda", title: "Quale canale usate?", privacy_class: "nessuna", request_module: "mod.vendite", response: { type: "scelta" } },
      { key: "q.vendite.04", kind: "domanda", title: "Cosa chiedono i clienti?", privacy_class: "nessuna", request_module: "mod.vendite", response: { type: "testo" } },
      { key: "q.operativo.01", kind: "domanda", title: "Chi segue la richiesta?", privacy_class: "personale", request_module: "mod.operativo", response: { type: "testo" }, blocked_by: ["a8"] },
      { key: "q.operativo.02", kind: "domanda", title: "Elenco dei turni", privacy_class: "riservato_azienda", request_module: "mod.operativo", response: { type: "tabella" }, blocked_by: ["a8"] },
      { key: "q.operativo.03", kind: "domanda", title: "Tempo medio di lavorazione", privacy_class: "nessuna", request_module: "mod.operativo", response: { type: "durata" } },
      {
        key: "q.operativo.04",
        kind: "domanda",
        title: "Come escludete la visita medica dai dati?",
        privacy_class: "riservato_azienda",
        request_module: "mod.operativo",
        response: { type: "conferma_regola" },
        spec: { health_rule_question: true },
      },
      { key: "q.operativo.05", kind: "domanda", title: "Domanda non nel seed", privacy_class: "nessuna", request_module: "mod.operativo", response: { type: "testo" } },
    ],
    ...over,
  };
}

/** Seed valido e completo sul template d'esempio. */
export function sampleSeed(): CaseSeed {
  return {
    schema: "unbundle.uc-case-seed/1",
    template: { key: "esempio.richieste", version: "1.0.0" },
    workspace_hint: "Esempio Srl · Vendite (nota interna)",
    case: {
      code: "ES-UC-01",
      title: "Gestione richieste",
      one_liner: "Risponde prima alle richieste dei clienti.",
      status: "raccolta",
      perimeter_label: "Caso d'esempio (art. 1)",
      owner_role_label: "Responsabile vendite (Giulia Esempio)",
    },
    description: {
      titolo: "Gestione richieste",
      sottotitolo: "Un esempio inventato",
      in_breve: "In breve, d'esempio. Referente: Giulia Esempio, giulia@esempio.test.",
      problema: "Le richieste arrivano da più canali.",
      soluzione: "Un agente propone la risposta, la persona decide.",
      come_funziona: ["Legge la richiesta", "Propone una risposta"],
      cosa_non_fa: ["Non tratta dati sanitari come la visita medica"],
      per_chi: [{ ruolo: "Vendite", cosa_cambia: "Meno tempo sulle richieste semplici" }],
      leve: [{ leva: "Tempo", come: "Risposte più rapide", kpi: "kpi.vendite.tempo" }],
      perimetro: { caso_commerciale: ["Vale l'art. 5.1 del contratto d'esempio", "Allegato: All. B"], evoluzione: ["Più canali"] },
      fasi: [{ fase: "Avvio", quando: "Mese 1", cosa: "Raccolta dati", uscita: "Catalogo v1" }],
      prerequisiti: ["Accesso alla casella condivisa"],
      rischi: [{ rischio: "Dati incompleti", mitigazione: "Chiedere conferma" }],
      domande_aperte: ["Quali canali servono davvero?"],
    },
    map: {
      titolo: "Mappa della soluzione d'esempio",
      blocchi: [
        {
          id: "blk.01",
          titolo: "Arriva la richiesta",
          chi: "Cliente",
          descrizione: "La richiesta entra nel sistema e usa richiesta.durata.",
          input: ["email"],
          output: ["richiesta"],
          perimetro: "caso_commerciale",
          priorita: "must",
          disponibilita: "oggi",
          leve: ["tempo"],
          serve_per: ["modello"],
          privacy: "nessuna",
          kpi: ["kpi.vendite.tempo", "kpi.vendite.assente"],
          documenti_cliente: [{ voce: "q.vendite.01", tipo_risposta: "testo", stato_iniziale: "in_verifica", owner: "vendite" }],
        },
        {
          id: "blk.02",
          titolo: "Risposta proposta",
          chi: "Agente",
          descrizione: "Propone la risposta.",
          input: ["richiesta"],
          output: ["proposta"],
          perimetro: "caso_commerciale",
          priorita: "must",
          disponibilita: "oggi",
          leve: ["tempo", "qualita"],
          serve_per: [],
          privacy: "nessuna",
          kpi: [],
          documenti_cliente: [],
        },
      ],
      flussi: [{ da: "blk.01", a: "blk.02", etichetta: "richiesta pronta" }],
    },
    process: {
      as_is: [
        { id: "A1", fase: "Arrivo", nome: "Legge l'email", chi: "Vendite", strumento: "Email", input: ["email"], output: ["nota"], decisione_umana: "Sì", attrito: "Tante email", tempo: "10 min", fonte: "F001", dati: ["richiesta.durata", "x.assente"] },
        { id: "A2", fase: "Risposta", nome: "Risponde", chi: "Vendite", strumento: "Email", input: ["nota"], output: ["risposta"], decisione_umana: "Sì", attrito: "", tempo: "5 min", fonte: "F002", dati: [] },
      ],
      to_be: [
        {
          id: "T1",
          fase: "Arrivo",
          nome: "L'agente legge",
          chi: "Agente",
          strumento: "Unbundle",
          input: ["email"],
          output: ["proposta"],
          decisione_umana: "No",
          attrito: "",
          tempo: "1 min",
          fonte: "F003",
          dati: ["kpi.vendite.tempo"],
          perimetro: "caso_commerciale",
          priorita: "must",
          disponibilita: "oggi",
          leve: ["tempo"],
          serve_per: ["modello"],
        },
      ],
      esempio_end_to_end: { titolo: "Una richiesta dall'inizio alla fine", passi: ["Arriva una richiesta (kpi.vendite.tempo)", "La persona approva"] },
    },
    roi: {
      spiegazione: "Il ROI d'esempio.",
      leve: [
        { leva: "Tempo", kpi: ["kpi.vendite.tempo"], come_diventa_euro: "Ore risparmiate per costo orario", formula: "ore × costo", dati_necessari: ["ore"], esempio_illustrativo: "10 ore" },
        { leva: "Nuove capacità", kpi: ["kpi.vendite.chiuse", "kpi.vendite.assente"], come_diventa_euro: "Richieste in più", formula: "n × margine", dati_necessari: [], esempio_illustrativo: "" },
      ],
      costi: [
        { voce: "Sviluppo", tipo: "una tantum (implementazione)", come_si_stima: "Giorni × tariffa", fonte: "offerta" },
        { voce: "Licenze", tipo: "ricorrente (annuo)", come_si_stima: "Listino", fonte: "listino" },
        { voce: "Costi interni", tipo: "escluse da questo conto", come_si_stima: "-", fonte: "-" },
        { voce: "Altro", tipo: "da capire", come_si_stima: "-", fonte: "-" },
      ],
      formula_roi: { spiegazione: "Beneficio meno costi.", break_even: "Mesi al pareggio.", valore_5_anni: "Somma a 5 anni." },
      esempio: { nota: "Numeri inventati.", righe: [{ voce: "Ore", valore: "10" }] },
      cosa_serve: ["Il costo orario"],
    },
    contacts_roles: [
      { template_role_key: "vendite", role_label: "Responsabile vendite" },
      { template_role_key: "operativo", role_label: "Operativo" },
    ],
    contacts_note: "I referenti si inseriscono dall'interfaccia.",
    blockers: [
      { key: "a8", status: "aperto" },
      { key: "sanitario", status: "permanente" },
    ],
    milestones: [
      { key: "fase_1", title: "Avvio", planned_label: "ottobre (proposta)", is_proposal: true, notes: null },
      { key: "fase_2", title: "Sviluppo", planned_label: "novembre, da confermare", is_proposal: false, notes: "Dipende dai dati" },
    ],
    answers: [
      { item_key: "q.vendite.01", initial_state: "in_verifica", known_value: "Circa 40 al giorno (F001, F014a; poi E1)", known_value_source_kind: "dichiarato_in_call", blocked_by: [] },
      { item_key: "q.vendite.02", initial_state: "in_verifica", known_value: "Circa 120 euro a richiesta (F-M3)", known_value_source_kind: "dichiarato_in_call", blocked_by: [] },
      { item_key: "q.vendite.03", initial_state: "da_chiedere", known_value: "Soprattutto email", known_value_source_kind: "dichiarato_in_call", blocked_by: [] },
      { item_key: "q.vendite.04", initial_state: "in_verifica", known_value: "Chiedono il certificato del vaccino (F004)", known_value_source_kind: "dichiarato_in_call", blocked_by: [] },
      { item_key: "q.operativo.01", initial_state: "bloccata", known_value: "La segue Paolo Prova (F005)", known_value_source_kind: "dichiarato_in_call", blocked_by: ["a8"] },
      { item_key: "q.operativo.02", initial_state: "bloccata", known_value: null, known_value_source_kind: null, blocked_by: ["a8"] },
      { item_key: "q.operativo.03", initial_state: "mancante", known_value: "Oggi non lo misurano (E2)", known_value_source_kind: "dichiarato_in_call", blocked_by: [] },
      { item_key: "q.operativo.04", initial_state: "da_chiedere", known_value: "La visita medica non entra mai nei file", known_value_source_kind: "dichiarato_in_call", blocked_by: [] },
    ],
  };
}

/**
 * Scansione finta, con le stesse regole di base di `text/scan.ts`: un termine
 * sanitario blocca, salvo che stia già nel testo della domanda sulla regola
 * sanitaria (allora avvisa); «preferisce solo» vicino a un termine di categoria
 * blocca come discriminatorio; il nome «Mario» avvisa.
 */
export const fakeScan: SeedScanner = (text, opts) => {
  const blocking: { category: string; term: string }[] = [];
  const warnings: { category: string; term: string }[] = [];
  for (const m of text.matchAll(/\b(visit[ae]\s+medic[ah]e?|vaccin\w*|malatti\w*)\b/gi)) {
    const term = m[0].toLowerCase();
    const inQuestion = opts.healthRuleQuestion?.questionText.toLowerCase().includes(term) ?? false;
    (inQuestion ? warnings : blocking).push({ category: "sanitario", term });
  }
  if (/preferisc\w*\s+solo\s+(donne|uomini|giovani)/i.test(text)) blocking.push({ category: "discriminatorio", term: "preferenza" });
  if (/\bMario\b/.test(text)) warnings.push({ category: "nome_persona", term: "Mario" });
  return { blocking, warnings };
};

/** Redazione finta: email e nomi dell'elenco → «[referente]». */
export const fakeRedact: SeedRedactor = (text, names) => {
  let count = 0;
  let out = text.replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, () => {
    count++;
    return "[referente]";
  });
  for (const name of names) {
    const re = new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi");
    out = out.replace(re, () => {
      count++;
      return "[referente]";
    });
  }
  return { text: out, count };
};
