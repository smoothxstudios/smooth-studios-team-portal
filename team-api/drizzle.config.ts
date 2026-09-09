import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./team-api/schema.ts",
  out: "./team-api/migrations",
  dialect: "sqlite",
});
