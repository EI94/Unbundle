export type AiReadinessPillarId =
  | "technology"
  | "context"
  | "workflow"
  | "adoption"
  | "use_cases";

export type AiReadinessQuestionType =
  | "scale"
  | "single_choice"
  | "multi_choice"
  | "text";

export type AiReadinessQuestion = {
  id: string;
  pillarId: AiReadinessPillarId;
  sectionId: string;
  label: string;
  description?: string;
  answerType: AiReadinessQuestionType;
  required?: boolean;
  min?: number;
  max?: number;
  weight?: number;
  options?: Array<{ value: string; label: string; score?: number }>;
};

export type AiReadinessSection = {
  id: string;
  pillarId: AiReadinessPillarId;
  title: string;
  description?: string;
};

export type AiReadinessPillar = {
  id: AiReadinessPillarId;
  title: string;
  description: string;
  weight: number;
};

export type AiReadinessScoringSchema = {
  version: string;
  scale: { min: number; max: number };
  readinessFormula: {
    weightedAverageWeight: number;
    weakestPillarWeight: number;
  };
};

export type AiReadinessTemplateDefinition = {
  pillars: AiReadinessPillar[];
  sections: AiReadinessSection[];
  questions: AiReadinessQuestion[];
  scoringSchema: AiReadinessScoringSchema;
};

export type AiReadinessAnswer = {
  questionId: string;
  value: string | number | string[] | null;
  answerType: AiReadinessQuestionType;
  sectionId: string;
  pillarId: AiReadinessPillarId;
  answeredAt: string;
};

export type AiReadinessDerivedScores = {
  scoringVersion: string;
  pillarScores: Record<string, number | null>;
  sectionScores: Record<string, number | null>;
  weightedAverage: number | null;
  weakestPillarScore: number | null;
  readinessIndex: number | null;
  bottleneckPillar: string | null;
  confidence: number;
  answeredScoredQuestions: number;
  totalScoredQuestions: number;
};

export type AiReadinessMaturityLevel = {
  level: number;
  label: string;
  description: string;
};

export type AiReadinessDashboard = {
  responseCount: number;
  invitedCount: number;
  startedCount: number;
  completedCount: number;
  overallScore: number | null;
  bottleneckPillar: string | null;
  confidence: number;
  aggregationThresholdMet: boolean;
  pillarScores: Record<string, number | null>;
  sectionScores: Record<string, number | null>;
  units: Array<{
    unit: string;
    respondentCount: number;
    aggregationThresholdMet: boolean;
    overallScore: number | null;
    bottleneckPillar: string | null;
    pillarScores: Record<string, number | null>;
  }>;
};

export type AiReadinessInsightType =
  | "executive_summary"
  | "bottleneck"
  | "risk"
  | "opportunity"
  | "roadmap"
  | "adoption"
  | "use_case"
  | "benchmark";

export type AiReadinessInsightValidationStatus =
  | "draft"
  | "reviewed"
  | "approved"
  | "rejected";

export type AiReadinessUseCaseCluster = {
  id: string;
  label: string;
  description: string;
  count: number;
  titles: string[];
  averageFeasibility: number | null;
  averageStrategicValue: number | null;
  recommendedPath: "quick_win" | "capability_builder" | "strategic_bet";
};

export type AiReadinessRoadmapWave = {
  id: string;
  title: string;
  horizon: string;
  focus: string;
  actions: string[];
  successMetric: string;
  linkedClusterIds: string[];
};

export type AiReadinessBenchmarkComparison = {
  enabled: boolean;
  reason?: string;
  referenceName: string;
  overallDelta: number | null;
  pillarDeltas: Record<string, number | null>;
};
