import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import { z } from "zod";
import {
  AuthAbuseRateLimiter,
  verifyPasswordScrypt,
} from "@/security/auth-rate-limiter";

export const globalAuthRateLimiter = new AuthAbuseRateLimiter(5, 900_000, 900_000);

const CredentialsInputSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: {
    strategy: "jwt",
    maxAge: 8 * 60 * 60, // 8 hours strict session lifetime
  },
  pages: {
    signIn: "/",
  },
  providers: [
    Credentials({
      name: "Konnexy Ads Credentials",
      credentials: {
        email: { label: "E-mail Corporativo", type: "email" },
        password: { label: "Senha", type: "password" },
      },
      authorize: async (rawCredentials) => {
        const parsed = CredentialsInputSchema.safeParse(rawCredentials);
        if (!parsed.success) {
          return null;
        }
        const email = parsed.data.email.toLowerCase().trim();
        const rateCheck = globalAuthRateLimiter.checkAllowed(email);
        if (!rateCheck.allowed) {
          throw new Error("AUTH_RATE_LIMITED");
        }

        // Real database credentials lookup happens via Drizzle in production;
        // Never silently authenticate arbitrary credentials.
        const configuredHash = process.env.ADMIN_BOOTSTRAP_PASSWORD_HASH;
        const configuredEmail = process.env.ADMIN_BOOTSTRAP_EMAIL?.toLowerCase();

        if (
          configuredEmail &&
          configuredHash &&
          email === configuredEmail &&
          verifyPasswordScrypt(parsed.data.password, configuredHash)
        ) {
          globalAuthRateLimiter.reset(email);
          return {
            id: "11111111-1111-4111-8111-111111111111",
            email: configuredEmail,
            name: "Administrador Konnexy",
          };
        }

        globalAuthRateLimiter.recordFailedAttempt(email);
        return null;
      },
    }),
  ],
  callbacks: {
    jwt({ token, user }) {
      if (user?.id) {
        token.sub = user.id;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user && token.sub) {
        session.user.id = token.sub;
      }
      return session;
    },
  },
});
