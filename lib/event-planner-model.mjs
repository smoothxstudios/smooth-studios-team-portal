import { crewFit, plannerPeople, plannerStartsOnDay } from './event-planner.mjs';
import { studioLocal } from './team-schedule.mjs';

const FIT_ORDER = { available: 0, flexible: 1, check: 2, unknown: 3, blocked: 4 };

// One model belongs to one immutable plan/schedule snapshot. Changing either
// creates a new model, so refreshed availability never reuses old decisions.
/**
 * @param {import('./event-planner-types').PlannerData} plan
 * @param {Pick<import('./team-api').TeamSchedule, 'appointments' | 'assignments'> & Partial<import('./team-api').TeamSchedule>} schedule
 */
export function createPlannerModel(plan, schedule) {
  const people = plannerPeople(plan);
  const names = new Map(people.map(person => [person.id, person.name]));
  const evaluations = new Map();
  const dayCounts = new Map();
  for (const event of plan.events) {
    if (!event.archived) {
      const day = event.startLocal.slice(0, 10);
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }
  }

  function evaluation(event) {
    const coverage = JSON.stringify([
      event.coverageStartLocal || event.startLocal,
      event.coverageEndLocal || event.endLocal,
    ]);
    let cached = evaluations.get(event.id);
    if (!cached || cached.coverage !== coverage) {
      cached = { coverage, fits: new Map(), options: null };
      evaluations.set(event.id, cached);
    }
    return cached;
  }

  /** @returns {ReturnType<typeof crewFit>} */
  function fit(personId, event) {
    const cached = evaluation(event);
    if (!cached.fits.has(personId)) {
      cached.fits.set(personId, crewFit(personId, event, plan, schedule));
    }
    return cached.fits.get(personId);
  }

  /** @returns {(ReturnType<typeof plannerPeople>[number] & {fit: ReturnType<typeof crewFit>})[]} */
  function optionsFor(event) {
    const cached = evaluation(event);
    cached.options ??= people
      .map(person => ({ ...person, fit: fit(person.id, event) }))
      .sort((a, b) => FIT_ORDER[a.fit.status] - FIT_ORDER[b.fit.status]);
    return cached.options;
  }

  function forDay(day, search = '', needsCrew = false, showArchived = false) {
    const query = search.toLowerCase();
    const dayEvents = plan.events.filter(event => !event.archived && plannerStartsOnDay(event, day));
    const events = plan.events.filter(event => (showArchived || !event.archived)
      && plannerStartsOnDay(event, day)
      && (!needsCrew || !event.crewNeeded || event.people.length < event.crewNeeded)
      && `${event.title} ${event.location}`.toLowerCase().includes(query));
    const appointments = schedule.appointments.filter(appointment => plannerStartsOnDay(appointment, day)
      && `${appointment.title} ${appointment.customer}`.toLowerCase().includes(query));
    const tasks = schedule.assignments.filter(task => !task.appointmentId
      && ['pending', 'accepted'].includes(task.status) && plannerStartsOnDay(task, day)
      && task.title.toLowerCase().includes(query));
    const entries = [
      ...events.map(event => ({ start: event.startLocal, event })),
      ...appointments.map(appointment => ({ start: studioLocal(appointment.start), appointment })),
      ...tasks.map(task => ({ start: studioLocal(task.start), task })),
    ].sort((a, b) => a.start.localeCompare(b.start));
    return {
      entries, dayEvents, appointments,
      unfilled: dayEvents.filter(event => !event.crewNeeded || event.people.length < event.crewNeeded).length,
      conflicts: dayEvents.filter(event => event.people.some(id => fit(id, event).status === 'blocked')).length,
    };
  }

  return { people, fit, optionsFor, forDay, dayCounts, personName: id => names.get(id) || id };
}
