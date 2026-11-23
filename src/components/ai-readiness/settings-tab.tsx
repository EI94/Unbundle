import { READINESS_TEXT } from "@/lib/ai-readiness/dashboard-text";
import { READINESS_ANCHORS } from "@/lib/ai-readiness/dashboard-view";
import { Fold } from "@/components/ui-10/fold";
import { ShowAll } from "./show-all";
import { ThresholdForm } from "./threshold-form";

const S = READINESS_TEXT.settings;

export interface SettingsTabProps {
  workspaceId: string;
  assessmentId: string;
  manages: boolean;
  threshold: number;
  /** La soglia più bassa che si può scegliere: 3 senza nome e cognome, 1 con nome e cognome. */
  minThreshold: number;
  expected: number | null;
  anonymous: boolean;
  controller: string;
  exports: ReadonlyArray<{ id: string; label: string; when: string; personal: boolean }>;
}

/**
 * «Impostazioni» (rilascio 10, ondata 7b, §3.9; audit «Fuori» AD-7, §7.5): la soglia e le risposte attese (due campi
 * etichettati, a chi gestisce; agli altri le due cifre), la privacy in italiano detta una volta e con calma, la
 * cronologia dei file scaricati in una piega chiusa.
 */
export function SettingsTab(p: SettingsTabProps) {
  return (
    <div className="space-y-8" data-slot="readiness-settings">
      <section id={READINESS_ANCHORS.threshold} aria-labelledby="soglia-titolo" className="scroll-mt-20 space-y-3">
        <h2 id="soglia-titolo" className="text-base font-semibold">
          {S.thresholdTitle}
        </h2>
        {p.manages ? (
          <ThresholdForm workspaceId={p.workspaceId} assessmentId={p.assessmentId} current={p.threshold} min={p.minThreshold} expectedRespondents={p.expected} />
        ) : (
          <p className="text-sm text-muted-foreground">{[S.readThreshold(p.threshold), p.expected ? S.readExpected(p.expected) : null].filter(Boolean).join(" · ")}</p>
        )}
      </section>

      <section id={READINESS_ANCHORS.privacy} aria-labelledby="privacy-titolo" className="scroll-mt-20 space-y-2">
        <h2 id="privacy-titolo" className="text-base font-semibold">
          {S.privacyTitle}
        </h2>
        <p className="text-sm">{S.privacyBody(p.threshold)}</p>
        <p className="text-sm text-muted-foreground">{[p.anonymous ? S.anonymous : S.named, S.controller(p.controller)].join(" · ")}</p>
      </section>

      {p.exports.length ? (
        <div>
          <Fold id={READINESS_ANCHORS.exports} title={S.exportsTitle} summary={S.exportsSummary(p.exports.length)}>
            <div className="mb-4 space-y-2">
              <ShowAll items={p.exports} visible={3}>
                {(item) => (
                  <p key={item.id} className="flex min-h-11 flex-wrap items-baseline justify-between gap-x-4 rounded-lg border px-4 py-2 text-sm sm:min-h-10">
                    <span className="font-medium">{item.label}</span>
                    <span className="text-muted-foreground">{[item.when, item.personal ? S.exportPersonal : S.exportAnonymous].join(" · ")}</span>
                  </p>
                )}
              </ShowAll>
            </div>
          </Fold>
        </div>
      ) : null}
    </div>
  );
}
