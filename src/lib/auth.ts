import { cookies } from "next/headers";
import { cache } from "react";
import { adminAuth } from "@/lib/firebase/admin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { SESSION_COOKIE_NAME } from "@/lib/auth/session-signal";

const SESSION_COOKIE = SESSION_COOKIE_NAME;
const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 giorni

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
  /** Firebase attesta che chi accede controlla la casella (Google, o link di verifica). */
  emailVerified: boolean;
}

export interface Session {
  user: SessionUser;
}

/**
 * Verifica la sessione Firebase e restituisce l'utente dal DB.
 * Crea l'utente nel DB se è il primo login (upsert).
 * Stessa firma di NextAuth `auth()` per compatibilità.
 */
export const auth = cache(async (): Promise<Session | null> => {
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;
  if (!sessionCookie) return null;

  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie, true);

    let [user] = await db
      .select()
      .from(users)
      .where(eq(users.firebaseUid, decoded.uid))
      .limit(1);

    if (!user) {
      const email = decoded.email ?? `${decoded.uid}@firebase.local`;

      // onConflictDoNothing e non DoUpdate: la riga esistente non va mai
      // sovrascritta a scatola chiusa. Vedi sotto.
      const [inserted] = await db
        .insert(users)
        .values({
          firebaseUid: decoded.uid,
          email,
          name: decoded.name ?? decoded.email?.split("@")[0] ?? null,
          image: decoded.picture ?? null,
          emailVerified: decoded.email_verified ? new Date() : null,
        })
        .onConflictDoNothing({ target: users.email })
        .returning();

      if (inserted) {
        user = inserted;
      } else {
        // L'email e' gia' registrata su un altro account Firebase.
        //
        // Qui stava una presa di controllo dell'account: un
        // `onConflictDoUpdate` ricollegava la riga `users` esistente al nuovo
        // firebaseUid e la restituiva, cosi' chi si registrava con l'email di
        // un altro ne ereditava id, membership di organizzazione e grant del
        // modulo formazione. Con l'iscrizione libera da link, bastava
        // conoscere un indirizzo — e il modulo mostra ai partecipanti nome ed
        // email dei revisori.
        //
        // Il cambio di provider legittimo (prima email e password, poi Google
        // sullo stesso indirizzo) si riconosce da una cosa sola: Firebase
        // attesta che chi accede controlla davvero quella casella. Senza
        // quell'attestazione si rifiuta e non si restituisce sessione.
        const [existing] = await db
          .select()
          .from(users)
          .where(eq(users.email, email))
          .limit(1);

        if (!existing) return null;

        if (existing.firebaseUid === decoded.uid) {
          user = existing;
        } else if (!decoded.email_verified) {
          console.warn(
            `[auth] Accesso rifiutato: ${email} e' gia' registrata su un altro account e questo accesso non ha l'email verificata.`
          );
          return null;
        } else {
          [user] = await db
            .update(users)
            .set({
              firebaseUid: decoded.uid,
              emailVerified: new Date(),
              name: decoded.name ?? existing.name,
              image: decoded.picture ?? existing.image,
            })
            .where(eq(users.id, existing.id))
            .returning();
        }
      }
    }

    // Firebase attesta la casella del proprio account, che può essere
    // cambiata dopo la registrazione: la verifica vale per l'email di
    // Unbundle solo se è la stessa. Arriva anche dopo (link nella mail): il
    // cookie rinnovato la porta, e la riga utente la registra una volta.
    const sameEmail = (decoded.email ?? "").trim().toLowerCase() === user.email.trim().toLowerCase();
    const verifiedNow = decoded.email_verified === true && sameEmail;
    if (verifiedNow && !user.emailVerified) {
      await db.update(users).set({ emailVerified: new Date() }).where(eq(users.id, user.id)).catch(() => undefined);
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
        emailVerified: verifiedNow || (sameEmail && user.emailVerified != null),
      },
    };
  } catch {
    return null;
  }
});

export async function createSessionCookie(idToken: string): Promise<string> {
  const sessionCookie = await adminAuth.createSessionCookie(idToken, {
    expiresIn: SESSION_MAX_AGE * 1000,
  });
  return sessionCookie;
}

export async function revokeSession(sessionCookie: string): Promise<void> {
  try {
    const decoded = await adminAuth.verifySessionCookie(sessionCookie);
    await adminAuth.revokeRefreshTokens(decoded.uid);
  } catch {
    // cookie invalido o già scaduto — ignora
  }
}

export { SESSION_COOKIE, SESSION_MAX_AGE };
