import { TEAM, studioLocal, localInstant } from '../lib/team-schedule.mjs';
import { appointmentCancelled } from '../lib/appointment-lifecycle.mjs';

export class PayrollAccountConflict extends Error {}
const sum = (items, key) => items.reduce((total, item) => total + Number(item[key] ?? 0), 0);
const day = value => studioLocal(value).slice(0, 10);
const hash = async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(value))))].map(b => b.toString(16).padStart(2,'0')).join('');
const rows = async (db, query, ...args) => (await db.prepare(query).bind(...args).all()).results;

/** A single ledger powers the preview, receipt, and every current-balance display. */
export async function paymentAccounts(db, user, now = Date.now()) {
  const employee = ['owner','sync'].includes(user) ? null : user;
  const revision = (await db.prepare('SELECT revision FROM payroll_account_revision WHERE id=1').first()).revision;
  const [sources, imported, settlements, allocations, calendar, offers, consumed, creative, receipts] = await Promise.all([
    rows(db, 'SELECT * FROM payroll_sources WHERE (? IS NULL OR employee_id=?) ORDER BY earned_at,kind,id', employee, employee),
    rows(db, 'SELECT r.* FROM payroll_rental_earnings r JOIN payroll_state s ON s.generation=r.generation WHERE (? IS NULL OR r.employee_id=?)', employee, employee),
    rows(db, 'SELECT * FROM payroll_rental_settlements WHERE (? IS NULL OR employee_id=?)', employee, employee),
    rows(db, `SELECT a.employee_id,p.source_kind,p.source_id,SUM(p.amount_cents) AS amount,MAX(p.cash_floor_cents) AS floor
      FROM payroll_advance_allocations p JOIN payroll_advances a ON a.id=p.advance_id
      WHERE (? IS NULL OR a.employee_id=?) GROUP BY a.employee_id,p.source_kind,p.source_id`, employee, employee),
    rows(db, 'SELECT a.data FROM team_appointments a JOIN team_state s ON a.generation=s.generation'),
    rows(db, 'SELECT data FROM team_assignments'),
    rows(db, 'SELECT * FROM payroll_rental_deductions WHERE (? IS NULL OR employee_id=?)', employee, employee),
    rows(db, 'SELECT data FROM team_creative_assignments WHERE (? IS NULL OR employee_id=?)', employee, employee),
    rows(db, 'SELECT data FROM payroll_receipts WHERE (? IS NULL OR employee_id=?) ORDER BY created_at DESC LIMIT 50', employee, employee),
  ]);
  const appointments = calendar.map(row => JSON.parse(row.data)), assignments = offers.map(row => JSON.parse(row.data));
  const works = new Map(creative.map(row => { const item = JSON.parse(row.data); return [item.id,item]; }));
  const creditFor = (employeeId,kind,id) => allocations.find(a => a.employee_id===employeeId && a.source_kind===kind && a.source_id===id);
  const earnings = sources.filter(source => {
    if (Date.parse(source.earned_at)>now) return false;
    const appointment = source.kind==='rental' && appointments.find(a=>a.id===source.id);
    return !appointment || (!appointmentCancelled(appointment, assignments, now) && appointment.teamRenterId!==source.employee_id);
  }).map(source => {
    const credit=creditFor(source.employee_id,source.kind,source.id), applied=Math.min(source.amount_cents,credit?.amount??0);
    const recorded = source.kind==='rental' && applied ? Math.max(credit.floor,source.recorded_paid-applied) : source.recorded_paid;
    const outstandingCents=Math.max(0,source.amount_cents-recorded-applied);
    const appointment=appointments.find(a=>a.id===source.id), work=works.get(source.id);
    return { kind:source.kind, sourceId:source.id, employeeId:source.employee_id, amountCents:source.amount_cents,
      outstandingCents, earnedAt:source.earned_at, title:source.kind==='creative' ? work?.title??'Other pay' : appointment?.title??'Appointment',
      ...(source.kind==='rental' ? {customer:appointment?.customer??''} : {}),
      advanceAppliedCents:applied };
  });
  const charges=appointments.filter(a=>a.teamRenterId && (!employee || a.teamRenterId===employee) &&
    Date.parse(a.end)<=now && !appointmentCancelled(a,assignments,now)).map(a=>{
    const amountCents=a.fullyPaid ? 0 : Math.max(0,a.priceCents-(a.paidOnlineCents??0));
    const appliedCents=consumed.find(c=>c.employee_id===a.teamRenterId&&c.rental_id===a.id)?.amount_cents??0;
    return {rentalId:a.id,employeeId:a.teamRenterId,title:a.title,earnedAt:a.end,priceCents:a.priceCents,
      paidOnlineCents:a.paidOnlineCents??0,amountCents,appliedCents,outstandingCents:Math.max(0,amountCents-appliedCents),
      needsReview:appliedCents>amountCents};
  });
  // Removed or reassigned bookings must leave an explicit correction to review.
  for(const prior of consumed) if(!charges.some(c=>c.rentalId===prior.rental_id&&c.employeeId===prior.employee_id))
    charges.push({rentalId:prior.rental_id,employeeId:prior.employee_id,title:'Changed team rental',earnedAt:new Date(now).toISOString(),priceCents:0,paidOnlineCents:0,amountCents:0,appliedCents:prior.amount_cents,outstandingCents:0,needsReview:true});
  const accounts=TEAM.filter(p=>p.id!=='owner'&&(!employee||p.id===employee)).map(p=>{
    const earned=earnings.filter(e=>e.employeeId===p.id), rentals=charges.filter(c=>c.employeeId===p.id);
    const grossOwedCents=sum(earned,'outstandingCents'), rentalBalanceCents=sum(rentals,'outstandingCents');
    return {employeeId:p.id,grossOwedCents,rentalBalanceCents,netCents:grossOwedCents-rentalBalanceCents,
      payableCents:Math.max(0,grossOwedCents-rentalBalanceCents),carryForwardCents:Math.max(0,rentalBalanceCents-grossOwedCents),
      reviewCount:rentals.filter(c=>c.needsReview).length};
  });
  const rentalPayments=imported.map(r=>{
    const saved=settlements.find(s=>s.employee_id===r.employee_id&&s.rental_id===r.rental_id);
    return {employeeId:r.employee_id,rentalId:r.rental_id,recordedPaidAmountCents:Math.max(r.paid_cents,saved?.settled_cents??0),rentalDeductionCents:saved?.deduction_cents??0};
  });
  const current=(await db.prepare('SELECT revision FROM payroll_account_revision WHERE id=1').first()).revision;
  if(current!==revision) throw new PayrollAccountConflict('Pay changed while loading. Review the current balance again.');
  return {accountRevision:revision,accounts,earnings,rentalCharges:charges,rentalPayments,paymentReceipts:receipts.map(r=>JSON.parse(r.data))};
}

export async function paymentPreview(db, employeeId, through, fail) {
  if(!TEAM.some(p=>p.id===employeeId&&p.id!=='owner')) fail(400,'Choose one team member.');
  try { if(!/^\d{4}-\d{2}-\d{2}$/.test(through)||through>day(Date.now())) throw Error(); localInstant(`${through}T00:00`); }
  catch {fail(400,'Choose a valid date today or earlier.');}
  const state=await paymentAccounts(db,employeeId);
  const items=state.earnings.filter(e=>day(e.earnedAt)<=through&&e.outstandingCents>0);
  const charges=state.rentalCharges.filter(c=>day(c.earnedAt)<=through&&c.outstandingCents>0);
  const grossCents=sum(items,'outstandingCents'),rentalBalanceCents=sum(charges,'outstandingCents');
  const deductionCents=Math.min(grossCents,rentalBalanceCents),cashCents=grossCents-deductionCents;
  const after=state.accounts[0].netCents-cashCents;
  const reviewKey=await hash({employeeId,through,revision:state.accountRevision,items,charges,grossCents,deductionCents,cashCents});
  return {employeeId,through,reviewKey,revision:state.accountRevision,items,charges,grossCents,deductionCents,cashCents,
    remainingPayableCents:Math.max(0,after),carryForwardCents:Math.max(0,-after),
    reviewCount:state.accounts[0].reviewCount};
}

export async function paymentRoute({request,db,user,body,fail}) {
  const url=new URL(request.url);
  if(user!=='owner') fail(403,'Only Smooth can record team payments.');
  if(request.method==='GET'&&/^\/payroll\/payments\/[a-f0-9-]{36}$/.test(url.pathname)) { const row=await db.prepare('SELECT data FROM payroll_receipts WHERE id=?').bind(url.pathname.split('/').pop()).first(); return {receipt:row?JSON.parse(row.data):null}; }
  if(request.method==='GET'&&url.pathname==='/payroll/payments/preview')
    return paymentPreview(db,url.searchParams.get('employee'),url.searchParams.get('through'),fail);
  if(request.method!=='POST'||url.pathname!=='/payroll/payments') fail(404,'Payment endpoint not found.');
  const input=await body(request);
  if(!/^[a-f0-9-]{36}$/.test(input.id??'')||!Number.isSafeInteger(input.revision)||!Number.isSafeInteger(input.cashCents)||input.cashCents<0) fail(400,'Review the payment before recording it.');
  if(typeof input.method!=='string'||input.method.length>80||typeof input.note!=='string'||input.note.length>1000) fail(400,'Check the payment method and note.');
  const requestKey=await hash(input);
  const existing=async()=>{
    const row=await db.prepare('SELECT request_key,data FROM payroll_receipts WHERE id=?').bind(input.id).first();
    if(!row)return null;
    if(row.request_key!==requestKey)fail(409,'This payment was already recorded with different details. Review its receipt.');
    return {receipt:JSON.parse(row.data),duplicate:true};
  };
  const previous=await existing();if(previous)return previous;
  const preview=await paymentPreview(db,input.employeeId,input.through,fail);
  if(preview.revision!==input.revision||preview.cashCents!==input.cashCents||preview.reviewKey!==input.reviewKey)fail(409,'The balance changed. Review the updated amount before recording payment.');
  if(!preview.items.length&&input.allowEmpty!==true)fail(409,'There is no unpaid earned work through this date.');
  if(preview.reviewCount)fail(409,'A previously deducted rental changed. Review the rental deduction before recording another payment.');
  const now=new Date().toISOString(),mutation=crypto.randomUUID();
  let remainingDeduction=preview.deductionCents;
  const items=preview.items.map(item=>{const deductionCents=Math.min(remainingDeduction,item.outstandingCents);remainingDeduction-=deductionCents;
    return {...item,deductionCents,cashCents:item.outstandingCents-deductionCents};});
  const receipt={id:input.id,employeeId:input.employeeId,through:input.through,recordedAt:now,method:input.method.trim(),note:input.note.trim(),
    grossCents:preview.grossCents,deductionCents:preview.deductionCents,cashCents:preview.cashCents,items,
    rentalCharges:preview.charges,
    remainingPayableCents:preview.remainingPayableCents,carryForwardCents:preview.carryForwardCents};
  const guard='EXISTS(SELECT 1 FROM payroll_receipts WHERE id=? AND mutation=?)';
  const statements=[db.prepare(`INSERT OR IGNORE INTO payroll_receipts(id,employee_id,request_key,data,created_at,mutation)
    SELECT ?,?,?,?,?,? WHERE (SELECT revision FROM payroll_account_revision WHERE id=1)=?`)
    .bind(input.id,input.employeeId,requestKey,JSON.stringify(receipt),now,mutation,input.revision)];
  const rentalItems=items.filter(item=>item.kind==='rental'),creativeItems=items.filter(item=>item.kind==='creative');
  if(rentalItems.length) statements.push(db.prepare(`INSERT INTO payroll_rental_settlements(employee_id,rental_id,settled_cents,deduction_cents)
    SELECT ?,json_extract(value,'$.sourceId'),json_extract(value,'$.amountCents'),json_extract(value,'$.deductionCents')
    FROM json_each(?) WHERE ${guard} ON CONFLICT(employee_id,rental_id) DO UPDATE SET
    settled_cents=MAX(settled_cents,excluded.settled_cents),deduction_cents=deduction_cents+excluded.deduction_cents`)
    .bind(input.employeeId,JSON.stringify(rentalItems),input.id,mutation));
  if(creativeItems.length) statements.push(db.prepare(`UPDATE team_creative_assignments SET
    data=json_set(data,'$.payments',json_insert(json_extract(data,'$.payments'),'$[#]',json((SELECT json_object(
      'id',?,'amountCents',json_extract(value,'$.outstandingCents'),'cashCents',json_extract(value,'$.cashCents'),
      'rentalDeductionCents',json_extract(value,'$.deductionCents'),'method',?,'paidAt',?,'receiptId',?)
      FROM json_each(?) WHERE json_extract(value,'$.sourceId')=team_creative_assignments.id))),
      '$.history',json_insert(COALESCE(json_extract(data,'$.history'),'[]'),'$[#]',json(?)),
      '$.version',version+1,'$.updatedAt',?),version=version+1,mutation=?
    WHERE employee_id=? AND id IN (SELECT json_extract(value,'$.sourceId') FROM json_each(?)) AND ${guard}`)
    .bind(input.id,input.method,now,input.id,JSON.stringify(creativeItems),JSON.stringify({id:input.id,event:'payment recorded',by:user,at:now}),now,mutation,input.employeeId,JSON.stringify(creativeItems),input.id,mutation));
  remainingDeduction=preview.deductionCents;
  const deductions=preview.charges.flatMap(charge=>{const amountCents=Math.min(remainingDeduction,charge.outstandingCents);remainingDeduction-=amountCents;
    return amountCents?[{rentalId:charge.rentalId,amountCents}]:[];});
  if(deductions.length)statements.push(db.prepare(`INSERT INTO payroll_rental_deductions(employee_id,rental_id,amount_cents)
    SELECT ?,json_extract(value,'$.rentalId'),json_extract(value,'$.amountCents') FROM json_each(?) WHERE ${guard}
    ON CONFLICT(employee_id,rental_id) DO UPDATE SET amount_cents=amount_cents+excluded.amount_cents`)
    .bind(input.employeeId,JSON.stringify(deductions),input.id,mutation));
  const result=await db.batch(statements);
  if(!result[0].meta.changes){const saved=await existing();if(saved)return saved;fail(409,'Pay changed while saving. Review the updated balance.');}
  return {receipt,duplicate:false};
}
