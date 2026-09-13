export type Field = { key: string; label: string; group: string; type: "text" | "textarea" | "select" | "number"; options?: string[]; visible: boolean; custom?: boolean };
export type Reference = { id: string; name: string; caption: string };
export type Shot = { id: string; scene: string; number: string; description: string; order: number; status: string; priority: string; setup: number; duration: number; references: Reference[]; values: Record<string, string> };
import {defaultProduction,productionOf,type ProductionData,type ProductionModule} from "./production";
export type Project = { id: string; title: string; client: string; date: string; brief: string; shots: Shot[]; fields: Field[]; revision: number; updatedAt?: number; columns?: string[]; production?:ProductionData;canEdit?:boolean };
export type ProjectSummary = { id: string; title: string; updatedAt: number; shots: number;client?:string;date?:string;stage?:string;due?:string;taskCount?:number;tasksDone?:number;modules?:ProductionModule[];canEdit?:boolean };
export const STATUS = ["Planned", "Ready", "In progress", "Complete", "Skipped"];
export const PRIORITY = ["Must have", "Standard", "If time"];
export const GROUPS = ["Framing & movement", "Production", "Lighting & sound", "Notes"];
export const FIELDS: Field[] = [
  {key:"size",label:"Shot size",group:GROUPS[0],type:"select",options:["Extreme wide","Wide","Full","Medium wide","Medium","Medium close-up","Close-up","Extreme close-up","Insert"],visible:true},
  {key:"angle",label:"Camera angle",group:GROUPS[0],type:"select",options:["Eye level","Low angle","High angle","Overhead","Worm’s eye","Dutch angle"],visible:true},
  {key:"direction",label:"Camera direction",group:GROUPS[0],type:"select",options:["Front","Profile / side","Rear","Three-quarter front","Three-quarter rear"],visible:true},
  {key:"movement",label:"Movement",group:GROUPS[0],type:"select",options:["Static","Pan left","Pan right","Tilt up","Tilt down","Push in","Pull out","Track left","Track right","Follow","Orbit","Handheld","Crane / jib","Zoom in","Zoom out"],visible:true},
  {key:"style",label:"Shot style",group:GROUPS[0],type:"select",options:["Standard","POV","Over the shoulder","Two-shot","Reaction","Cutaway","Silhouette","Reflection","Detail / insert"],visible:false},
  {key:"gear",label:"Gear",group:GROUPS[0],type:"text",visible:false},
  {key:"location",label:"Location",group:GROUPS[1],type:"text",visible:true},
  {key:"talent",label:"Talent",group:GROUPS[1],type:"text",visible:false},
  {key:"props",label:"Props",group:GROUPS[1],type:"textarea",visible:false},
  {key:"wardrobe",label:"Wardrobe",group:GROUPS[1],type:"textarea",visible:false},
  {key:"light",label:"Lighting",group:GROUPS[2],type:"textarea",visible:false},
  {key:"sound",label:"Sound / dialogue",group:GROUPS[2],type:"textarea",visible:false},
  {key:"notes",label:"Director’s notes",group:GROUPS[3],type:"textarea",visible:false},
  {key:"takes",label:"Take notes",group:GROUPS[3],type:"textarea",visible:false},
];
export const BASE_COLUMNS = [{key:"references",label:"Pictures"},{key:"status",label:"Status"},{key:"priority",label:"Priority"},{key:"order",label:"Shooting order"},{key:"setup",label:"Setup time"},{key:"duration",label:"Duration"}];
export const DEFAULT_COLUMNS = ["references","status","priority","order","setup","duration"];
export function uid() { return crypto.randomUUID(); }
export function blankShot(shots: Shot[] = [], scene = "1"): Shot {
  const numbers=shots.filter(s=>s.scene===scene).map(s=>Number(s.number)).filter(Number.isFinite);
  return {id:uid(),scene,number:String(Math.max(0,...numbers)+1),description:"",order:Math.max(0,...shots.map(s=>s.order))+1,status:"Planned",priority:"Standard",setup:0,duration:0,references:[],values:{}};
}
export function blankProject(title="Untitled shoot",fields:Field[]=FIELDS):Project {
  return {id:uid(),title,client:"",date:"",brief:"",shots:[],fields:structuredClone(fields),revision:0,columns:[...DEFAULT_COLUMNS],production:defaultProduction()};
}
export function exampleProject():Project {
  const p=blankProject("First light — example shoot");
  p.client="Smooth Studios";p.brief="A short studio portrait film. Example shots are editable—start a new project for your own production.";
  p.shots=[
    {scene:"1",number:"1",description:"The elevator doors open, revealing our subject. Hold for a beat before they step into the studio.",order:1,status:"Ready",priority:"Must have",setup:15,duration:5,values:{size:"Medium",angle:"Eye level",direction:"Front",movement:"Static",style:"Standard",gear:"Camera + tripod",location:"Studio entrance",talent:"Lead talent",wardrobe:"Look 01",light:"Soft key from camera left. Practical light inside the elevator.",sound:"Elevator chime; footsteps.",notes:"Wait for the doors to open completely before the first step."}},
    {scene:"1",number:"2",description:"Follow the subject into the studio as the room opens up around them.",order:2,status:"Planned",priority:"Must have",setup:10,duration:6,values:{size:"Medium wide",angle:"Eye level",direction:"Rear",movement:"Follow",style:"Standard",gear:"Camera + gimbal",location:"Studio entrance",talent:"Lead talent",wardrobe:"Look 01",sound:"Footsteps and room tone."}},
    {scene:"2",number:"1",description:"A hand adjusts the light. The practical clicks on and brings warmth into the frame.",order:3,status:"Planned",priority:"Standard",setup:8,duration:3,values:{size:"Close-up",angle:"Eye level",direction:"Profile / side",movement:"Static",style:"Detail / insert",gear:"Camera + tripod",location:"Portrait set",talent:"Lead talent",props:"Practical lamp",light:"Start with practical off. Match exposure once it turns on.",sound:"Switch click."}},
    {scene:"2",number:"2",description:"The subject looks toward the lens. Slowly push in as they settle into their pose.",order:4,status:"Planned",priority:"Must have",setup:20,duration:7,values:{size:"Medium close-up",angle:"Eye level",direction:"Three-quarter front",movement:"Push in",style:"Standard",gear:"Camera + slider",location:"Portrait set",talent:"Lead talent",wardrobe:"Look 01",light:"Soft key, negative fill, subtle edge light.",sound:"Music bed; no dialogue."}},
    {scene:"2",number:"3",description:"Capture the small details: hands, fabric, and a final glance off camera.",order:5,status:"Planned",priority:"If time",setup:5,duration:4,values:{size:"Extreme close-up",angle:"Eye level",direction:"Profile / side",movement:"Handheld",style:"Detail / insert",gear:"Camera",location:"Portrait set",talent:"Lead talent",wardrobe:"Look 01",notes:"Optional texture for the edit."}}
  ].map(s=>({...s,id:uid(),references:[],values:Object.fromEntries(Object.entries(s.values).filter((entry):entry is [string,string]=>typeof entry[1]==="string"))}));
  return p;
}
export function summarize(p:Project):ProjectSummary{return {id:p.id,title:p.title,canEdit:p.canEdit,updatedAt:p.updatedAt||Date.now(),shots:p.shots.length,client:p.client,date:p.date,stage:p.production?.stage||"Pre-production",due:p.production?.due||"",modules:productionOf(p).modules,taskCount:p.production?.tasks.length||0,tasksDone:p.production?.tasks.filter(t=>t.status==="Done").length||0};}
export function timeLabel(seconds:number){ if(!seconds)return "—"; return `${Math.floor(seconds/60)}:${String(Math.round(seconds%60)).padStart(2,"0")}`; }
