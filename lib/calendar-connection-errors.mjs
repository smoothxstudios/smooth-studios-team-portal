// Only fixed reason codes cross the OAuth redirect; never Google response text,
// account details, authorization codes, or credentials.
export const CALENDAR_CONNECTION_ERRORS = Object.freeze({
  session: 'This Google connection attempt expired or lost its browser session. Choose Connect Google again in this browser.',
  consent: 'Google access wasn’t approved. Choose Connect Google again and approve the requested Calendar permissions.',
  setup: 'Google rejected the saved client credentials. Smooth needs to check the Web application client in Update Google setup.',
  permissions: 'Google didn’t grant all the Calendar permissions needed. Choose Connect Google again and approve each requested Calendar permission.',
  google_unavailable: 'The dashboard couldn’t finish its request to Google. Choose Connect Google again in a moment.',
  account: 'The Google account couldn’t be verified or doesn’t match your invitation email. Connect the Google account that receives your studio invitations.',
  calendar_access: 'This Google account can’t edit the studio rental calendar. Connect the account that owns it or has permission to make changes to events.',
  offline_access: 'Google didn’t provide a connection that can stay signed in. Choose Connect Google again and approve access.',
  save: 'The Google connection couldn’t be saved. Choose Connect Google again; your uploaded setup is still saved.',
});

export function calendarConnectionError(reason) {
  return Object.hasOwn(CALENDAR_CONNECTION_ERRORS, reason) ? CALENDAR_CONNECTION_ERRORS[reason]
    : 'Google Calendar wasn’t connected. Choose Connect Google to try again.';
}
