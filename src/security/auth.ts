import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { encode, decode } from "next-auth/jwt";
import { cookies } from "next/headers";
import { z } from "zod";
import { withAdminPostgresConnection } from "@/infrastructure/db";
import {
  authenticateUserWithPostgres,
  resolveSessionFromPostgres,
  revokeSessionInPostgres,
  type AuthenticatedPostgresSession,
} from "@/infrastructure/db/repositories/drizzle-tenant-repositories";
import { requireAuthSecret } from "@/security/env";
import { UnauthenticatedAccessError } from "@/security/session-guard";

/**
 * Official Auth.js v5 session cookie name.
 */
export const AUTHJS_SESSION_COOKIE_NAME = "authjs.session-token";
export const SESSION_COOKIE_NAME = AUTHJS_SESSION_COOKIE_NAME;

const CredentialsInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  trustHost: true,
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours strict session lifetime
  },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "Konnexy Ads PostgreSQL Credentials",
      credentials: {
        email: { label: "E-mail Corporativo", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const parsed = CredentialsInputSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }

        const authenticated = await withAdminPostgresConnection(async (db) => {
          return await authenticateUserWithPostgres(db, {
            email: parsed.data.email,
            password: parsed.data.password,
          });
        });

        return {
          id: authenticated.user.id,
          email: authenticated.user.email,
          name: authenticated.user.fullName,
          dbSessionToken: authenticated.sessionToken,
          activeOrganizationId: authenticated.context.organizationId,
        };
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.sub = user.id;
        const extUser = user as {
          dbSessionToken?: string;
          activeOrganizationId?: string;
        };
        if (extUser.dbSessionToken) {
          token.dbSessionToken = extUser.dbSessionToken;
        }
        if (extUser.activeOrganizationId) {
          token.activeOrganizationId = extUser.activeOrganizationId;
        }
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      const extSession = session as unknown as Record<string, unknown>;
      if (typeof token.dbSessionToken === "string") {
        extSession.dbSessionToken = token.dbSessionToken;
      }
      if (typeof token.activeOrganizationId === "string") {
        extSession.activeOrganizationId = token.activeOrganizationId;
      }
      return session;
    },
  },
});

/**
 * Issues an encrypted Auth.js v5 JWT cookie (`authjs.session-token`) bound to a
 * persistent PostgreSQL `user_sessions.session_token`.
 * Used by both login and onboarding so there is only ONE unified Auth.js session mechanism.
 */
export async function issueUnifiedAuthJsSessionCookie(params: {
  readonly userId: string;
  readonly email: string;
  readonly fullName: string;
  readonly dbSessionToken: string;
  readonly activeOrganizationId: string;
}): Promise<string> {
  const secret = requireAuthSecret();
  const maxAge = 8 * 60 * 60;

  const encodedJwt = await encode({
    secret,
    salt: AUTHJS_SESSION_COOKIE_NAME,
    maxAge,
    token: {
      sub: params.userId,
      email: params.email,
      name: params.fullName,
      dbSessionToken: params.dbSessionToken,
      activeOrganizationId: params.activeOrganizationId,
    },
  });

  const cookieStore = await cookies();
  cookieStore.set(AUTHJS_SESSION_COOKIE_NAME, encodedJwt, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    maxAge,
  });

  return encodedJwt;
}

/**
 * Extracts and verifies the Auth.js v5 JWT from cookies (or a direct `ksess_` token in unit tests)
 * and resolves the authoritative PostgreSQL session from `user_sessions` (enforcing immediate
 * server-side revocation and expiration).
 */
export async function resolveUnifiedAuthJsPostgresSession(options?: {
  readonly rawCookieOrToken?: string | null;
  readonly requestedOrganizationId?: string;
}): Promise<AuthenticatedPostgresSession> {
  let rawValue = options?.rawCookieOrToken?.trim();

  if (!rawValue) {
    const cookieStore = await cookies();
    rawValue =
      cookieStore.get(AUTHJS_SESSION_COOKIE_NAME)?.value?.trim() ??
      cookieStore.get(`__Secure-${AUTHJS_SESSION_COOKIE_NAME}`)?.value?.trim();
  }

  if (!rawValue) {
    throw new UnauthenticatedAccessError("Sessão Auth.js ausente.");
  }

  let dbSessionToken = rawValue;

  if (!rawValue.startsWith("ksess_")) {
    const secret = requireAuthSecret();
    const decoded = await decode({
      token: rawValue,
      secret,
      salt: AUTHJS_SESSION_COOKIE_NAME,
    }).catch(() => null);

    if (!decoded || typeof decoded.dbSessionToken !== "string") {
      throw new UnauthenticatedAccessError(
        "Token de sessão Auth.js inválido ou corrompido."
      );
    }
    dbSessionToken = decoded.dbSessionToken;
  }

  return await withAdminPostgresConnection(async (db) => {
    return await resolveSessionFromPostgres(db, {
      sessionToken: dbSessionToken,
      requestedOrganizationId: options?.requestedOrganizationId,
    });
  });
}

/**
 * Revokes the current Auth.js v5 session in PostgreSQL (`user_sessions.revoked_at = now()`)
 * and deletes the Auth.js session cookie.
 */
export async function revokeUnifiedAuthJsSession(): Promise<void> {
  const cookieStore = await cookies();
  const rawCookie =
    cookieStore.get(AUTHJS_SESSION_COOKIE_NAME)?.value?.trim() ??
    cookieStore.get(`__Secure-${AUTHJS_SESSION_COOKIE_NAME}`)?.value?.trim();

  if (rawCookie) {
    let dbSessionToken = rawCookie;
    if (!rawCookie.startsWith("ksess_")) {
      try {
        const secret = requireAuthSecret();
        const decoded = await decode({
          token: rawCookie,
          secret,
          salt: AUTHJS_SESSION_COOKIE_NAME,
        });
        if (decoded && typeof decoded.dbSessionToken === "string") {
          dbSessionToken = decoded.dbSessionToken;
        }
      } catch {
        // Ignore decode failure during logout cleanup
      }
    }

    if (dbSessionToken.startsWith("ksess_")) {
      await withAdminPostgresConnection(async (db) => {
        await revokeSessionInPostgres(db, dbSessionToken);
      });
    }
  }

  cookieStore.delete(AUTHJS_SESSION_COOKIE_NAME);
}
