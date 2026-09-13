import {z} from "zod";
import {defaultProduction,STAGES,DEPARTMENTS,TASK_STATES,FILE_CATEGORIES,EXPENSE_CATEGORIES} from "./production";
const text=z.string().max(12000),short=z.string().max(500),id=z.string().uuid();
const date=z.string().refine(v=>!v||/^\d{4}-\d{2}-\d{2}$/.test(v),"Use a valid date.");
const time=z.string().refine(v=>!v||/^([01]\d|2[0-3]):[0-5]\d$/.test(v),"Use a valid time.");
const cents=z.number().int().min(0).max(1000000000);
export const crewSchema=z.object({id:id.optional(),name:z.string().trim().min(1).max(120),email:z.string().trim().toLowerCase().email().max(254),role:z.string().trim().min(1).max(120),phone:short.default(""),callTime:time.default("")});
export const productionSchema=z.object({
 modules:z.array(z.enum(["crew","files","schedule","budget"])).max(4).refine(v=>new Set(v).size===v.length).optional(),
 stage:z.string().refine(v=>STAGES.includes(v)),due:date,timezone:z.string().max(80).refine(v=>{try{new Intl.DateTimeFormat("en-US",{timeZone:v});return true;}catch{return false;}}),
 tasks:z.array(z.object({id,title:z.string().trim().min(1).max(250),assignee:short,department:z.string().refine(v=>DEPARTMENTS.includes(v)),due:date,status:z.string().refine(v=>TASK_STATES.includes(v)),notes:text})).max(1000),
 documents:z.array(z.object({id,title:z.string().trim().min(1).max(250),kind:z.string().refine(v=>FILE_CATEGORIES.includes(v)),content:z.string().max(200000),url:z.string().max(2000).refine(v=>!v||/^https?:\/\//i.test(v)),updatedAt:z.number()})).max(100),
 schedule:z.array(z.object({id,date:date.refine(Boolean),start:time.refine(Boolean),end:time.refine(Boolean),title:z.string().trim().min(1).max(250),location:short,notes:text,type:z.enum(["Setup","Shoot","Break","Travel","Wrap"]),shotIds:z.array(id).max(500)}).refine(v=>v.end>v.start,"End time must be after start time.")).max(1000),
 expenses:z.array(z.object({id,title:z.string().trim().min(1).max(250),category:z.string().refine(v=>EXPENSE_CATEGORIES.includes(v)),plannedCents:cents,actualCents:cents,paid:z.boolean(),vendor:short,date,notes:text})).max(2000),
 budgetCents:cents,callSheet:z.object({date,call:time,wrap:time,location:short,address:short,parking:text,contactName:short,contactPhone:short,safety:text,notes:text})
}).default(defaultProduction);
