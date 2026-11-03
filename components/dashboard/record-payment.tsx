"use client";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { teamRequest } from "@/lib/team-api";
import { studioLocal } from "@/lib/team-schedule.mjs";
import { dollars, formatDate } from "@/lib/dashboard-presentation";
import type { Employee, PaymentReceipt } from "@/lib/dashboard-types";

type Preview = {
  employeeId: string; through: string; reviewKey: string; revision: number; grossCents: number; deductionCents: number; cashCents: number;
  remainingPayableCents: number; carryForwardCents: number; reviewCount: number;
  items: { kind: string; sourceId: string; title: string; customer?: string; earnedAt: string; outstandingCents: number }[];
  charges: { rentalId: string; title: string; earnedAt: string; outstandingCents: number }[];
};
export function RecordPaymentDialog({open,onOpenChange,employeeId,employees,token,onSaved,request=teamRequest}: {
  request?: typeof teamRequest;
  open:boolean;onOpenChange:(open:boolean)=>void;employeeId:string;employees:Employee[];token:string;onSaved:()=>Promise<unknown>;
}) {
  const [through,setThrough]=useState(()=>studioLocal(Date.now()).slice(0,10));
  const [preview,setPreview]=useState<Preview|null>(null),[receipt,setReceipt]=useState<PaymentReceipt|null>(null);
  const [method,setMethod]=useState(""),[note,setNote]=useState(""),[error,setError]=useState("");
  const [busy,setBusy]=useState(false),[loading,setLoading]=useState(false),[confirmed,setConfirmed]=useState(false);
  const [reviewSequence,setReviewSequence]=useState(0);
  const attempt=useRef<{id:string;revision:number;method:string;note:string}|null>(null);
  const name=employees.find(p=>p.id===employeeId)?.name??"Team member";
  useEffect(()=>{
    if(!open)return;
    let cancelled=false;setLoading(true);setError("");setPreview(null);setReceipt(null);setConfirmed(false);attempt.current=null;
    request<Preview>(token,`/payroll/payments/preview?employee=${encodeURIComponent(employeeId)}&through=${encodeURIComponent(through)}`)
      .then(value=>{if(!cancelled)setPreview(value);}).catch(reason=>{if(!cancelled)setError(reason.message);}).finally(()=>{if(!cancelled)setLoading(false);});
    return()=>{cancelled=true;};
  },[open,employeeId,through,token,reviewSequence,request]);
  async function save(){
    if(!preview||busy||!confirmed)return;
    setBusy(true);setError("");
    try {
      const createId=()=>{
        if(crypto.randomUUID)return crypto.randomUUID();
        const bytes=crypto.getRandomValues(new Uint8Array(16));bytes[6]=(bytes[6]&15)|64;bytes[8]=(bytes[8]&63)|128;
        const hex=Array.from(bytes,b=>b.toString(16).padStart(2,"0")).join("");
        return `${hex.slice(0,8)}-${hex.slice(8,12)}-${hex.slice(12,16)}-${hex.slice(16,20)}-${hex.slice(20)}`;
      };
      attempt.current??={id:createId(),revision:preview.revision,method,note};
      const result=await request<{receipt:PaymentReceipt}>(token,"/payroll/payments",{...attempt.current,employeeId,through,reviewKey:preview.reviewKey,cashCents:preview.cashCents});
      setReceipt(result.receipt);await onSaved();
    }catch(reason){setError(reason instanceof Error?reason.message:"Payment could not be confirmed. Retry to check the same payment.");}
    finally{setBusy(false);}
  }
  return <Dialog open={open} onOpenChange={value=>{if(!busy)onOpenChange(value);}}><DialogContent className="payment-record-dialog"><DialogHeader>
    <DialogTitle>{receipt?"Payment recorded":`Record payment · ${name}`}</DialogTitle>
    <DialogDescription>{receipt?"Saved in the payment history. The receipt confirms the balance after this payment.":"Review all earned appointments, training, onboarding, and approved creative work. This records money you already sent."}</DialogDescription>
  </DialogHeader>
  {receipt?<div className="payment-receipt" role="status"><strong>{dollars(receipt.cashCents,true)} recorded for {name}</strong><p>{dollars(receipt.deductionCents,true)} applied to studio rentals.</p><p>Pay still owed: <b>{dollars(receipt.remainingPayableCents,true)}</b></p>{receipt.carryForwardCents>0&&<p>Rental balance carried forward: {dollars(receipt.carryForwardCents,true)}</p>}<small>Receipt {receipt.id.slice(0,8)} · {formatDate(receipt.recordedAt)}</small><Button onClick={()=>onOpenChange(false)}>Done</Button></div>:<>
    <label className="payout-control">Work completed through<input type="date" max={studioLocal(Date.now()).slice(0,10)} value={through} disabled={busy||!!attempt.current} onChange={e=>setThrough(e.target.value)}/></label>
    {loading&&<p role="status">Checking the current balance…</p>}
    {preview&&<><dl className="payment-preview-totals"><div><dt>Earned, unpaid</dt><dd>{dollars(preview.grossCents,true)}</dd></div><div><dt>Studio rental deduction</dt><dd>−{dollars(preview.deductionCents,true)}</dd></div><div className="payment-preview-net"><dt>Payment to record</dt><dd>{dollars(preview.cashCents,true)}</dd></div></dl>
      <details className="payment-line-items"><summary>{preview.items.length} earnings included</summary>{preview.items.map(item=><div key={`${item.kind}:${item.sourceId}`}><span><b>{item.title}</b><small>{item.customer?`${item.customer} · `:""}{formatDate(item.earnedAt)}</small></span><strong>{dollars(item.outstandingCents,true)}</strong></div>)}</details>
      {preview.charges.length>0&&<details className="payment-line-items"><summary>Studio rentals deducted</summary>{preview.charges.map(item=><div key={item.rentalId}><span>{item.title}<small>{formatDate(item.earnedAt)}</small></span><strong>{dollars(item.outstandingCents,true)}</strong></div>)}</details>}
      <p>After recording: <b>{dollars(preview.remainingPayableCents,true)}</b> still owed{preview.carryForwardCents>0?` · ${dollars(preview.carryForwardCents,true)} rental balance carries forward`:""}.</p>
      {preview.reviewCount>0&&<p role="alert">A rental already deducted has changed. Review that charge before recording another payment.</p>}
      <label className="payout-control">Payment method<input value={method} disabled={busy||!!attempt.current} maxLength={80} placeholder="Cash App, Zelle, cash…" onChange={e=>setMethod(e.target.value)}/></label>
      <label className="payout-control">Note (optional)<input value={note} disabled={busy||!!attempt.current} maxLength={1000} onChange={e=>setNote(e.target.value)}/></label>
      <label className="payment-confirm"><input type="checkbox" checked={confirmed} disabled={busy} onChange={e=>setConfirmed(e.target.checked)}/><span>{preview.cashCents>0?`I already sent ${dollars(preview.cashCents,true)} to ${name}.`:"Apply these rental deductions. No cash payment is needed."}</span></label>
      <Button disabled={busy||!confirmed||!preview.items.length||preview.reviewCount>0} onClick={()=>void save()}>{busy?"Saving payment…":attempt.current?"Retry this payment":preview.cashCents>0?`Record ${dollars(preview.cashCents,true)} payment`:"Apply rental deductions"}</Button>
    </>}
  </>}
  {error&&<div><p className="schedule-warning" role="alert">{error}</p>{/balance changed|Pay changed|updated balance|current balance/.test(error)&&<Button variant="outline" disabled={busy} onClick={()=>setReviewSequence(n=>n+1)}>Review updated balance</Button>}</div>}
  </DialogContent></Dialog>;
}
