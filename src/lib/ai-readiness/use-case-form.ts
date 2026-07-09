/**
 * Modulo di raccolta use case (stile OPIT): l'esperto di business descrive un
 * caso in tre blocchi — il bisogno, com'è oggi (AS-IS), come potrebbe cambiare
 * con l'AI. Un esperto puo inviare piu casi. Le domande sono in linguaggio
 * semplice, con esempi concreti. Questa definizione e la sorgente unica per il
 * form, la validazione, la mappatura sulle colonne DB e il PDF del modulo.
 */

export type UseCaseFieldType = "text" | "textarea" | "number" | "select";

export type UseCaseField = {
  /** Nome del campo nel form. */
  id: string;
  /** Colonna della tabella ai_readiness_use_case_submissions. */
  column: string;
  label: string;
  help?: string;
  type: UseCaseFieldType;
  required?: boolean;
  options?: string[];
  placeholder?: string;
};

export type UseCaseBlock = {
  id: string;
  title: string;
  subtitle: string;
  fields: UseCaseField[];
};

export const USE_CASE_FORM_BLOCKS: UseCaseBlock[] = [
  {
    id: "need",
    title: "1. Il bisogno",
    subtitle:
      "Partiamo dal problema, non dalla tecnologia: cosa non funziona oggi e perche conta.",
    fields: [
      {
        id: "title",
        column: "title",
        label: "Come chiameresti questo caso?",
        help: "Un nome breve. Es. «Preparazione preventivi», «Risposte ai reclami dei clienti».",
        type: "text",
        required: true,
        placeholder: "Titolo del caso",
      },
      {
        id: "painPoint",
        column: "pain_point",
        label: "Qual e il problema o il bisogno?",
        help: "Cosa oggi fa perdere tempo, crea errori o frustrazione? Dove ci si blocca di piu?",
        type: "textarea",
        required: true,
        placeholder: "Descrivi il problema con parole tue",
      },
      {
        id: "desiredOutcome",
        column: "desired_outcome",
        label: "Cosa vorresti ottenere?",
        help: "Il risultato ideale, se avessi la bacchetta magica.",
        type: "textarea",
        placeholder: "Il risultato che vorresti",
      },
      {
        id: "frequency",
        column: "frequency",
        label: "Ogni quanto capita?",
        help: "Es. ogni giorno, a ogni ordine, una volta al mese.",
        type: "text",
        placeholder: "Frequenza",
      },
      {
        id: "affectedUsers",
        column: "affected_users",
        label: "Quante persone coinvolge?",
        help: "Quante persone fanno questa attivita o ne dipendono.",
        type: "number",
        placeholder: "Numero indicativo",
      },
    ],
  },
  {
    id: "as-is",
    title: "2. Com'e oggi",
    subtitle:
      "Fotografiamo la situazione attuale: processo, persone, strumenti e dati, cosi come sono adesso.",
    fields: [
      {
        id: "currentProcess",
        column: "current_process",
        label: "Come viene gestito oggi, passo per passo?",
        help: "Racconta il flusso dall'inizio alla fine, come se lo spiegassi a un collega nuovo.",
        type: "textarea",
        required: true,
        placeholder: "Passo 1... Passo 2... Passo 3...",
      },
      {
        id: "peopleInvolved",
        column: "people_involved",
        label: "Chi ci lavora e con che ruolo?",
        help: "Le persone o gli uffici coinvolti e cosa fa ciascuno (chi prepara, chi controlla, chi approva).",
        type: "textarea",
        placeholder: "Ruoli e responsabilita",
      },
      {
        id: "toolsUsed",
        column: "tools_used",
        label: "Con quali strumenti o programmi?",
        help: "Es. Excel, gestionale, email, WhatsApp, carta.",
        type: "text",
        placeholder: "Strumenti usati oggi",
      },
      {
        id: "dataNeeded",
        column: "data_needed",
        label: "Quali dati o informazioni servono, e dove si trovano?",
        help: "Es. anagrafica clienti nel gestionale, listini in un Excel, contratti nelle email.",
        type: "textarea",
        placeholder: "Dati necessari e dove vivono",
      },
    ],
  },
  {
    id: "to-be",
    title: "3. Come potrebbe cambiare con l'AI",
    subtitle:
      "Non serve sapere se e tecnicamente possibile: butta li l'idea e cosa conta per te.",
    fields: [
      {
        id: "aiSolutionHypothesis",
        column: "ai_solution_hypothesis",
        label: "Come immagini che l'AI possa aiutare?",
        help: "Anche solo un'intuizione. Es. «preparare la prima bozza», «trovare l'informazione giusta», «rispondere alle domande frequenti».",
        type: "textarea",
        placeholder: "La tua idea",
      },
      {
        id: "impactEstimate",
        column: "impact_estimate",
        label: "Che beneficio ti aspetti?",
        help: "Es. meno tempo, meno errori, risposte piu veloci ai clienti, meno lavoro noioso.",
        type: "textarea",
        placeholder: "Il beneficio atteso",
      },
      {
        id: "humanInLoop",
        column: "human_in_loop",
        label: "Quanto controllo umano servirebbe?",
        help: "Cosa deve restare deciso o verificato da una persona.",
        type: "textarea",
        placeholder: "Il ruolo della persona",
      },
      {
        id: "riskReasoning",
        column: "risk_reasoning",
        label: "Ci sono aspetti delicati?",
        help: "Es. dati personali, soldi, decisioni che toccano le persone. Se non ce ne sono, lascia vuoto.",
        type: "textarea",
        placeholder: "Aspetti da maneggiare con cura",
      },
      {
        id: "riskLevel",
        column: "risk_level",
        label: "Quanto e prioritario per te?",
        help: "Una tua impressione, per aiutarci a mettere in ordine i casi.",
        type: "select",
        options: ["Bassa", "Media", "Alta"],
      },
    ],
  },
];

export const USE_CASE_FORM_FIELDS: UseCaseField[] = USE_CASE_FORM_BLOCKS.flatMap(
  (block) => block.fields
);

const FIELD_BY_ID = new Map(USE_CASE_FORM_FIELDS.map((f) => [f.id, f]));

export type UseCaseFormValues = Record<string, string>;

/** Estrae i valori del form (solo campi noti, con trim e cap di lunghezza). */
export function collectUseCaseValues(
  get: (name: string) => string | null
): UseCaseFormValues {
  const out: UseCaseFormValues = {};
  for (const field of USE_CASE_FORM_FIELDS) {
    const raw = (get(field.id) ?? "").trim().slice(0, 4000);
    if (raw.length > 0) out[field.id] = raw;
  }
  return out;
}

export type UseCaseColumnValues = {
  title: string;
  currentProcess: string | null;
  painPoint: string | null;
  desiredOutcome: string | null;
  frequency: string | null;
  affectedUsers: number | null;
  dataNeeded: string | null;
  toolsUsed: string | null;
  peopleInvolved: string | null;
  humanInLoop: string | null;
  riskLevel: string | null;
  riskReasoning: string | null;
  impactEstimate: string | null;
  aiSolutionHypothesis: string | null;
};

/** Mappa i valori del form sulle colonne DB (camelCase, come il repo). */
export function mapUseCaseColumns(
  values: UseCaseFormValues
): UseCaseColumnValues | null {
  const title = values.title?.trim();
  if (!title) return null;
  const num = (v: string | undefined) => {
    if (!v) return null;
    const n = Number(v.replace(",", "."));
    return Number.isFinite(n) ? Math.trunc(n) : null;
  };
  const str = (v: string | undefined) => (v && v.trim() ? v.trim() : null);
  return {
    title: title.slice(0, 500),
    currentProcess: str(values.currentProcess),
    painPoint: str(values.painPoint),
    desiredOutcome: str(values.desiredOutcome),
    frequency: str(values.frequency)?.slice(0, 255) ?? null,
    affectedUsers: num(values.affectedUsers),
    dataNeeded: str(values.dataNeeded),
    toolsUsed: str(values.toolsUsed),
    peopleInvolved: str(values.peopleInvolved),
    humanInLoop: str(values.humanInLoop),
    riskLevel: str(values.riskLevel)?.slice(0, 50) ?? null,
    riskReasoning: str(values.riskReasoning),
    impactEstimate: str(values.impactEstimate),
    aiSolutionHypothesis: str(values.aiSolutionHypothesis),
  };
}

export function labelForUseCaseField(id: string): string {
  return FIELD_BY_ID.get(id)?.label ?? id;
}
