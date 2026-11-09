"use client";
import { createContext,useContext,type ReactNode } from "react";
type ReleaseInfo={version:string;date:string};
const ReleaseContext=createContext<ReleaseInfo|null>(null);
export function DashboardReleaseInfo({info,children}:{info:ReleaseInfo;children:ReactNode}) {return <ReleaseContext.Provider value={info}>{children}</ReleaseContext.Provider>;}
export function useReleaseInfo(){const info=useContext(ReleaseContext);if(!info)throw new Error("Dashboard release metadata is unavailable");return info;}
