import { mcp } from "@better-auth/mcp";
import { betterAuth } from "better-auth";
import { nextCookies } from "better-auth/next-js";
import { jwt, username } from "better-auth/plugins";

import { falkordbAdapter } from "./falkordb-adapter";

export const appUrl = (process.env.BETTER_AUTH_URL || "http://localhost:3105").replace(/\/$/, "");

export const auth = betterAuth({
  baseURL: appUrl,
  database: falkordbAdapter(),
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  disabledPaths: ["/token"],
  plugins: [
    username(),
    jwt(),
    mcp({
      loginPage: "/sign-in",
      consentPage: "/consent",
      resource: `${appUrl}/mcp`,
      // Each Workspace registers its own /w/<slug>/mcp resource at creation, so any registered client may request any of them.
      enforcePerClientResources: false,
      allowDynamicClientRegistration: true,
      allowUnauthenticatedClientRegistration: true,
      // Claude Code registers without application_type and listens on http://localhost, which only native-client rules allow.
      clientRegistrationDefaultApplicationType: "native",
    }),
    nextCookies(),
  ],
});
