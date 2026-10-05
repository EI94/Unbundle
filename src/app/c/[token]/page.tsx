import type { Metadata } from "next";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { redirect } from "next/navigation";
import { findEnrolledCourseByToken, getJoinPreview, type JoinUnusableReason } from "@/lib/learning/join";
import { participantNotice } from "@/lib/learning/register-legal";
import { learningEnabled } from "@/lib/learning/server";
import { JoinCourseForm } from "@/components/learning/join-course-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

export const dynamic = "force-dynamic";

/**
 * Pagina pubblica del link di corso: l'unica schermata fra la chat del
 * formatore e il corso.
 *
 * Rotta di primo livello, fuori da /dashboard: l'area del workspace richiede
 * una membership, che qui per definizione non c'è ancora.
 */

function dateLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("it-IT", {
    weekday: "long",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

function timeLabel(iso: string, timezone: string) {
  return new Intl.DateTimeFormat("it-IT", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: timezone,
  }).format(new Date(iso));
}

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
  const title = card ? `${card.programTitle} — ${card.workspaceName}` : "Accesso al corso";
  const description = card
    ? `${card.moduleTitle ?? "Lezione"} · ${dateLabel(card.startsAt, card.timezone)}. Entra con il tuo account: bastano pochi secondi.`
    : "Link di accesso a un corso.";
  return {
    title,
    description,
    robots: { index: false, follow: false, nocache: true },
    openGraph: { title, description, type: "website" },
    twitter: { card: "summary", title, description },
  };
}

const UNUSABLE: Record<JoinUnusableReason, { title: string; body: string }> = {
  not_found: {
    title: "Link non valido",
    body: "Questo indirizzo non corrisponde a nessuna lezione. Controlla di averlo copiato per intero, oppure chiedi al formatore di rimandartelo.",
  },
  revoked: {
    title: "Link disattivato",
    body: "Il formatore ha disattivato questo link. Chiedigli quello nuovo: chi era già entrato mantiene l'accesso.",
  },
  expired: {
    title: "Link scaduto",
    body: "Questo link non è più valido. Chiedi al formatore di rigenerarlo, serve un istante.",
  },
  door_closed: {
    title: "Iscrizioni non ancora aperte",
    body: "Il link è quello giusto: il formatore apre le iscrizioni all'inizio dell'incontro. Tienilo da parte e riaprilo quando te lo dice.",
  },
  course_unavailable: {
    title: "Corso non ancora disponibile",
    body: "Il corso non è stato ancora reso visibile. Riprova più tardi oppure avvisa il formatore.",
  },
  full: {
    title: "Posti esauriti",
    body: "I posti di questo link sono finiti. Chiedi al formatore di aggiungerne o di darti un link diverso: nessuno dei tuoi dati è andato perso.",
  },
};

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main
      id="course-join-root"
      className="min-h-screen bg-background px-4 py-10 text-foreground sm:px-6"
    >
      <div className="mx-auto w-full max-w-xl space-y-6">
        <Link href="/" className="text-sm font-semibold tracking-wide">
          Unbundle
        </Link>
        {children}
      </div>
    </main>
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
      <Shell>
        <Card className="rounded-[28px]">
          <CardHeader>
            <CardTitle>Corso non disponibile</CardTitle>
          </CardHeader>
          <CardContent className="text-sm leading-6 text-muted-foreground">
            La formazione non è attiva in questo ambiente. Avvisa il formatore.
          </CardContent>
        </Card>
      </Shell>
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
    const copy = UNUSABLE[preview.reason];
    return (
      <Shell>
        <Card className="rounded-[28px]" data-testid="join-unusable">
          <CardHeader>
            {preview.course && (
              <div className="mb-2 space-y-1">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{preview.course.workspaceName}</p>
                <p className="text-lg font-semibold">{preview.course.programTitle}</p>
                <p className="text-sm text-muted-foreground">
                  {preview.course.moduleTitle ?? "Lezione"} · {dateLabel(preview.course.startsAt, preview.course.timezone)}
                  {" – "}{timeLabel(preview.course.endsAt, preview.course.timezone)}
                </p>
              </div>
            )}
            <CardTitle>{copy.title}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4 text-sm leading-6 text-muted-foreground">
            <p>{copy.body}</p>
            {preview.reason === "door_closed" && (
              <p className="text-foreground">
                Questa pagina non si aggiorna da sola: ricaricala quando il
                formatore dà il via.
              </p>
            )}
            {returning && !viewer?.user?.id && (
              <p className="text-foreground">
                Sei già entrato nel corso?{" "}
                <Link
                  className="font-medium underline underline-offset-4"
                  href={`/login?callbackUrl=${encodeURIComponent(`/c/${token}`)}`}
                  data-testid="join-returning-login"
                >
                  Accedi e torni al corso
                </Link>
                , anche per fare gli esercizi.
              </p>
            )}
          </CardContent>
        </Card>
      </Shell>
    );
  }

  const session = await auth();
  const signedInAs =
    session?.user?.id && session.user.email
      ? { name: session.user.name ?? null, email: session.user.email }
      : null;

  const minutes = preview.durationMinutes;

  return (
    <Shell>
      <Card className="rounded-[28px] border-emerald-500/25 bg-linear-to-br from-emerald-500/8 via-card to-sky-500/8">
        <CardHeader className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <Badge variant="secondary">Formazione</Badge>
            <Badge variant="outline">{preview.workspaceName}</Badge>
            {minutes ? <Badge variant="outline">~{minutes} minuti</Badge> : null}
          </div>
          <CardTitle className="text-2xl leading-tight">
            {preview.programTitle}
          </CardTitle>
          <div className="space-y-1 text-sm">
            <p className="font-medium text-foreground">
              {preview.moduleTitle ?? "Lezione"}
            </p>
            <p className="text-muted-foreground">
              {dateLabel(preview.startsAt, preview.timezone)}
              {" – "}
              {timeLabel(preview.endsAt, preview.timezone)}
            </p>
            {preview.trainerName && (
              <p className="text-muted-foreground">
                Formatore: {preview.trainerName}
              </p>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          <div className="rounded-2xl border bg-background/70 p-4 text-xs leading-5 text-muted-foreground">
            <p className="text-sm font-medium text-foreground">
              Cosa vedi e cosa vede il formatore
            </p>
            <ul className="mt-2 space-y-1.5">
              <li>
                Questo accesso ti mostra <strong className="text-foreground">solo questo corso</strong>,
                nessun&apos;altra area dell&apos;azienda.
              </li>
              <li>
                Il formatore vede le tue risposte alle attività del corso e il
                tuo avanzamento. Le viste di gruppo partono da 5 persone, così
                nessun risultato è riconducibile a te.
              </li>
              <li>
                Le risposte restano conservate per {preview.retentionDays}{" "}
                {preview.retentionDays === 1 ? "giorno" : "giorni"}, poi vengono
                eliminate.
              </li>
              <li>
                {participantNotice}
              </li>
            </ul>
          </div>

          <JoinCourseForm
            token={token}
            signedInAs={signedInAs}
            courseTitle={preview.programTitle}
          />
        </CardContent>
      </Card>

      <p className="px-2 text-center text-xs text-muted-foreground">
        Hai problemi a entrare? Scrivi al formatore
        {preview.trainerName ? ` (${preview.trainerName})` : ""}: può rigenerare
        il link in un istante.
      </p>
    </Shell>
  );
}
