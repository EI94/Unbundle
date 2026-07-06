import type {
  AiReadinessAnswer,
  AiReadinessDashboard,
  AiReadinessDerivedScores,
  AiReadinessMaturityLevel,
  AiReadinessQuestion,
  AiReadinessTemplateDefinition,
} from "./types";

export const MATURITY_LEVELS: AiReadinessMaturityLevel[] = [
  {
    level: 0,
    label: "Not started",
    description: "Non ci sono ancora pratiche o ownership chiare.",
  },
  {
    level: 1,
    label: "Fragmented",
    description: "Esistono iniziative isolate, non governate in modo coerente.",
  },
  {
    level: 2,
    label: "Experimental",
    description: "L'organizzazione sperimenta ma non ha ancora processi scalabili.",
  },
  {
    level: 3,
    label: "Structured",
    description: "Ci sono regole, ownership e primi flussi replicabili.",
  },
  {
    level: 4,
    label: "Scalable",
    description: "La readiness e gestita a livello operativo e scalabile.",
  },
  {
    level: 5,
    label: "AI Native",
    description: "AI integrata in tecnologia, contesto, workflow e adoption.",
  },
];

function roundScore(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(value * 100) / 100;
}

export function getMaturityLevel(score: number | null | undefined) {
  if (typeof score !== "number" || !Number.isFinite(score)) return null;
  const level = Math.max(0, Math.min(5, Math.round(score)));
  return MATURITY_LEVELS[level] ?? MATURITY_LEVELS[0];
}

function questionScore(question: AiReadinessQuestion, answer: AiReadinessAnswer) {
  if (question.answerType === "text") return null;
  if (question.answerType === "scale") {
    const n = Number(answer.value);
    if (!Number.isFinite(n)) return null;
    const min = question.min ?? 0;
    const max = question.max ?? 5;
    return Math.max(min, Math.min(max, n));
  }
  if (question.answerType === "single_choice") {
    const value = String(answer.value ?? "");
    const option = question.options?.find((item) => item.value === value);
    return typeof option?.score === "number" ? option.score : null;
  }
  if (question.answerType === "multi_choice") {
    const values = Array.isArray(answer.value) ? answer.value : [];
    const scores =
      question.options
        ?.filter((item) => values.includes(item.value))
        .map((item) => item.score)
        .filter((score): score is number => typeof score === "number") ?? [];
    if (scores.length === 0) return null;
    return scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }
  return null;
}

function weightedAverage(
  values: Array<{ value: number | null; weight: number }>
) {
  const valid = values.filter(
    (item) => typeof item.value === "number" && Number.isFinite(item.value)
  ) as Array<{ value: number; weight: number }>;
  const totalWeight = valid.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
  if (valid.length === 0 || totalWeight <= 0) return null;
  return (
    valid.reduce((sum, item) => sum + item.value * Math.max(0, item.weight), 0) /
    totalWeight
  );
}

export function scoreResponse(params: {
  template: AiReadinessTemplateDefinition;
  answers: AiReadinessAnswer[];
}): AiReadinessDerivedScores {
  const answerByQuestionId = new Map(
    params.answers.map((answer) => [answer.questionId, answer])
  );
  const scoredQuestions = params.template.questions.filter(
    (question) => question.answerType !== "text"
  );

  const scoredValues = scoredQuestions.map((question) => {
    const answer = answerByQuestionId.get(question.id);
    return {
      question,
      value: answer ? questionScore(question, answer) : null,
      weight: question.weight ?? 1,
    };
  });

  const sectionScores: Record<string, number | null> = {};
  for (const section of params.template.sections) {
    const items = scoredValues
      .filter((item) => item.question.sectionId === section.id)
      .map((item) => ({ value: item.value, weight: item.weight }));
    sectionScores[section.id] = roundScore(weightedAverage(items));
  }

  const pillarScores: Record<string, number | null> = {};
  for (const pillar of params.template.pillars) {
    const items = scoredValues
      .filter((item) => item.question.pillarId === pillar.id)
      .map((item) => ({ value: item.value, weight: item.weight }));
    pillarScores[pillar.id] = roundScore(weightedAverage(items));
  }

  const weightedAverageScore = weightedAverage(
    params.template.pillars.map((pillar) => ({
      value: pillarScores[pillar.id],
      weight: pillar.weight,
    }))
  );
  const validPillarEntries = Object.entries(pillarScores).filter(
    (entry): entry is [string, number] =>
      typeof entry[1] === "number" && Number.isFinite(entry[1])
  );
  const weakest = validPillarEntries.reduce<[string | null, number | null]>(
    (current, next) =>
      current[1] == null || next[1] < current[1] ? [next[0], next[1]] : current,
    [null, null]
  );
  const formula = params.template.scoringSchema.readinessFormula;
  const readinessIndex =
    weightedAverageScore == null || weakest[1] == null
      ? null
      : weightedAverageScore * formula.weightedAverageWeight +
        weakest[1] * formula.weakestPillarWeight;
  const answeredScoredQuestions = scoredValues.filter(
    (item) => typeof item.value === "number"
  ).length;

  return {
    scoringVersion: params.template.scoringSchema.version,
    pillarScores,
    sectionScores,
    weightedAverage: roundScore(weightedAverageScore),
    weakestPillarScore: roundScore(weakest[1]),
    readinessIndex: roundScore(readinessIndex),
    bottleneckPillar: weakest[0],
    confidence:
      scoredQuestions.length > 0
        ? roundScore(answeredScoredQuestions / scoredQuestions.length) ?? 0
        : 0,
    answeredScoredQuestions,
    totalScoredQuestions: scoredQuestions.length,
  };
}

export function aggregateScores(params: {
  template: AiReadinessTemplateDefinition;
  respondents: Array<{
    organizationUnit: string | null;
    pseudonymousId: string;
    inviteStatus?: string | null;
  }>;
  responses: Array<{
    derivedScores: AiReadinessDerivedScores;
    pseudonymousId: string;
  }>;
  aggregationThreshold: number;
}): AiReadinessDashboard {
  const responseScores = params.responses.map((response) => response.derivedScores);
  const aggregate = (scores: AiReadinessDerivedScores[]) => {
    const pillarScores: Record<string, number | null> = {};
    const sectionScores: Record<string, number | null> = {};
    for (const pillar of params.template.pillars) {
      pillarScores[pillar.id] = roundScore(
        weightedAverage(scores.map((score) => ({ value: score.pillarScores[pillar.id], weight: 1 })))
      );
    }
    for (const section of params.template.sections) {
      sectionScores[section.id] = roundScore(
        weightedAverage(scores.map((score) => ({ value: score.sectionScores[section.id], weight: 1 })))
      );
    }
    const overallScore = roundScore(
      weightedAverage(scores.map((score) => ({ value: score.readinessIndex, weight: 1 })))
    );
    const validPillars = Object.entries(pillarScores).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && Number.isFinite(entry[1])
    );
    const bottleneck = validPillars.reduce<[string | null, number | null]>(
      (current, next) =>
        current[1] == null || next[1] < current[1] ? [next[0], next[1]] : current,
      [null, null]
    );
    return {
      pillarScores,
      sectionScores,
      overallScore,
      bottleneckPillar: bottleneck[0],
      confidence:
        roundScore(
          weightedAverage(scores.map((score) => ({ value: score.confidence, weight: 1 })))
        ) ?? 0,
    };
  };

  const company = aggregate(responseScores);
  const statusCount = (status: string) =>
    params.respondents.filter((respondent) => respondent.inviteStatus === status).length;
  const units = new Map<string, string[]>();
  for (const respondent of params.respondents) {
    const unit = respondent.organizationUnit?.trim() || "Non specificata";
    const ids = units.get(unit) ?? [];
    units.set(unit, ids);
  }
  const responseByPseudo = new Map(
    params.responses.map((response) => [response.pseudonymousId, response.derivedScores])
  );

  return {
    responseCount: params.responses.length,
    invitedCount: params.respondents.length,
    startedCount: statusCount("started") + statusCount("completed"),
    completedCount: statusCount("completed"),
    overallScore: company.overallScore,
    bottleneckPillar: company.bottleneckPillar,
    confidence: company.confidence,
    aggregationThresholdMet: params.responses.length >= params.aggregationThreshold,
    pillarScores: company.pillarScores,
    sectionScores: company.sectionScores,
    units: [...units.keys()].sort().map((unit) => {
      const respondentPseudos = params.respondents
        .filter((respondent) => (respondent.organizationUnit?.trim() || "Non specificata") === unit)
        .map((respondent) => respondent.pseudonymousId);
      const scores = respondentPseudos
        .map((id) => responseByPseudo.get(id))
        .filter((score): score is AiReadinessDerivedScores => Boolean(score));
      const thresholdMet = scores.length >= params.aggregationThreshold;
      const unitAggregate = thresholdMet ? aggregate(scores) : null;
      return {
        unit,
        respondentCount: scores.length,
        aggregationThresholdMet: thresholdMet,
        overallScore: unitAggregate?.overallScore ?? null,
        bottleneckPillar: unitAggregate?.bottleneckPillar ?? null,
        pillarScores: unitAggregate?.pillarScores ?? {},
      };
    }),
  };
}
