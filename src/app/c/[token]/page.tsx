import type { Metadata } from "next";
import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { findEnrolledCourseByToken, getJoinPreview, type JoinCourseCard, type JoinUnusableReason } from "@/lib/learning/join";
import { participantNotice } from "@/lib/learning/register-legal";
import { RESULTS_MINIMUM_GROUP } from "@/lib/learning/results";
import { learningEnabled } from "@/lib/learning/server";
import { COURSE_LINK_TEXT, courseHelp, courseLine, courseRetention, courseWhen } from "@/lib/public/course";
import { fillPublic } from "@/lib/public/text";
import { JoinCourseForm } from "@/components/learning/join-course-form";
import { PublicFooterLine, PublicShell } from "@/components/public/public-shell";
import { PublicCard, PublicCardText, PublicStateCard } from "@/components/public/state-card";
import { PUBLIC_LINK } from "@/components/public/classes";
import { Fold } from "@/components/ui-10/fold";
import { DoorWatch } from "./door-watch";

export const dynamic = "force-dynamic";

const T = COURSE_LINK_TEXT;

/**
 * Pagina pubblica del link di corso: l'unica schermata fra la chat del
 * formatore e il corso.
 *
 * Rotta di primo livello, fuori da /dashboard: l'area del workspace richiede
 * una membership, che qui per definizione non c'è ancora.
 *
 * (Rilascio 10, ondata 4, docs/ui-10/PROPOSTA-10.md §3.11, audit Fuori §3.7) Il guscio unico delle pagine pubbliche, chiaro
 * (layout della rotta): una card con H1 = il titolo del corso, la riga «Lunedì 24 novembre · 14:30–16:30 · con
 * {formatore}», un solo pulsante pieno («Entra con Google», con il link «Usa email e password»), la privacy in una frase e
 * «Cosa viene registrato ▸» chiusa. Con l'ingresso chiuso la pagina controlla da sola ogni 10 secondi (`DoorWatch`). Un
 * link che non vale ha la scheda unica, con il testo per chi l'ha avuto in chat; chi è già nel corso rientra anche con un
 * link chiuso. I testi stanno in `src/lib/public/course.ts`.
 */

/**
 * Anteprima quando il link viene incollato in WhatsApp, Teams o in una mail:
 * senza questa il primo contatto è una card di marketing del fornitore.
 * Resta noindex: è una scheda da chat, non una pagina da indicizzare.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ token: string }>;
}): Promise<Metadata> {
  const { token } = await params;
  const preview = learningEnabled() ? await getJoinPreview(token) : null;
  const card = preview ? (preview.ok ? preview : preview.course) : null;
  const title = card ? fillPublic(T.preview.title, { Corso: card.programTitle, Cliente: card.workspaceName }) : T.preview.fallbackTitle;
  const description = card
    ? fillPublic(T.preview.description, { Lezione: card.moduleTitle ?? T.preview.lesson, Quando: courseWhen(card.startsAt, card.endsAt, card.timezone) })
    : T.preview.fallbackDescription;
  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

/** I link che non valgono più: la scheda unica. */
const GONE: ReadonlySet<JoinUnusableReason> = new Set(["not_found", "revoked", "expired"]);

/** Il contatto in fondo: il formatore. */
function helpFooter(trainerName: string | null) {
  return <PublicFooterLine>{courseHelp(trainerName)}</PublicFooterLine>;
}

/** Chi è già nel corso rientra dallo stesso link, anche chiuso: gli esercizi si fanno anche dopo la lezione. */
function ReturningLine({ token }: { token: string }) {
  return (
    <p className="mt-4">
      {T.returning}{" "}
      <a className={PUBLIC_LINK} href={`/login?callbackUrl=${encodeURIComponent(`/c/${token}`)}`} data-testid="join-returning-login">
        {T.returningLink}
      </a>
    </p>
  );
}

/** Il titolo del corso e la riga della data: l'H1 della card. */
function CourseCard({ course, children }: { course: JoinCourseCard; children: ReactNode }) {
  return (
    <PublicCard title={course.programTitle} titleClassName="text-2xl tracking-tight">
      <p className="mt-2 text-muted-foreground" data-slot="course-when">
        {courseLine(course)}
      </p>
      {children}
    </PublicCard>
  );
}

export default async function CourseJoinPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  if (!learningEnabled()) {
    return (
      <PublicShell>
        <PublicCard title={T.disabled.title}>
          <PublicCardText>{T.disabled.body}</PublicCardText>
        </PublicCard>
      </PublicShell>
    );
  }

  const preview = await getJoinPreview(token);

  if (!preview.ok) {
    // Chi è già iscritto rientra nel corso dallo stesso link anche quando le
    // iscrizioni sono chiuse: gli esercizi si fanno anche dopo la lezione.
    const returning = preview.reason !== "not_found" && preview.reason !== "course_unavailable";
    const viewer = returning ? await auth() : null;
    if (viewer?.user?.id) {
      const enrolled = await findEnrolledCourseByToken(token, viewer.user.id);
      if (enrolled) redirect(`/dashboard/${enrolled.workspaceId}/learning/${enrolled.programId}`);
    }
    const course = preview.course;
    const comeBack = returning && !viewer?.user?.id ? <ReturningLine token={token} /> : null;
    const footer = helpFooter(course?.trainerName ?? null);

    if (GONE.has(preview.reason)) {
      const body = preview.reason === "not_found" ? T.notFound : course ? fillPublic(T.goneCourse, { Corso: course.programTitle }) : T.gone;
      return (
        <PublicShell client={course?.workspaceName} footer={footer}>
          <div data-testid="join-unusable" data-reason={preview.reason}>
            <PublicStateCard kind="link" body={body}>
              {comeBack}
            </PublicStateCard>
          </div>
        </PublicShell>
      );
    }

    if (preview.reason === "door_closed" && course) {
      return (
        <PublicShell client={course.workspaceName} footer={footer}>
          <div data-testid="join-unusable" data-reason="door_closed">
            <CourseCard course={course}>
              <p className="mt-5 font-medium" role="status" data-testid="join-waiting">
                {T.waiting}
              </p>
              {comeBack}
            </CourseCard>
          </div>
          <DoorWatch />
        </PublicShell>
      );
    }

    const state = preview.reason === "full" ? T.full : preview.reason === "door_closed" ? { title: T.closed, body: T.waiting } : T.unavailable;
    return (
      <PublicShell client={course?.workspaceName} footer={footer}>
        <div data-testid="join-unusable" data-reason={preview.reason}>
          {course ? (
            <CourseCard course={course}>
              <p className="mt-5 font-medium">{state.title}</p>
              <p className="mt-1 text-muted-foreground">{state.body}</p>
              {comeBack}
            </CourseCard>
          ) : (
            <PublicCard title={state.title}>
              <PublicCardText>{state.body}</PublicCardText>
              {comeBack}
            </PublicCard>
          )}
        </div>
        {preview.reason === "door_closed" ? <DoorWatch /> : null}
      </PublicShell>
    );
  }

  const session = await auth();
  const signedInAs =
    session?.user?.id && session.user.email
      ? { name: session.user.name ?? null, email: session.user.email }
      : null;

  return (
    <PublicShell client={preview.workspaceName} footer={helpFooter(preview.trainerName)}>
      <CourseCard course={preview}>
        <div className="mt-6">
          <JoinCourseForm token={token} signedInAs={signedInAs} />
        </div>
        <p className="mt-6 text-muted-foreground" data-testid="join-privacy">
          {T.privacy}
        </p>
        <Fold id="cosa-viene-registrato" title={T.recorded} className="mt-2 border-t-0 last:border-b-0">
          <ul className="space-y-2 text-muted-foreground">
            <li>{T.recordedOnlyThis}</li>
            <li>{fillPublic(T.recordedTrainer, { N: RESULTS_MINIMUM_GROUP })}</li>
            {/* (Ondata 0) La cancellazione la fa chi tiene il corso, dopo la chiusura: la frase vera. */}
            <li>{courseRetention(preview.retentionDays)}</li>
            <li>{participantNotice}</li>
          </ul>
        </Fold>
      </CourseCard>
    </PublicShell>
  );
}
