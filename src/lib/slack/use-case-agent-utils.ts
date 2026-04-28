export type SlackPortfolioKind = "best_practice" | "use_case_ai";
export type SlackDraftField =
  | "title"
  | "problem"
  | "flowDescription"
  | "humanInTheLoop"
  | "guardrails"
  | "expectedImpact"
  | "dataRequirements"
  | "sustainabilityImpact"
  | "urgency";

export function resolveSlackDraftThreadTs(params: {
  raw: Record<string, string | undefined>;
  activeDraftThreadTs?: string | null;
}) {
  const explicitThreadTs = params.raw.thread_ts?.trim();
  if (explicitThreadTs) return explicitThreadTs;

  const activeDraftThreadTs = params.activeDraftThreadTs?.trim();
  if (activeDraftThreadTs) return activeDraftThreadTs;

  return params.raw.ts?.trim() ?? "";
}

const BEST_PRACTICE_FIELDS: SlackDraftField[] = [
  "title",
  "problem",
  "flowDescription",
  "expectedImpact",
  "humanInTheLoop",
  "dataRequirements",
];

const USE_CASE_FIELDS: SlackDraftField[] = [
  "title",
  "problem",
  "flowDescription",
  "humanInTheLoop",
  "guardrails",
  "expectedImpact",
  "dataRequirements",
  "urgency",
];

const FIELD_LABELS_BY_KIND: Record<
  SlackPortfolioKind,
  Record<SlackDraftField, string>
> = {
  best_practice: {
    title: "titolo",
    problem: "processo precedente",
    flowDescription: "processo con AI",
    humanInTheLoop: "beneficiari e adozione",
    guardrails: "guardrail",
    expectedImpact: "impatto atteso",
    dataRequirements: "requisiti per replicarla",
    sustainabilityImpact: "impatto ambientale e sociale",
    urgency: "urgenza",
  },
  use_case_ai: {
    title: "titolo",
    problem: "situazione attuale",
    flowDescription: "flusso con AI",
    humanInTheLoop: "controllo umano",
    guardrails: "guardrail",
    expectedImpact: "impatto atteso",
    dataRequirements: "dati necessari",
    sustainabilityImpact: "impatto ambientale e sociale",
    urgency: "urgenza",
  },
};

export function stripSlackMention(text: string) {
  return text
    .replace(/<@[A-Z0-9]+>/gi, "")
    .replace(/@\w+/g, "")
    .trim();
}

export function sanitizeSlackBotText(text: string) {
  return text
    .replace(/\*\*/g, "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function detectContributionKind(
  text: string
): SlackPortfolioKind | null {
  const t = text.toLowerCase();
  const wantsIdea =
    /\bidea\b/.test(t) ||
    /segnal/.test(t) ||
    /vorrei|vogliamo|potremmo|si potrebbe|immagino/.test(t) ||
    /use case/.test(t) ||
    /applicare/.test(t);
  const didAlready =
    /best practice/.test(t) ||
    /gi[àa]/.test(t) ||
    /abbiamo (gi[àa] )?(fatto|implementato|migliorato|usato)/.test(t) ||
    /usiamo|utilizziamo|in uso|fatto con l.ai/.test(t);

  if (wantsIdea && !didAlready) return "use_case_ai";
  if (didAlready && !wantsIdea) return "best_practice";
  if (wantsIdea && didAlready) return t.includes("idea") ? "use_case_ai" : null;
  return null;
}

export function truncate(value: string, max: number) {
  return value.length > max ? value.slice(0, max - 1).trimEnd() + "…" : value;
}

export function normalizeDraftFieldValue(field: SlackDraftField, value: string) {
  const cleaned = sanitizeSlackBotText(value).replace(/^["“”]+|["“”]+$/g, "");
  if (field === "title") return truncate(cleaned, 500);
  if (field === "urgency") return truncate(cleaned, 255);
  return cleaned;
}

export function requiredSlackDraftFields(
  kind: SlackPortfolioKind,
  esgEnabled: boolean
) {
  const base = kind === "best_practice" ? BEST_PRACTICE_FIELDS : USE_CASE_FIELDS;
  return esgEnabled ? [...base, "sustainabilityImpact" as const] : base;
}

export function slackDraftFieldLabel(
  field: SlackDraftField,
  kind: SlackPortfolioKind
) {
  return FIELD_LABELS_BY_KIND[kind][field];
}

function hasOrgWideBeneficiary(value: string) {
  const text = value.toLowerCase();
  return (
    /\btutt[aoei]\b/.test(text) ||
    /\btutta nativa\b/.test(text) ||
    /\btutta l'?azienda\b/.test(text) ||
    /\btutti i team\b/.test(text) ||
    /\bwhole company\b/.test(text)
  );
}

export function questionForSlackDraftField(
  field: SlackDraftField,
  kind: SlackPortfolioKind,
  draft?: Partial<Record<SlackDraftField, string | null | undefined>>
) {
  const questions: Record<SlackDraftField, string> = {
    title:
      kind === "best_practice"
        ? "Come chiameresti questa best practice? Dammi un titolo breve e chiaro."
        : "Come chiameresti questa idea? Dammi un titolo breve e chiaro.",
    problem:
      kind === "best_practice"
        ? "Com'era il processo prima dell'AI? Raccontami cosa succedeva prima."
        : "Qual è la situazione attuale che vuoi migliorare? Cosa succede oggi?",
    flowDescription:
      kind === "best_practice"
        ? "Come funziona adesso con l'AI? Che strumenti o passaggi usate?"
        : "Come immagini il flusso con l'AI? Descrivi il passaggio da as-is a to-be.",
    humanInTheLoop:
      kind === "best_practice"
        ? "Chi la usa o ne beneficia? Se vale per tutta l'organizzazione, dimmelo pure così."
        : "Che ruolo devono mantenere le persone? Chi revisiona, approva o controlla l'output?",
    guardrails:
      "Che controlli o limiti servono per evitare errori, rischi o output inappropriati?",
    expectedImpact:
      "Che benefici concreti immagini? Tempo risparmiato, costi ridotti, qualità migliorata...",
    dataRequirements:
      kind === "best_practice"
        ? hasOrgWideBeneficiary(String(draft?.humanInTheLoop ?? ""))
          ? "Cosa servirebbe per replicarla bene in tutta l'organizzazione? Pensa a template, dati, accessi, formazione o owner."
          : "Dove potrebbe essere replicata e cosa servirebbe per farlo bene?"
        : "Di che dati, materiali o accessi avrebbe bisogno il sistema per funzionare?",
    urgency:
      "È un quick win da implementare rapidamente o un progetto più strutturato nel tempo?",
    sustainabilityImpact:
      "Ultimo campo: che tipo di impatto ambientale e sociale comporterebbe questo nuovo processo?",
  };
  return questions[field];
}

function isLowInformationAnswer(value: string) {
  const text = value.trim().toLowerCase();
  return /^(ok|si|sì|no|boh|non so|n\/a|na|nessuno|nessuna|tbd|da capire)\.?$/.test(
    text
  );
}

function isObviousDigression(value: string) {
  const text = value.trim().toLowerCase();
  return [
    "che tempo",
    "meteo",
    "barzelletta",
    "pizza",
    "calcio",
    "come stai",
    "bella la piattaforma",
    "non c'entra",
    "non centra",
    "sto solo provando",
  ].some((token) => text.includes(token));
}

function hasProblemSignal(value: string) {
  const text = value.toLowerCase();
  return [
    "oggi",
    "prima",
    "attuale",
    "process",
    "manual",
    "tempo",
    "erro",
    "fatica",
    "fornitor",
    "cliente",
    "team",
    "report",
    "document",
    "ticket",
    "dati",
    "email",
    "riunion",
  ].some((token) => text.includes(token));
}

function hasFlowSignal(value: string) {
  const text = value.toLowerCase();
  return [
    "ai",
    "modello",
    "agent",
    "flusso",
    "legge",
    "analizza",
    "genera",
    "crea",
    "scrive",
    "estrae",
    "automat",
    "integra",
    "output",
    "dashboard",
    "notifica",
  ].some((token) => text.includes(token));
}

function hasImpactSignal(value: string) {
  const text = value.toLowerCase();
  return [
    "ora",
    "ore",
    "minut",
    "giorn",
    "tempo",
    "costi",
    "qualit",
    "risparm",
    "riduc",
    "aument",
    "miglior",
    "veloc",
    "accur",
    "vendit",
    "margine",
    "cliente",
  ].some((token) => text.includes(token));
}

function hasHumanControlSignal(value: string) {
  const text = value.toLowerCase();
  return [
    "responsabile",
    "persona",
    "persone",
    "team",
    "utente",
    "utenti",
    "human",
    "manager",
    "owner",
    "revis",
    "approv",
    "valid",
    "controll",
    "supervision",
    "rilegg",
    "firma",
  ].some((token) => text.includes(token));
}

function hasBenefitSignal(value: string) {
  const text = value.toLowerCase();
  return (
    hasOrgWideBeneficiary(text) ||
    [
      "team",
      "funzione",
      "funzioni",
      "nativa",
      "azienda",
      "persone",
      "client",
      "utente",
      "utenti",
      "benefic",
      "usa",
      "usano",
    ].some((token) => text.includes(token))
  );
}

function hasRequirementSignal(value: string) {
  const text = value.toLowerCase();
  return [
    "dato",
    "dati",
    "document",
    "access",
    "template",
    "linee guida",
    "brand",
    "owner",
    "formazione",
    "integraz",
    "material",
    "workflow",
    "process",
    "serve",
    "servono",
    "necess",
  ].some((token) => text.includes(token));
}

export function validateSlackDraftAnswer(
  field: SlackDraftField,
  kind: SlackPortfolioKind,
  rawValue: string
): { ok: true } | { ok: false; message: string } {
  const value = normalizeDraftFieldValue(field, rawValue);
  const neutralSustainabilityAnswer =
    field === "sustainabilityImpact" &&
    /^(nessun[ao]?|neutr[ao]|impatto neutro)\.?$/i.test(value.trim());

  if (!value || (isLowInformationAnswer(value) && !neutralSustainabilityAnswer)) {
    return {
      ok: false,
      message:
        "Mi serve un dettaglio in più per registrarlo bene. Puoi rispondere con una frase concreta?",
    };
  }

  if (isObviousDigression(value)) {
    return {
      ok: false,
      message:
        "Mi sembra una risposta fuori contesto rispetto al campo che sto compilando. Restiamo su questa domanda con un dettaglio operativo?",
    };
  }

  if (field === "title") {
    return value.length >= 3
      ? { ok: true }
      : {
          ok: false,
          message: "Dammi un titolo un po' più esplicito, anche breve.",
        };
  }

  if (field === "problem") {
    return value.length >= 14 && (hasProblemSignal(value) || value.length >= 45)
      ? { ok: true }
      : {
          ok: false,
          message:
            kind === "best_practice"
              ? "Qui mi serve capire com'era il processo prima dell'AI: cosa succedeva, chi era coinvolto o dove nasceva la frizione?"
              : "Qui mi serve capire la situazione attuale da migliorare: processo, frizione, team coinvolti o problema concreto.",
        };
  }

  if (field === "flowDescription") {
    return value.length >= 14 && (hasFlowSignal(value) || value.length >= 45)
      ? { ok: true }
      : {
          ok: false,
          message:
            kind === "best_practice"
              ? "Qui mi serve capire come funziona con l'AI: passaggi, strumenti, input o output."
              : "Qui mi serve capire come funzionerebbe il flusso con l'AI: passaggi, input, output o automazioni.",
        };
  }

  if (field === "humanInTheLoop") {
    if (kind === "best_practice") {
      return hasBenefitSignal(value)
        ? { ok: true }
        : {
            ok: false,
            message:
              "Qui mi serve capire chi la usa o chi ne beneficia. Può essere un team specifico o tutta l'organizzazione.",
          };
    }

    return hasHumanControlSignal(value) && !hasOrgWideBeneficiary(value)
      ? { ok: true }
      : {
          ok: false,
          message:
            "Qui non mi serve chi ne beneficia, ma chi mantiene il controllo umano: chi revisiona, approva o valida l'output?",
        };
  }

  if (field === "expectedImpact") {
    return value.length >= 10 && (hasImpactSignal(value) || value.length >= 45)
      ? { ok: true }
      : {
          ok: false,
          message:
            "Qui mi serve un beneficio concreto: tempo risparmiato, costi ridotti, qualità migliore, rischio minore o impatto sui clienti.",
        };
  }

  if (field === "dataRequirements") {
    return hasRequirementSignal(value) || value.length >= 25
      ? { ok: true }
      : {
          ok: false,
          message:
            kind === "best_practice"
              ? "Per replicarla mi serve capire cosa serve davvero: template, dati, accessi, owner, formazione o passaggi operativi."
              : "Per far funzionare il sistema mi serve capire quali dati, documenti, accessi o materiali sono necessari.",
        };
  }

  if (field === "sustainabilityImpact") {
    return neutralSustainabilityAnswer || value.length >= 8
      ? { ok: true }
      : {
          ok: false,
          message:
            "Mi serve almeno una frase sull'impatto ambientale o sociale, anche se l'impatto è neutro o da verificare.",
        };
  }

  if (field === "guardrails") {
    return value.length >= 8
      ? { ok: true }
      : {
          ok: false,
          message:
            "Mi serve almeno un guardrail concreto: cosa deve evitare o cosa deve restare sotto controllo umano?",
        };
  }

  if (field !== "urgency" && value.length < 6) {
    return {
      ok: false,
      message:
        "Risposta troppo sintetica per essere utile al team. Puoi aggiungere un dettaglio operativo?",
    };
  }

  return { ok: true };
}
