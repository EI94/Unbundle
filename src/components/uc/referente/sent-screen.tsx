"use client";

import { Button } from "@/components/ui/button";
import { questionsAndMinutes, referentHash, type TopicPlan } from "@/lib/uc/views/referente-plan";
import { PRIMARY_CLASS, ScreenTitle, TEXT_BUTTON_CLASS } from "./screen";

/**
 * R7 · Inviate (DESIGN §4.3): «Inviate. Grazie!» riceve il focus; poi il
 * prossimo argomento con «Continua», oppure «Basta per oggi».
 */
export function SentScreen({ next, nextHref }: { next: TopicPlan | null; nextHref: string | null }) {
  return (
    <section aria-labelledby="uc-r-titolo" className="mt-6 space-y-5">
      <ScreenTitle>Inviate. Grazie!</ScreenTitle>
      <p className="text-base leading-6">Lateral Space le controlla e ti scrive solo se serve un chiarimento.</p>
      {next && nextHref ? (
        <div className="space-y-3 rounded-xl bg-card p-4 ring-1 ring-foreground/10">
          <div className="space-y-1">
            <h2 className="text-lg leading-snug font-semibold break-words">Prossimo: {next.title}</h2>
            <p className="text-base text-muted-foreground">{questionsAndMinutes(next.steps.length - next.ready, next.minutes)}</p>
          </div>
          <Button className={PRIMARY_CLASS} render={<a href={nextHref} />} nativeButton={false}>
            Continua
          </Button>
        </div>
      ) : null}
      <div className="text-center sm:text-left">
        <Button variant="ghost" className={TEXT_BUTTON_CLASS} render={<a href={referentHash({ screen: "home" })} />} nativeButton={false}>
          Basta per oggi
        </Button>
      </div>
    </section>
  );
}
