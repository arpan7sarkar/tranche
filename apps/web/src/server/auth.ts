import "server-only";
import { schema } from "@tranche/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import { createWorkspaceFor } from "./workspaces";

function createAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  if (!secret && process.env.NODE_ENV === "production") {
    throw new Error("BETTER_AUTH_SECRET is not set");
  }
  const db = getDb();
  return betterAuth({
    secret,
    database: drizzleAdapter(db, { provider: "pg", schema }),
    emailAndPassword: { enabled: true, minPasswordLength: 10 },
    databaseHooks: {
      user: {
        create: {
          after: async (user) => {
            await createWorkspaceFor(db, { id: user.id, name: user.name });
          },
        },
      },
    },
    plugins: [nextCookies()],
  });
}

type Auth = ReturnType<typeof createAuth>;

let instance: Auth | undefined;

function getAuth(): Auth {
  instance ??= createAuth();
  return instance;
}

// Built on first use so importing this module needs neither the database nor the secret.
export const auth = {
  get api(): Auth["api"] {
    return getAuth().api;
  },
  handler: (request: Request) => getAuth().handler(request),
};
