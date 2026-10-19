export type PlannerEvent = {id:string;title:string;startLocal:string;endLocal:string;location:string;notes:string;crewNeeded:number;people:string[];coverageStartLocal:string;coverageEndLocal:string;archived:boolean};
export type PlannerAvailability = {id:string;personId:string;startLocal:string;endLocal:string;status:'available'|'unavailable'|'tentative';note:string};
export type PlannerData = {events:PlannerEvent[];guests:{id:string;name:string}[];availability:PlannerAvailability[]};
export type PlannerState = PlannerData & {revision:number};
