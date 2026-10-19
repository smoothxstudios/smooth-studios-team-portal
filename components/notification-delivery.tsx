"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { teamRequest } from "@/lib/team-api";
import { deliveryLabel } from "@/lib/notification-delivery.mjs";

type Person = {userId:string; name:string; devices:number; lastReceivedAt:number|null; lastOpenedAt:number|null};
type Delivery = {id:string; userId:string; title:string; createdAt:number; readAt:number|null; acceptedAt:number|null; receivedAt:number|null; openedAt:number|null; retrying:number; failed:number; tracked:number; queued:number};
type Status = {people:Person[]; alerts:Delivery[]};
const stamp = (time:number) => new Date(time).toLocaleString("en-US", {timeZone:"America/New_York",month:"short",day:"numeric",hour:"numeric",minute:"2-digit"});

export function NotificationDelivery({token}:{token:string}) {
  const [open,setOpen]=useState(false), [person,setPerson]=useState("all"), [data,setData]=useState<Status|null>(null), [error,setError]=useState("");
  const sequence=useRef(0), [loading,setLoading]=useState(false);
  const refresh=useCallback(async()=>{
    const id=++sequence.current; setLoading(true);
    try {const result=await teamRequest<Status>(token,`/notifications/delivery?person=${encodeURIComponent(person)}`);if(id===sequence.current){setData(result);setError("");}}
    catch {if(id===sequence.current)setError("Delivery status couldn’t refresh. Showing the last check.");}
    finally {if(id===sequence.current)setLoading(false);}
  },[token,person]);
  useEffect(()=>{
    if(!open)return;
    void refresh();
    const update=()=>{if(document.visibilityState==="visible")void refresh();};
    const timer=window.setInterval(update,15_000); window.addEventListener("focus",update);
    return()=>{sequence.current++;window.clearInterval(timer);window.removeEventListener("focus",update);};
  },[open,refresh]);
  return <><Button variant="outline" onClick={()=>setOpen(true)}><Radio size={16}/>Delivery</Button>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="delivery-dialog"><DialogHeader><DialogTitle>Notification delivery</DialogTitle><DialogDescription>Received confirms a device handled the alert. Opened means they tapped it. Neither confirms they read the full message.</DialogDescription></DialogHeader>
      <div className="delivery-body">
        <div className="delivery-people" role="group" aria-label="Filter delivery by person"><button type="button" aria-pressed={person==="all"} onClick={()=>setPerson("all")}>Everyone</button>{data?.people.map(p=><button type="button" key={p.userId} aria-pressed={person===p.userId} onClick={()=>setPerson(p.userId)}>{p.name}</button>)}</div>
        {error&&<p role="alert">{error} <button type="button" disabled={loading} onClick={()=>void refresh()}>Try again</button></p>}
        {!data&&loading&&<p role="status">Checking delivery…</p>}
        {data&&<><ul className="delivery-device-list">{data.people.filter(p=>person==="all"||person===p.userId).map(p=><li key={p.userId}><strong>{p.name}</strong><span>{p.devices?`${p.devices} registered device${p.devices===1?"":"s"}`:"No push device connected"}</span><small>{p.lastReceivedAt?`Last device receipt ${stamp(p.lastReceivedAt)}`:"No device receipt confirmed yet"}</small></li>)}</ul>
          <p className="delivery-explanation">New receipts start after employees reopen the updated app. Sent means the push service accepted it; Focus, phone settings, or a missing receipt can still leave delivery unconfirmed. Alerts also stay in the app.</p>
          <h3>Recent alerts</h3><ul className="delivery-alert-list">{data.alerts.map(alert=>{const recipient=data.people.find(p=>p.userId===alert.userId);return <li key={alert.id}><div><strong>{recipient?.name??"Team member"}</strong><span className={alert.openedAt||alert.receivedAt?"delivery-confirmed":""}>{deliveryLabel(alert,recipient?.devices??0)}</span></div><p>{alert.title}</p><small>{stamp(alert.createdAt)}{alert.openedAt?` · Opened ${stamp(alert.openedAt)}`:alert.receivedAt?` · Received ${stamp(alert.receivedAt)}`:alert.readAt?" · Marked read in app":""}{alert.failed>0&&Boolean(alert.receivedAt||alert.acceptedAt)?" · Another device needs attention":""}</small></li>;})}</ul>{!data.alerts.length&&<p>No alerts recorded for this view yet.</p>}
        </>}
      </div>
    </DialogContent></Dialog></>;
}
