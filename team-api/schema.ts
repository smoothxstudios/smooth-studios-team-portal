import { sql } from "drizzle-orm";
import { check, index, integer, primaryKey, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const state = sqliteTable("team_state", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  mutation: text("mutation").notNull().default(""),
  generation: text("generation").notNull().default(""),
  syncedAt: text("synced_at"),
});

export const ownerDashboardLayout = sqliteTable("owner_dashboard_layout", {
  id: integer("id").primaryKey(), revision: integer("revision").notNull().default(0),
  orderJson: text("order_json").notNull(), updatedAt: integer("updated_at").notNull(),
}, table => [check("owner_dashboard_layout_single_owner", sql`${table.id} = 1`),
  check("owner_dashboard_layout_revision", sql`${table.revision} >= 0`)]);

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

export const creativeAssignments = sqliteTable("team_creative_assignments", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull(),
  version: integer("version").notNull().default(1), mutation: text("mutation").notNull(), data: text("data").notNull(),
}, table => [index("team_creative_employee_idx").on(table.employeeId)]);

export const studioReference = sqliteTable("studio_reference", {
  id: integer("id").primaryKey(), revision: integer("revision").notNull().default(0),
  data: text("data").notNull().default('{"entries":[],"checklist":[]}'), importedId: text("imported_id"), updatedAt: text("updated_at"),
});
export const rentalChecklists = sqliteTable("rental_checklists", {
  id: text("id").primaryKey(), appointmentId: text("appointment_id").notNull(), version: integer("version").notNull().default(1), data: text("data").notNull(),
}, table => [index("rental_checklist_appointment_idx").on(table.appointmentId)]);

export const engagementState = sqliteTable("team_engagement_state", {
  userId: text("user_id").primaryKey(),
  nextMoodAt: integer("next_mood_at").notNull().default(0),
  nextMoodPromptAt: integer("next_mood_prompt_at").notNull().default(0),
  moodRevision: integer("mood_revision").notNull().default(0),
  lastMoodId: text("last_mood_id"),
  questionDismissedDay: text("question_dismissed_day").notNull().default(""),
});

export const moodCheckins = sqliteTable("team_mood_checkins", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  mood: text("mood").notNull(), createdAt: integer("created_at").notNull(), resetAt: integer("reset_at"),
}, table => [index("team_mood_checkins_user_time").on(table.userId, table.createdAt)]);

export const creativeAttempts = sqliteTable("team_creative_attempts", {
  userId: text("user_id").notNull(), day: text("day").notNull(),
  correct: integer("correct").notNull(), points: integer("points").notNull(),
  createdAt: integer("created_at").notNull(), data: text("data").notNull(),
}, table => [primaryKey({ columns: [table.userId, table.day] })]);

export const quizAttempts = sqliteTable("team_quiz_attempts", {
  userId: text("user_id").notNull(), day: text("day").notNull(), tier: text("tier").notNull(),
  correct: integer("correct").notNull(), points: integer("points").notNull(),
  createdAt: integer("created_at").notNull(), data: text("data").notNull(), resetAt: integer("reset_at"),
}, table => [primaryKey({ columns: [table.userId, table.day, table.tier] }), index("team_quiz_attempts_day").on(table.day)]);

export const quizOffers = sqliteTable("team_quiz_offers", {
  userId: text("user_id").notNull(), day: text("day").notNull(), slot: integer("slot").notNull(),
  tier: text("tier").notNull(), offeredAt: integer("offered_at").notNull(),
  dismissedAt: integer("dismissed_at"), data: text("data").notNull(), resetReady: integer("reset_ready").notNull().default(0),
}, table => [primaryKey({ columns: [table.userId, table.day, table.slot] }), uniqueIndex("team_quiz_offers_tier").on(table.userId, table.day, table.tier), index("team_quiz_offers_day").on(table.day)]);

export const rewardAccounts = sqliteTable("team_reward_accounts", {
  userId: text("user_id").primaryKey(), points: integer("points").notNull().default(0),
  peakPoints: integer("peak_points").notNull().default(0), awardedStars: integer("awarded_stars").notNull().default(0),
  removedStars: integer("removed_stars").notNull().default(0),
  baselineStars: integer("baseline_stars").notNull().default(0),
  baselinePoints: integer("baseline_points").notNull().default(0),
});
export const rewardChanges = sqliteTable("team_reward_changes", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), kind: text("kind").notNull(),
  amount: integer("amount").notNull(), reason: text("reason").notNull(), actor: text("actor").notNull(),
  createdAt: integer("created_at").notNull(),
}, table => [index("team_reward_changes_user_time").on(table.userId, table.createdAt)]);

export const engagementResets = sqliteTable("team_engagement_resets", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), day: text("day").notNull(),
  kind: text("kind").notNull(), tier: text("tier"), reason: text("reason").notNull(),
  requestData: text("request_data").notNull(), previousData: text("previous_data").notNull(), newQuestion: text("new_question"),
  pointsRemoved: integer("points_removed").notNull().default(0), dayStart: integer("day_start").notNull(),
  dayEnd: integer("day_end").notNull(), createdAt: integer("created_at").notNull(),
}, table => [index("team_engagement_resets_user_time").on(table.userId, table.createdAt)]);

export const assignments = sqliteTable("team_assignments", {
  id: text("id").primaryKey(),
  employeeId: text("employee_id").notNull(),
  data: text("data").notNull(),
});

export const devices = sqliteTable("team_devices", {
  id: text("id").primaryKey(),
  userId: text("user_id").notNull(),
  endpoint: text("endpoint").notNull(),
  p256dh: text("p256dh"),
  auth: text("auth"),
  createdAt: text("created_at").notNull(),
});

// Legacy queue is drained during the rollout; new events use the queue below.
export const alerts = sqliteTable("team_alerts", {
  userId: text("user_id").primaryKey(),
  id: text("id").notNull(),
  attempts: integer("attempts").notNull().default(0),
  dueAt: integer("due_at").notNull(),
  kind: text("kind").notNull().default("schedule"),
});

export const notificationEvents = sqliteTable("team_notification_events", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(),
  kind: text("kind").notNull().default("schedule"), payload: text("payload").notNull(),
  attempts: integer("attempts").notNull().default(0), dueAt: integer("due_at").notNull(),
}, table => [index("team_notification_events_due").on(table.dueAt)]);

export const guidelineQuestions = sqliteTable("guideline_questions", {
  id: text("id").primaryKey(),
  askedBy: text("asked_by").notNull(),
  question: text("question").notNull(),
  normalized: text("normalized").notNull(),
  status: text("status").notNull().default("open"),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
}, table => [uniqueIndex("guideline_questions_author_text").on(table.askedBy, table.normalized), index("guideline_questions_status").on(table.status, table.createdAt)]);

export const quizReminders = sqliteTable("team_quiz_reminders", {
  id: text("id").primaryKey(), userId: text("user_id").notNull(), day: text("day").notNull(),
  questionId: text("question_id").notNull(), createdAt: integer("created_at").notNull(), expiresAt: integer("expires_at").notNull(),
}, table => [uniqueIndex("team_quiz_reminders_question").on(table.userId, table.day, table.questionId), index("team_quiz_reminders_day").on(table.day)]);

export const pushDeliveries = sqliteTable("team_push_deliveries", {
  alertId: text("alert_id").notNull(), deviceId: text("device_id").notNull(),
  attempts: integer("attempts").notNull().default(0), dueAt: integer("due_at").notNull().default(0),
  leaseUntil: integer("lease_until").notNull().default(0), completedAt: integer("completed_at"), createdAt: integer("created_at").notNull(),
  receiptToken: text("receipt_token"), result: text("result"), providerStatus: integer("provider_status"),
  receivedAt: integer("received_at"), openedAt: integer("opened_at"),
}, table => [primaryKey({ columns: [table.alertId, table.deviceId] }), index("team_push_deliveries_created").on(table.createdAt), uniqueIndex("team_push_receipt_token").on(table.receiptToken).where(sql`${table.receiptToken} IS NOT NULL`)]);

// Advance credits settle earned work; original cash-payment records stay intact.
export const payrollState = sqliteTable("payroll_state", {
  id: integer("id").primaryKey(), generation: text("generation").notNull().default(""), syncedAt: text("synced_at"),
});
export const payrollRentalEarnings = sqliteTable("payroll_rental_earnings", {
  generation: text("generation").notNull(), employeeId: text("employee_id").notNull(), rentalId: text("rental_id").notNull(),
  amountCents: integer("amount_cents").notNull(), paidCents: integer("paid_cents").notNull(), earnedAt: text("earned_at").notNull(),
  eligible: integer("eligible").notNull(), asOf: text("as_of").notNull(),
}, table => [primaryKey({ columns: [table.generation, table.employeeId, table.rentalId] })]);
export const payrollAdvances = sqliteTable("payroll_advances", {
  id: text("id").primaryKey(), employeeId: text("employee_id").notNull(), amountCents: integer("amount_cents").notNull(),
  createdAt: text("created_at").notNull(), basis: text("basis").notNull(),
}, table => [index("payroll_advances_employee").on(table.employeeId, table.createdAt)]);
export const payrollAdvanceAllocations = sqliteTable("payroll_advance_allocations", {
  advanceId: text("advance_id").notNull().references(() => payrollAdvances.id), sourceKind: text("source_kind").notNull(), sourceId: text("source_id").notNull(),
  amountCents: integer("amount_cents").notNull(), cashFloorCents: integer("cash_floor_cents").notNull().default(0), createdAt: text("created_at").notNull(),
}, table => [primaryKey({ columns: [table.advanceId, table.sourceKind, table.sourceId] }), index("payroll_allocations_source").on(table.sourceKind, table.sourceId)]);

// Inbox persists after push delivery; migration triggers archive events atomically.
export const notificationInbox = sqliteTable("team_inbox", {
  sequence: integer("sequence").primaryKey({ autoIncrement: true }), id: text("id").notNull().unique(),
  userId: text("user_id").notNull(), kind: text("kind").notNull(), title: text("title").notNull(), body: text("body").notNull(),
  target: text("target").notNull(), targetId: text("target_id"), personId: text("person_id"), createdAt: integer("created_at").notNull(),
  expiresAt: integer("expires_at"), readAt: integer("read_at"), deletedAt: integer("deleted_at"),
  pushAcceptedAt: integer("push_accepted_at"), pushReceivedAt: integer("push_received_at"), openedAt: integer("opened_at"),
}, table => [index("team_inbox_user_sequence").on(table.userId, table.deletedAt, table.sequence), index("team_inbox_user_unread").on(table.userId, table.deletedAt, table.readAt, table.sequence)]);

export const ownerEventPlanner = sqliteTable("owner_event_planner", {
  id: integer("id").primaryKey(),
  revision: integer("revision").notNull().default(0),
  data: text("data").notNull(),
  updatedAt: integer("updated_at").notNull(),
}, table => [check("owner_event_planner_single_owner", sql`${table.id} = 1`), check("owner_event_planner_revision", sql`${table.revision} >= 0`)]);

export const ownerPayWorkTypes = sqliteTable("owner_pay_work_types", {
  id: text("id").primaryKey(), label: text("label").notNull(),
  normalizedLabel: text("normalized_label").notNull().unique(), createdAt: text("created_at").notNull(),
}, table => [check("pay_work_type_label_length", sql`length(${table.label}) BETWEEN 1 AND 60`)]);
