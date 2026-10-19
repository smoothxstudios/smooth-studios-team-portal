import { validatePlan, crewFit, plannerPeople } from '../lib/event-planner.mjs';

export async function eventPlannerRoute({request,db,user,body,fail,snapshot}) {
  if (user !== 'owner') fail(403,'Only Smooth can view or edit the event staffing plan.');
  const row = await db.prepare('SELECT revision,data FROM owner_event_planner WHERE id=1').first();
  if (!row) fail(503,'The event planner is waiting for its database update.');
  const current = JSON.parse(row.data);
  if (request.method === 'GET') return {revision:row.revision,...current};
  if (request.method !== 'PUT') fail(405,'Unsupported planner action.');
  const input = await body(request);
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) fail(400,'Reload the plan before saving.');
  if (input.revision !== row.revision) fail(409,'The plan changed on another device. Reload and review before saving.');
  let plan;
  try { plan = validatePlan(input); } catch(error) { fail(400,error.message); }
  const live = await snapshot(db);
  const schedule = {...live};
  const assignmentKey = e => JSON.stringify([e.startLocal,e.endLocal,e.coverageStartLocal,e.coverageEndLocal,e.people,e.archived]);
  for (const event of plan.events.filter(e => !e.archived && e.people.length)) {
    const prior = current.events.find(e => e.id === event.id);
    if (prior && assignmentKey(prior) === assignmentKey(event)) continue;
    for (const id of event.people) {
      const fit = crewFit(id,event,plan,schedule);
      if (fit.status === 'blocked') fail(409,`${plannerPeople(plan).find(p => p.id === id)?.name || 'This person'} has a conflict: ${fit.reasons.join('; ')}. Adjust coverage or choose someone else.`);
    }
  }
  const result = await db.prepare('UPDATE owner_event_planner SET revision=revision+1,data=?,updated_at=? WHERE id=1 AND revision=? AND EXISTS(SELECT 1 FROM team_state WHERE id=1 AND revision=?)')
    .bind(JSON.stringify(plan),Date.now(),input.revision,live.state.revision).run();
  if (!result.meta.changes) fail(409,'The plan or schedule changed. Reload and review before saving.');
  return {revision:input.revision+1,...plan};
}
