import {api,identity,json} from "@/lib/server";
export async function GET(request:Request){return api(async()=>json({user:await identity(request)}));}
