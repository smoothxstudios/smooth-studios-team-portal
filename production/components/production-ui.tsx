"use client";
import type {ReactNode} from "react";
import {Select, SelectTrigger, SelectValue, SelectContent, SelectItem} from "@/components/ui/select";
export async function request<T>(url:string, method="GET", body?:unknown):Promise<T>{
  const r=await fetch(url,{method,headers:body?{"Content-Type":"application/json"}:undefined,body:body?JSON.stringify(body):undefined,cache:"no-store"});
  let d:any;try{d=await r.json();}catch{throw new Error("The connection was interrupted. Please try again.");}
  if(r.status===401)window.dispatchEvent(new Event("account-expired"));
  if(!r.ok)throw new Error(d.error||"Something went wrong. Please try again.");return d;
}
export function errorText(e:unknown){return e instanceof Error?e.message:"Please try again.";}
export function Choice({value,onChange,options,label,empty,disabled,className=""}:{value:string;onChange:(v:string)=>void;options:string[];label:string;empty?:string;disabled?:boolean;className?:string}){
  return <Select value={value||"__empty"} onValueChange={v=>onChange(v==="__empty"?"":v)} disabled={disabled}>
    <SelectTrigger aria-label={label} className={"choice "+className}><SelectValue placeholder={empty||label}/></SelectTrigger>
    <SelectContent position="popper">{empty&&<SelectItem value="__empty">{empty}</SelectItem>}{[...new Set(value&&!options.includes(value)?[value,...options]:options)].map(o=><SelectItem key={o} value={o}>{o}</SelectItem>)}</SelectContent>
  </Select>;
}
export function FormField({label,children,hint,wide=false}:{label:string;children:ReactNode;hint?:string;wide?:boolean}){return <div className={"form-field "+(wide?"wide":"")}><span className="field-label">{label}</span>{children}{hint&&<span className="field-hint">{hint}</span>}</div>;}
