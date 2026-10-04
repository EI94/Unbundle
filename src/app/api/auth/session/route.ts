import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  createSessionCookie,
  revokeSession,
  SESSION_COOKIE,
  SESSION_MAX_AGE,
} from "@/lib/auth";

/**
 * Solo dal sito stesso. Un'altra pagina potrebbe altrimenti postare qui un
 * token del proprio account e far trovare la vittima collegata come
 * l'attaccante (login CSRF): l'invito accettato subito dopo finirebbe al suo
 * account. Un modulo cross-site non può mandare Content-Type JSON senza
 * preflight, e il browser mette sempre Origin sulle POST.
 */
function fromThisSite(req: Request) {
  const origin = req.headers.get("origin");
  if (!origin) return req.headers.get("sec-fetch-site") === "same-origin";
  try {
    const originHost = new URL(origin).host;
    // Stesso host della richiesta (il protocollo interno dietro il proxy di
    // Vercel può essere http: si confronta l'host), oppure l'indirizzo
    // pubblico configurato.
    if (originHost === req.headers.get("host")) return true;
    const configured = process.env.NEXT_PUBLIC_APP_URL?.trim();
    return Boolean(configured) && new URL(configured!.startsWith("http") ? configured! : `https://${configured}`).host === originHost;
  } catch {
    return false;
  }
}

export async function POST(req: Request) {
  if (!fromThisSite(req) || !req.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Richiesta non autorizzata." }, { status: 403 });
  }
  try {
    const { idToken } = (await req.json()) as { idToken?: string };
    if (!idToken) {
      return NextResponse.json({ error: "idToken mancante" }, { status: 400 });
    }

    const sessionCookie = await createSessionCookie(idToken);

    const cookieStore = await cookies();
    cookieStore.set(SESSION_COOKIE, sessionCookie, {
      maxAge: SESSION_MAX_AGE,
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      path: "/",
      sameSite: "lax",
    });

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Errore sessione";
    return NextResponse.json({ error: message }, { status: 401 });
  }
}

export async function DELETE(req: Request) {
  if (!fromThisSite(req)) {
    return NextResponse.json({ error: "Richiesta non autorizzata." }, { status: 403 });
  }
  const cookieStore = await cookies();
  const sessionCookie = cookieStore.get(SESSION_COOKIE)?.value;

  if (sessionCookie) {
    await revokeSession(sessionCookie);
  }

  cookieStore.delete(SESSION_COOKIE);
  return NextResponse.json({ ok: true });
}
