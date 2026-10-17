import { TEAM } from './team-schedule.mjs';

const recipients = new Set(TEAM.filter(person => person.id !== 'owner').map(person => person.id));
const targets = new Set(['alerts', 'settings', 'scheduling', 'creative', 'availability']);

/** Keep an uncertain send retry bound to the same content and recipients. */
export function createNotificationDraft(createId = () => crypto.randomUUID()) {
  let previous = null;
  return {
    /** @param {{recipientIds: string[], title: string, body: string, target?: string, context?: {type: 'rental', appointmentId: string, start: string, end: string}}} input */
    prepare({ recipientIds, title, body, target = 'alerts', context }) {
      const ids = [...new Set(recipientIds)].sort();
      const heading = title.trim(), message = body.trim();
      if (!ids.length || ids.some(id => !recipients.has(id))) throw new Error('Choose at least one team member.');
      if (!heading || heading.length > 80 || !message || message.length > 360) throw new Error('Enter a title and message within the limits.');
      if (!targets.has(target)) throw new Error('Choose a page to open.');
      if (context && (context.type !== 'rental' || typeof context.appointmentId !== 'string' || !context.appointmentId.trim() || context.appointmentId.length > 300 ||
          !Number.isFinite(Date.parse(context.start)) || !Number.isFinite(Date.parse(context.end)) || Date.parse(context.end) <= Date.parse(context.start) || target !== 'scheduling')) throw new Error('Choose a current rental and refresh its details.');
      const rental = context ? { type: /** @type {'rental'} */ ('rental'), appointmentId: context.appointmentId,
        start: new Date(context.start).toISOString(), end: new Date(context.end).toISOString() } : undefined;
      const draft = { recipientIds: ids, title: heading, body: message, target, ...(rental ? { context: rental } : {}) };
      const signature = JSON.stringify(draft);
      if (previous?.signature !== signature) previous = { signature, id: createId() };
      return { id: previous.id, ...draft };
    },
    clear() { previous = null; },
  };
}
