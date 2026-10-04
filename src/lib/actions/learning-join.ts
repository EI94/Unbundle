"use server";

import { auth } from "@/lib/auth";
import {
  joinCourseByLink,
  requestCohortReopen,
  type JoinOutcome,
} from "@/lib/learning/join";
import { learningEnabled } from "@/lib/learning/server";

/**
 * Iscrizione a una lezione da link pubblico.
 *
 * L'effetto vive in una POST e non in una GET: i client di chat prefetchano i
 * link che ricevono, e una GET che iscrive farebbe entrare le persone prima
 * che tocchino lo schermo. Per lo stesso motivo non esiste un bottone
 * «Accetta» su una pagina raggiunta per GET: si arriva qui dopo l'accesso.
 */

export type JoinActionState =
  | { status: "idle" }
  | { status: "done"; outcome: JoinOutcome; path: string; previousCohortId: string | null }
  | { status: "error"; message: string; canRetry: boolean };

const MESSAGES: Record<string, string> = {
  not_found: "Questo link non è valido. Chiedi al formatore di rimandartelo.",
  revoked: "Questo link è stato disattivato dal formatore. Chiedigli quello nuovo.",
  expired: "Questo link è scaduto. Chiedi al formatore di rigenerarlo.",
  door_closed:
    "Le iscrizioni a questa lezione non sono aperte in questo momento. Il formatore le apre all'inizio dell'incontro.",
  course_unavailable:
    "Il corso non è ancora disponibile. Riprova più tardi o avvisa il formatore.",
  full: "I posti di questo link sono esauriti. Chiedi al formatore di aggiungerne o di darti un altro link.",
  suspended:
    "La tua iscrizione a questo corso è sospesa. Parlane con il formatore: un link non può riattivarla.",
  unknown:
    "Non è stato possibile completare l'iscrizione. Riprova: se continua, avvisa il formatore.",
};

/** I motivi per cui vale la pena che la persona riprovi da sola. */
const RETRYABLE = new Set(["unknown", "door_closed", "course_unavailable"]);

export async function joinCourseByLinkAction(
  token: string
): Promise<JoinActionState> {
  if (!learningEnabled()) {
    return {
      status: "error",
      message: MESSAGES.course_unavailable,
      canRetry: false,
    };
  }

  const session = await auth();
  if (!session?.user?.id || !session.user.email) {
    return {
      status: "error",
      message: "Accesso non riuscito. Riprova ad accedere dalla pagina del corso.",
      canRetry: true,
    };
  }

  const result = await joinCourseByLink({
    token,
    userId: session.user.id,
    email: session.user.email,
  });

  if (!result.ok) {
    return {
      status: "error",
      message: MESSAGES[result.reason] ?? MESSAGES.unknown,
      canRetry: RETRYABLE.has(result.reason),
    };
  }

  // Si atterra sul modulo, non sulla home della formazione: e' il primo
  // contenuto vero e non costa un'altra scelta alla persona.
  const path = `/dashboard/${result.workspaceId}/learning/${result.programId}/${result.moduleId}?joined=1&outcome=${result.outcome}`;

  return {
    status: "done",
    outcome: result.outcome,
    path,
    previousCohortId: result.previousCohortId,
  };
}

/** Richiesta di riapertura del proprio turno, per chi ha già del lavoro salvato. */
export async function requestCohortReopenAction(
  token: string
): Promise<{ ok: boolean; message: string }> {
  const session = await auth();
  if (!session?.user?.id) {
    return { ok: false, message: "Accedi di nuovo e riprova." };
  }
  const result = await requestCohortReopen({ token, userId: session.user.id });
  return result.ok
    ? {
        ok: true,
        message:
          "Richiesta inviata. Il formatore la vede nella sua console: appena riapre il turno puoi rispondere.",
      }
    : {
        ok: false,
        message:
          "La richiesta era già stata inviata, oppure non serve. Parla con il formatore.",
      };
}
