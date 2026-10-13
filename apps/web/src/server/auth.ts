import "server-only";
import { schema } from "@tranche/db";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { getDb } from "./db";
import { createWorkspaceFor } from "./workspaces";

export const auth = betterAuth({
  database: drizzleAdapter(getDb(), { provider: "pg", schema }),
  emailAndPassword: { enabled: true, minPasswordLength: 10 },
  databaseHooks: {
    user: {
      create: {
        after: async (user) => {
          await createWorkspaceFor(getDb(), { id: user.id, name: user.name });
        },
      },
    },
  },
  plugins: [nextCookies()],
});
