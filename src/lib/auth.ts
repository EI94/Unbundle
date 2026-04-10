import { cookies } from "next/headers";
import { adminAuth } from "@/lib/firebase/admin";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { eq } from "drizzle-orm";

const SESSION_COOKIE = "__session";
const SESSION_MAX_AGE = 60 * 60 * 24 * 14; // 14 giorni

export interface SessionUser {
  id: string;
  name: string | null;
  email: string;
  image: string | null;
}

export interface Session {
  user: SessionUser;
}

/**
 * Verifica la sessione Firebase e restituisce l'utente dal DB.
 * Crea l'utente nel DB se è il primo login (upsert).
 * Stessa firma di NextAuth `auth()` per compatibilità.
 */
export async function auth(): Promise<Session | null> {
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
      [user] = await db
        .insert(users)
        .values({
          firebaseUid: decoded.uid,
          email: decoded.email ?? `${decoded.uid}@firebase.local`,
          name: decoded.name ?? decoded.email?.split("@")[0] ?? null,
          image: decoded.picture ?? null,
          emailVerified: decoded.email_verified ? new Date() : null,
        })
        .onConflictDoUpdate({
          target: users.email,
          set: {
            firebaseUid: decoded.uid,
            name: decoded.name ?? undefined,
            image: decoded.picture ?? undefined,
          },
        })
        .returning();
    }

    return {
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        image: user.image,
      },
    };
  } catch {
    return null;
  }
}

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
