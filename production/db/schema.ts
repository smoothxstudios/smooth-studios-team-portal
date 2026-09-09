import { sqliteTable, text, integer, index, uniqueIndex } from "drizzle-orm/sqlite-core";
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), title: text("title").notNull(),
  data: text("data").notNull(), revision: integer("revision").notNull().default(1), updatedAt: integer("updated_at").notNull(),
}, t=>[index("idx_projects_owner_updated").on(t.owner,t.updatedAt)]);
export const images = sqliteTable("images", {
  id: text("id").primaryKey(), owner: text("owner").notNull(), name: text("name").notNull(),
  mime: text("mime").notNull(), size: integer("size").notNull(), createdAt: integer("created_at").notNull(),
  projectId:text("project_id"),
});
export const projectMembers=sqliteTable("project_members",{
  id:text("id").primaryKey(),projectId:text("project_id").notNull(),email:text("email").notNull(),
  name:text("name").notNull(),role:text("role").notNull(),phone:text("phone").notNull().default(""),callTime:text("call_time").notNull().default(""),
},t=>[uniqueIndex("idx_project_members_project_email").on(t.projectId,t.email),index("idx_project_members_email").on(t.email)]);
export const productionFiles=sqliteTable("production_files",{
  id:text("id").primaryKey(),projectId:text("project_id").notNull(),owner:text("owner").notNull(),name:text("name").notNull(),
  category:text("category").notNull(),mime:text("mime").notNull(),size:integer("size").notNull(),createdAt:integer("created_at").notNull(),
},t=>[index("idx_production_files_project").on(t.projectId)]);
