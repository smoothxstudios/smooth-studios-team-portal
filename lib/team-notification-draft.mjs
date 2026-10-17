import { TEAM } from './team-schedule.mjs';

const recipients = new Set(TEAM.filter(person => person.id !== 'owner').map(person => person.id));
const targets = new Set(['alerts', 'settings', 'scheduling', 'creative']);

/** Keep an uncertain send retry bound to the same content and recipients. */
export function createNotificationDraft(createId = () => crypto.randomUUID()) {
  let previous = null;
  return {
    prepare({ recipientIds, title, body, target = 'alerts' }) {
      const ids = [...new Set(recipientIds)].sort();
      const heading = title.trim(), message = body.trim();
      if (!ids.length || ids.some(id => !recipients.has(id))) throw new Error('Choose at least one team member.');
      if (!heading || heading.length > 80 || !message || message.length > 360) throw new Error('Enter a title and message within the limits.');
      if (!targets.has(target)) throw new Error('Choose a page to open.');
      const draft = { recipientIds: ids, title: heading, body: message, target };
      const signature = JSON.stringify(draft);
      if (previous?.signature !== signature) previous = { signature, id: createId() };
      return { id: previous.id, ...draft };
    },
    clear() { previous = null; },
  };
}
