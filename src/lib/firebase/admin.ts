import {
  initializeApp,
  getApps,
  cert,
  type ServiceAccount,
} from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { normalizeServiceAccountKey } from "./private-key.ts";

function getAdminApp() {
  if (getApps().length > 0) return getApps()[0];

  const projectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const clientEmail = process.env.FIREBASE_ADMIN_CLIENT_EMAIL;
  // Con o senza a capo, con `\n` letterali o tra virgolette: vedi private-key.ts.
  const rawKey = process.env.FIREBASE_ADMIN_PRIVATE_KEY;
  const privateKey = rawKey ? normalizeServiceAccountKey(rawKey) : undefined;

  if (!projectId || !clientEmail || !privateKey) {
    if (process.env.NEXT_PHASE?.startsWith("phase-")) {
      return initializeApp({ projectId: "build-placeholder" });
    }
    throw new Error(
      "Firebase Admin: mancano FIREBASE_ADMIN_CLIENT_EMAIL e/o FIREBASE_ADMIN_PRIVATE_KEY"
    );
  }

  return initializeApp({
    credential: cert({ projectId, clientEmail, privateKey } as ServiceAccount),
  });
}

export const adminApp = getAdminApp();
export const adminAuth = getAuth(adminApp);
