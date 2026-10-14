import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const state = sqliteTable("team_state", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  mutation: text("mutation").notNull().default(""),
  generation: text("generation").notNull().default(""),
  syncedAt: text("synced_at"),
});

export const appointments = sqliteTable("team_appointments", {
  generation: text("generation").notNull(),
  id: text("id").notNull(),
  data: text("data").notNull(),
}, (table) => [primaryKey({ columns: [table.generation, table.id] })]);

export const blocks = sqliteTable("team_blocks", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  data: text("data").notNull(),
});

export const assignments = sqliteTable("team_assignments", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  data: text("data").notNull(),
});

export const devices = sqliteTable("team_devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  createdAt: text("created_at").notNull(),
});

// One coalesced, durable alert per person. No client details on lock screens.
export const alerts = sqliteTable("team_alerts", {
  userId: text("user_id").primaryKey(),
  id: text("id").notNull(),
  attempts: integer("attempts").notNull().default(0),
  dueAt: integer("due_at").notNull(),
});

export const guidelineQuestions = sqliteTable("guideline_questions", {
  id: text("id").primaryKey(),
  askedBy: text("asked_by").notNull(),
  question: text("question").notNull(),
  normalized: text("normalized").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [uniqueIndex("guideline_questions_author_text").on(table.askedBy, table.normalized), index("guideline_questions_status").on(table.status, table.createdAt)]);
