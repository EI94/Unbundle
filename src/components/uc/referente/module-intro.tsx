"use client";

import { Button } from "@/components/ui/button";
import { questionsAndMinutes, referentHash, type TopicPlan } from "@/lib/uc/views/referente-plan";
import { R_TEXT } from "@/lib/uc/views/referente-text";
import { BackLink, Disclosure, PRIMARY_CLASS, ScreenTitle, TEXT_BUTTON_CLASS } from "./screen";

/**
 * R1b · Inizio di un argomento (DESIGN §4.3): compare solo la prima volta e
 * solo se l'argomento ha un perché o delle istruzioni. Il perché in al massimo
 * tre righe, quante domande e quanto tempo, «Inizia» e, come pulsante
 * testuale, «Gira tutto l'argomento a un'altra persona» (rilascio 10, §4.1).
 */
export function ModuleIntro({
  topic,
  delegateItemId,
  onStart,
}: {
  topic: TopicPlan;
  /** La prima domanda dell'argomento che si può girare a un collega (R5 parte da lei), oppure null. */
  delegateItemId: string | null;
  onStart: () => void;
}) {
  return (
    <section aria-labelledby="uc-r-titolo" className="mt-2 space-y-5">
      <BackLink href={referentHash({ screen: "home" })}>{R_TEXT.step.back}</BackLink>
      <ScreenTitle>{topic.title}</ScreenTitle>
      {topic.why ? <p className="line-clamp-3 text-base leading-6 break-words">{topic.why}</p> : null}
      <p className="text-base text-muted-foreground">{questionsAndMinutes(topic.steps.length, topic.minutes)}</p>
      {topic.instructions ? (
        <Disclosure summary={R_TEXT.intro.instructions}>
          <p className="text-base leading-6 break-words whitespace-pre-line text-muted-foreground">{topic.instructions}</p>
        </Disclosure>
      ) : null}
      <div className="space-y-2">
        <Button type="button" className={PRIMARY_CLASS} onClick={onStart} disabled={topic.steps.length === 0}>
          {R_TEXT.intro.start}
        </Button>
        {delegateItemId ? (
          <div>
            <Button variant="ghost" className={TEXT_BUTTON_CLASS} render={<a href={referentHash({ screen: "collega", itemId: delegateItemId, wholeTopic: true })} />} nativeButton={false}>
              {R_TEXT.intro.delegateTopic}
            </Button>
          </div>
        ) : null}
      </div>
    </section>
  );
}
