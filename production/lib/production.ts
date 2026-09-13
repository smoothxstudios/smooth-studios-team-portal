export const STAGES=["Development","Pre-production","Production","Post-production","Complete"];
export const DEPARTMENTS=["Pre-production","Shoot day","Post-production"];
export const TASK_STATES=["To do","In progress","Done"];
export const FILE_CATEGORIES=["Script","Treatment","Reference","Call sheet","Receipt","Other"];
export const EXPENSE_CATEGORIES=["Crew","Equipment","Location","Props & wardrobe","Travel & meals","Post-production","Other"];
export const MODULES=[
 {key:"crew",label:"Crew & Tasks",description:"Production roles, responsibilities, and checklists."},
 {key:"files",label:"Scripts & Files",description:"Scripts, treatments, and uploaded documents."},
 {key:"schedule",label:"Scheduling & Call Sheet",description:"Shoot times, locations, and crew calls."},
 {key:"budget",label:"Budget & Expenses",description:"Estimates, spending, and payment tracking."}
] as const;
export type ProductionModule=typeof MODULES[number]['key'];
export const ALL_MODULES:ProductionModule[]=MODULES.map(m=>m.key);
export type CrewMember={id:string;projectId:string;name:string;email:string;role:string;phone:string;callTime:string};
export type Task={id:string;title:string;assignee:string;department:string;due:string;status:string;notes:string};
export type ProductionDocument={id:string;title:string;kind:string;content:string;url:string;updatedAt:number};
export type ScheduleBlock={id:string;date:string;start:string;end:string;title:string;location:string;notes:string;type:"Setup"|"Shoot"|"Break"|"Travel"|"Wrap";shotIds:string[]};
export type Expense={id:string;title:string;category:string;plannedCents:number;actualCents:number;paid:boolean;vendor:string;date:string;notes:string};
export type CallSheet={date:string;call:string;wrap:string;location:string;address:string;parking:string;contactName:string;contactPhone:string;safety:string;notes:string};
export type ProductionData={stage:string;due:string;timezone:string;modules?:ProductionModule[];tasks:Task[];documents:ProductionDocument[];schedule:ScheduleBlock[];expenses:Expense[];budgetCents:number;callSheet:CallSheet};
export type ProjectFile={id:string;projectId:string;name:string;category:string;mime:string;size:number;createdAt:number};
export type SessionUser={id:string;email:string;name:string;username?:string;mustChangePassword?:boolean;admin:boolean};
export const RENTAL_DASHBOARD_URL="https://smoothxstudios.github.io/smooth-studios-team-portal/";
export function defaultProduction():ProductionData{return {stage:"Pre-production",due:"",timezone:"America/New_York",modules:[],tasks:[],documents:[],schedule:[],expenses:[],budgetCents:0,callSheet:{date:"",call:"",wrap:"",location:"",address:"",parking:"",contactName:"",contactPhone:"",safety:"",notes:""}};}
// Existing projects retain every section until their owner changes the selection.
export function productionOf(p:{production?:ProductionData}){const fallback=defaultProduction();return {...fallback,...p.production,modules:p.production?.modules??[...ALL_MODULES],callSheet:{...fallback.callSheet,...p.production?.callSheet}};}
export function hasModule(p:{production?:ProductionData},key:string){return key==='overview'||key==='shots'||productionOf(p).modules.includes(key as ProductionModule);}
export function money(cents:number){return new Intl.NumberFormat("en-US",{style:"currency",currency:"USD",minimumFractionDigits:2}).format(cents/100);}
export function dateLabel(date:string){return date?new Date(date+"T12:00:00").toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric"}):"Not scheduled";}
export function clockLabel(time:string){if(!time)return "—";const [hour,minute]=time.split(":");return (Number(hour)%12||12)+":"+minute+" "+(Number(hour)>=12?"PM":"AM");}
export function expenseTotals(items:Expense[]){return items.reduce((a,e)=>({planned:a.planned+e.plannedCents,actual:a.actual+e.actualCents,paid:a.paid+(e.paid?e.actualCents:0)}),{planned:0,actual:0,paid:0});}
