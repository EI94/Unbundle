import { readableFlowData, readableOtherData, stepTechKeys, type ProcessStepView, type SolutionNodeView } from "@/lib/uc/views/map";
import { SOLUTION_TEXT as T } from "@/lib/uc/views/solution";
import type { Audience } from "@/lib/uc/views/status-groups";
import type { CaseRole } from "@/lib/uc/vocab";
import { StepItems, StepKeysDetails } from "./map-parts";

/**
 * (Rilascio 10, §3.5, F-087, F-089) Il pannello di un passo di «Come funziona» (`?apri=passo-<id>`), in sola lettura:
 * chi lo fa, con che cosa e quanto tempo, l'attrito, che cosa entra e che cosa esce, la decisione della persona e le
 * domande del passo con il loro puntino (un link per chi le apre). Per Lateral Space le chiavi citate senza un titolo
 * restano nei «Dettagli tecnici». Le parole della mappa arrivano già pulite per chi guarda (`buildMaps`).
 */
export function StepPanelContent({
  workspaceId,
  caseId,
  step,
  titles,
  audience,
  roles,
}: {
  workspaceId: string;
  caseId: string;
  step: ProcessStepView | SolutionNodeView;
  /** Titoli delle domande per chiave (`mapItemTitles`): ciò che entra ed esce si legge con i titoli. */
  titles: ReadonlyMap<string, string>;
  audience: Audience;
  roles: readonly CaseRole[];
}) {
  const process = "humanDecision" in step ? step : null;
  const facts: [string, string][] = [];
  if (step.who) facts.push([T.stepPanelWho, step.who]);
  if (process?.tool) facts.push([T.stepPanelTool, process.tool]);
  if (process?.time) facts.push([T.stepPanelTime, process.time]);
  const input = readableFlowData(step.input, titles, audience);
  const output = readableFlowData(step.output, titles, audience);
  const other = process ? readableOtherData(process.otherData, audience) : [];
  const hasQuestions = step.items.some((i) => i.status !== null) || other.length > 0;
  const keys = stepTechKeys(step.items, process ? process.otherData : [...step.input, ...step.output], titles);
  return (
    <div data-slot="step-panel" className="min-w-0 space-y-4 text-sm">
      {"description" in step && step.description ? <p className="break-words whitespace-pre-line">{step.description}</p> : null}
      {facts.length ? (
        <dl className="grid min-w-0 gap-2">
          {facts.map(([label, value]) => (
            <div key={label} className="min-w-0">
              <dt className="text-xs text-muted-foreground">{label}</dt>
              <dd className="break-words">{value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {process?.friction ? (
        <p className="break-words">
          <span className="font-medium">{T.friction}:</span> {process.friction}
        </p>
      ) : null}
      {input.length || output.length ? (
        <p className="text-xs break-words text-muted-foreground">
          {[input.length ? `${T.enters}: ${input.join(", ")}` : null, output.length ? `${T.exits}: ${output.join(", ")}` : null].filter(Boolean).join(" · ")}
        </p>
      ) : null}
      {process?.humanDecision ? (
        <p className="break-words">
          <span className="font-medium">
            <span aria-hidden>◆ </span>
            {T.decidesWhat}:
          </span>{" "}
          {process.humanDecision}
        </p>
      ) : null}
      <section aria-label={T.questions} className="min-w-0 space-y-2">
        <h3 className="text-sm font-semibold">{T.questions}</h3>
        {hasQuestions ? <StepItems workspaceId={workspaceId} caseId={caseId} items={step.items} otherData={other} audience={audience} /> : <p className="text-muted-foreground">{T.noQuestions}</p>}
      </section>
      <StepKeysDetails roles={roles} steps={[{ n: null, label: step.label, keys }]} />
    </div>
  );
}
