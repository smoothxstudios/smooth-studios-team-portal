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

export const workPreferences = sqliteTable("team_work_preferences", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  data: text("data").notNull(),
}, table => [index("team_work_preferences_user").on(table.userId)]);

export const engagementState = sqliteTable("team_engagement_state", {
  userId: text("user_id").primaryKey(),
  nextMoodAt: integer("next_mood_at").notNull().default(0),
  lastMoodId: text("last_mood_id"),
  questionDismissedDay: text("question_dismissed_day").notNull().default(""),
});

export const moodCheckins = sqliteTable("team_mood_checkins", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  mood: text("mood").notNull(), createdAt: integer("created_at").notNull(),
}, table => [index("team_mood_checkins_user_time").on(table.userId, table.createdAt)]);

export const creativeAttempts = sqliteTable("team_creative_attempts", {
  userId: text("user_id").notNull(), day: text("day").notNull(),
  correct: integer("correct").notNull(), points: integer("points").notNull(),
  createdAt: integer("created_at").notNull(), data: text("data").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.day] })]);

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
