import { betterAuth } from "better-auth";
import { mongodbAdapter } from "better-auth/adapters/mongodb";
import { MongoClient } from "mongodb";

// Validate required environment variables
const MONGODB_URI = process.env.MONGODB_URI;
if (!MONGODB_URI) {
  console.error("MONGODB_URI is not defined in environment variables");
  process.exit(1);
}

const client = new MongoClient(MONGODB_URI);
const db = client.db();

export const auth = betterAuth({
  database: mongodbAdapter(db),
  
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 6,
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24, // 1 day
    cookieCache: {
      enabled: true,
      maxAge: 60 * 5, // 5 minutes
    },
  },

  user: {
    additionalFields: {
      apiKeys: {
        type: "string",
        required: false,
        defaultValue: JSON.stringify({}),
      },
      preferences: {
        type: "string",
        required: false,
        defaultValue: JSON.stringify({
          defaultLLM: "openai",
          defaultImageProvider: "pexels",
          subtitleStyle: "sentence",
        }),
      },
    },
  },

  trustedOrigins: [
    process.env.FRONTEND_URL || "http://localhost:3000",
  ],
});

export type Session = typeof auth.$Infer.Session;
