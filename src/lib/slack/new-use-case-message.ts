/**
 * Testo del messaggio al canale admin Slack per un nuovo contributo del
 * portafoglio. Tutti i testi scritti dagli utenti passano da escapeSlackText.
 * Modulo puro: lo usa notifyNewUseCase e lo provano i test con Node.
 */
import type { UseCase } from "@/lib/db/schema";
import { escapeSlackText } from "../notifications/sanitize.ts";
import { SLACK_INTAKE_SOURCE } from "./use-case-payload.ts";

/** ID utente Slack (U… o W…). */
const SLACK_USER_ID = /^[UW][A-Z0-9]{6,}$/;

function portfolioHeadline(useCase: Pick<UseCase, "portfolioKind">): string {
  if (useCase.portfolioKind === "best_practice") {
    return "Nuova best practice proposta :white_check_mark:";
  }
  if (useCase.portfolioKind === "use_case_ai") {
    return "Nuovo use case AI proposto :sparkles:";
  }
  return "Nuovo contributo portfolio proposto :sparkles:";
}

export function buildNewUseCaseSlackText(params: {
  useCase: Pick<
    UseCase,
    | "portfolioKind"
    | "title"
    | "description"
    | "proposedBy"
    | "source"
    | "status"
    | "overallScore"
    | "overallImpactScore"
    | "overallFeasibilityScore"
    | "overallEsgScore"
  >;
  teamName: string;
  detailUrl: string | null;
}) {
  const { useCase, teamName, detailUrl } = params;

  // Menzione `<@…>` solo per lo Slack intake, dove proposedBy è l'ID Slack di chi ha
  // compilato. Da ogni altra fonte (REST, connettore, web) proposedBy è dichiarato
  // da chi invia: si mostra come testo, anche se somiglia a un ID Slack.
  const proposer =
    useCase.source === SLACK_INTAKE_SOURCE && useCase.proposedBy && SLACK_USER_ID.test(useCase.proposedBy)
      ? `<@${useCase.proposedBy}>`
      : escapeSlackText(useCase.proposedBy ?? "Contributore");

  const excerpt = useCase.description
    ? useCase.description.slice(0, 200) + (useCase.description.length > 200 ? "…" : "")
    : "Nessuna descrizione";

  const lines = [
    portfolioHeadline(useCase),
    "",
    escapeSlackText(useCase.title),
    excerpt ? `Anteprima: ${escapeSlackText(excerpt)}` : "Anteprima: —",
    "",
    `Compilato da: ${proposer}`,
    `Stato in Unbundle: ${escapeSlackText(useCase.status)} (in coda al team ${escapeSlackText(teamName)}).`,
  ];

  if (typeof useCase.overallScore === "number" && useCase.overallScore > 0) {
    lines.push(
      `Ranking AI iniziale: score ${useCase.overallScore.toFixed(2)} · impact ${useCase.overallImpactScore?.toFixed(1) ?? "-"} · feasibility ${useCase.overallFeasibilityScore?.toFixed(1) ?? "-"}${typeof useCase.overallEsgScore === "number" ? ` · esg ${useCase.overallEsgScore.toFixed(1)}` : ""}`
    );
  }

  if (detailUrl) {
    lines.push("", `Apri in Unbundle: ${detailUrl}`);
  } else {
    lines.push(
      "",
      "Per il link diretto alla scheda, configura NEXT_PUBLIC_APP_URL sul server."
    );
  }

  return lines.join("\n");
}
