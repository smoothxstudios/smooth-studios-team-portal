"use client";
import { useReleaseInfo } from "@/components/dashboard-release-info";
import { Button } from "@/components/ui/button";
import { Dialog,DialogTrigger } from "@/components/ui/dialog";
import { History } from "lucide-react";
import dynamic from "next/dynamic";
import { useState } from "react";
const ReleaseHistoryDialog=dynamic(()=>import("@/components/dashboard-release-history"));
export function DashboardVersionFooter({compact=false,viewer="signed-out"}:{compact?:boolean;viewer?:"owner"|"employee"|"signed-out"}) {
 const info=useReleaseInfo();const[open,setOpen]=useState(false);
 const dateLabel=new Date(`${info.date}T12:00:00Z`).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"});
 return <footer className={`dashboard-version-footer${compact?" dashboard-version-compact":""}`} aria-label="Dashboard version">
 <div className="dashboard-version-meta"><span className="dashboard-version-badge">v{info.version}</span><span>Updated <time dateTime={info.date}>{dateLabel}</time></span></div>
 {viewer!=="signed-out"&&<Dialog open={open} onOpenChange={setOpen}><DialogTrigger asChild><Button type="button" variant="ghost" className="dashboard-version-link"><History size={15} aria-hidden="true"/>What changed</Button></DialogTrigger>{open&&<ReleaseHistoryDialog viewer={viewer}/>}</Dialog>}
 </footer>;
}
