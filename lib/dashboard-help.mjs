// Keep instructions aligned with the feature's current UI. Owner articles are
// filtered before search, category counts, and rendering.
/**
 * @param {string} id
 * @param {string} title
 * @param {string} category
 * @param {string} summary
 * @param {string[]} steps
 * @param {string} keywords
 * @param {'all' | 'owner' | 'employee'} [role]
 */
const article = (id, title, category, summary, steps, keywords, role = 'all') => ({ id, title, category, summary, steps, keywords, role, updated: ['calendar-rental-sync', 'assign-rental', 'team-availability', 'preferred-days', 'find-page', 'smoothstars', 'pull-refresh', 'alerts-inbox', 'manage-stars', 'team-accounts', 'schedule-layout', 'block-time', 'next-work', 'team-hours', 'team-payouts', 'rental-details'].includes(id) ? '2026-10-17' : '2026-10-16' });
export const HELP_ARTICLES = [
  article('find-page', 'How do I find my way around?', 'Getting started', 'Home opens after sign-in. The sidebar groups the rest of the dashboard by what you need to do.', [
    'On a phone, the floating toolbar starts with Home and puts Schedule in the middle, followed by Alerts and your payment page.',
    'Choose a different toolbar tab to open it with current information; this update runs quietly. Tap the tab you are already viewing to glide to the top and refresh with a small indicator over the page. Scrolling or touching the page during the glide stops it.',
    'You can also press on a tab and slide across the toolbar. The highlight follows your finger; release on the tab you want to open. Moving well away from the bar cancels the slide.',
    'Tap the three-line menu icon at the top left for the full sidebar; choosing a page closes it. Settings is at the bottom of the sidebar.',
    'You can also swipe right, starting just inside the left edge of the page, to open the sidebar. Swipe on the page background rather than a form field or a horizontally scrolling calendar. Close the menu with the X, by tapping outside, or by choosing a page.',
    'Short downward scrolls keep the toolbar visible. After a longer scroll down, it slides below the screen without fading; scroll up or reach the top to bring it back. Keyboard focus also brings it back. The sidebar and its dimmed background open and close together.',
    'Scroll inside the sidebar to reach more pages; the logo and Settings stay in place. Only your current page stays highlighted in red as you scroll. Work contains your schedule, availability, creative work, and earnings.',
    'Resources contains Studio Guidelines and Rental Checklist. Settings stays at the bottom.',
    'Productions and Content Vault open separate apps. Their external-link icon marks them as destinations outside this dashboard.',
  ], 'menu three lines hamburger toolbar bottom bar tabs navigation mobile phone page sidebar home resources external links more work alerts payouts earnings swipe right slide drag finger gesture press release settings hidden disappeared scroll up down top left'),
  article('pull-refresh', 'How do I pull down to refresh the dashboard?', 'Getting started', 'On a phone, pull down from the top of a page to reload its latest data while staying signed in.', [
    'Scroll to the very top, then pull down on the page background, a card, or a button until you see Release to refresh. Let go to refresh; release earlier to cancel.',
    'A brief Refreshed confirmation appears when the latest available data has loaded, then the page quickly slides back into place. Your page, filters, and checklist progress stay in place.',
    'A refresh reads the latest published appointment and payment data along with live work, alerts, and the open page’s information. Calendar and Stripe imports still run on their five-minute schedule.',
    'Tap the active mobile toolbar tab to glide to the top and refresh in one motion, without a second downward shift. Changing to another tab updates its information quietly. Your device’s Reduce Motion setting skips the glide.',
    'If some updates cannot load, the last available information stays visible. Check your connection and pull again.',
    'Close the sidebar or any open dialog first. Text fields, selectors, and scrolling calendars keep their normal gestures. Tapping a button still activates it; dragging down from it refreshes without pressing it.',
  ], 'pull down refresh reload update latest data mobile iphone phone swipe stale offline retry sync signed in'),
  article('install-iphone', 'How do I put the dashboard on my iPhone Home Screen?', 'Account & notifications', 'Use the Home Screen app for quick access and iPhone push notifications.', [
    'Open dashboard.smoothstudios.co in Safari.',
    'Tap Share (it may be inside Safari’s page menu), then Add to Home Screen. Keep Open as Web App on if shown, then tap Add.',
    'Open the new Smooth Studios icon and sign in.',
    'Open Settings → Preferences → Notifications and choose Enable on this device.',
  ], 'iphone ios apple safari install download app home screen push notifications'),
  article('quick-sign-in', 'How do I set up Face ID or quick sign-in?', 'Account & notifications', 'Quick sign-in uses a saved passkey and your device’s own unlock method.', [
    'Sign in with your dashboard account and password first.',
    'Open Settings → Preferences → Quick sign-in and choose Create a passkey.',
    'Follow the device prompt to create or save the passkey. The available unlock method depends on your device.',
    'Use Test quick sign-in in Settings to check it. The dashboard does not create a separate four-digit app PIN.',
  ], 'faceid face id fingerprint biometrics pin four digit 4 digit password passkey faster login quick sign in'),
  article('fix-sign-in', 'What if Face ID or quick sign-in fails?', 'Account & notifications', 'You can return to password sign-in and reconnect the saved passkey.', [
    'On the failed sign-in screen, choose Use password.',
    'After signing in, open Settings → Preferences → Quick sign-in.',
    'Choose Reconnect saved passkey and select the passkey for this account.',
    'Use Test quick sign-in. If the device cannot use that passkey, use the new-passkey option in Settings.',
  ], 'faceid broken not working login error recover reconnect passkey password unavailable'),
  article('switch-account', 'How do I sign in to a different account?', 'Account & notifications', 'Use the account switch below quick sign-in when this device remembers someone else.', [
    'On the sign-in screen, choose Sign in to another account.',
    'Select your own account and enter its password.',
    'If you are already signed in, use Log out at the bottom of the sidebar first.',
    'Logging out turns off this account’s push notifications on that device. Enable them again after signing back in.',
  ], 'switch account wrong name remembered login logout log out sign out shared device'),
  article('alerts-inbox', 'Where can I see my notifications and unread alerts?', 'Account & notifications', 'Alerts keeps your assignment updates and quiz reminders together, even if a push was missed.', [
    'Open Alerts in the mobile toolbar or sidebar. On desktop, you can also use the bell at the top. The badge shows your unread count.',
    'Switch between All and Unread. Swipe over alert rows to scroll; sliding does not activate an alert or show a sticky hover highlight. Each compact alert has a title row, message row, and time/status row. Tap it to open the related assignment with its current status; quiz reminders open today’s quiz on Home.',
    'Opening an alert marks it read. Use its More menu to mark it read without opening it, or Mark all read to clear the alerts available at your last refresh. Reading an offer does not accept it.',
    'Smooth’s Alerts are separated into named, color-marked sections for each person. Each section keeps the newest loaded alerts first. Use Load more for earlier history.',
    'Choose More → Delete to remove an alert from your inbox across devices. Use Undo in the Alert deleted notice to restore your most recent deletion while that notice is available. Deleting an alert keeps the related booking, task, or quiz available.',
    'Read status and deletions follow your account across devices. Each person manages only their own inbox. The inbox works with push notifications turned off; enable push separately in Settings → Preferences → Notifications.',
    'History starts with this update; older delivered pushes cannot be recovered. Earlier quiz reminders remain in history, but do not reopen expired questions. Use Load more for older alerts.',
  ], 'alerts notification history inbox unread bell toolbar messages missed read all archive saved notifications delete remove undo restore more actions'),
  article('quiz-push', 'How do I get Quiz Time notifications?', 'Account & notifications', 'Quiz Time reminds employees when their next Daily Quiz question becomes available.', [
    'Enable notifications on this device in Settings → Preferences → Notifications. On iPhone, use the installed Home Screen app.',
    'Open your dashboard to start that day’s quiz. Later questions become available at least two hours apart, up to three questions per day.',
    'If the next question has not already been shown or answered, a Quiz Time push is queued when the reminder service checks. Keep notifications enabled; you can close the app without logging out.',
    'Tap the push or open the reminder in Alerts to go to Daily Quiz on Home. A reminder does not award points or submit an answer.',
    'No reminders start a new day for you before you visit. Device notification settings and Focus can delay or hide a push; Alerts keeps the reminder available.',
  ], 'quiz time push notification creative question reminder daily next two hours', 'employee'),
  article('enable-alerts', 'How do I turn on notifications?', 'Account & notifications', 'Employees manage notifications in Settings → Preferences.', [
    'Open Settings → Preferences → Notifications.',
    'Choose Enable on this device, then allow the permission prompt.',
    'Choose Send test to check delivery on the device you are using.',
    'You can receive rental and task offers and Quiz Time reminders when the next Daily Quiz question is ready. Find saved notifications in Alerts. Closing the app keeps notifications enabled; logging out disables them.',
  ], 'notifications push alerts enable turn on bell messages rental task quiz reminder', 'employee'),
  article('owner-alerts', 'How do I receive employee acceptance notifications?', 'Account & notifications', 'Your notification controls are in Settings → Preferences.', [
    'Open Settings → Preferences and expand Notifications.',
    'Choose Enable on this device and allow the device prompt. Use Send test to check delivery.',
    'Employee acceptance or decline alerts identify the person and assignment. Open the assignment to review its saved response.',
    'An alert is a reminder; the accepted status on the assignment is the confirmation.',
  ], 'notifications push owner smooth acceptance decline employee response alerts', 'owner'),
  article('fix-alerts', 'Why am I not getting notifications?', 'Account & notifications', 'Check the same device where you want to receive alerts.', [
    'On iPhone, open the installed Home Screen app. A normal Safari tab may not offer push notifications.',
    'In Notifications, check the device status. Enable or reconnect the device, then choose Send test.',
    'If you see “Notifications were not allowed”, search Help for that message to find permission and iPhone reinstall steps. Also check Focus or Do Not Disturb.',
    'If the service could not be reached, reconnect to the internet and retry. Open Alerts to check saved notifications and respond to assignments while fixing push delivery.',
  ], 'notification denied not allowed failed could not reached missing test alert iphone focus do not disturb'),
  article('notifications-not-allowed', 'How do I fix “Notifications were not allowed”?', 'Account & notifications', 'Allow notifications in your device settings. If the iPhone app is still blocked or missing, try removing it and adding it again.', [
    'On iPhone, open your phone’s Settings → Notifications and select Smooth Studios (or the name you used when adding the app). Turn on Allow Notifications, then return to the dashboard and try Enable on this device.',
    'If the app is missing from that list or still blocked, try removing and re-adding the Home Screen app. First save any unfinished edits and make sure you have your dashboard password; you may need to sign in and reconnect quick sign-in afterward.',
    'Touch and hold the Smooth Studios Home Screen icon, then choose the option to delete or remove the web app and confirm.',
    'Open dashboard.smoothstudios.co in Safari. Tap Share (it may be inside the page menu) → Add to Home Screen. Keep Open as Web App on if shown, then tap Add.',
    'Open the newly added icon, sign in, and go to Settings → Preferences → Notifications. Choose Enable on this device, then Allow when asked.',
    'Choose Send test to check delivery. If notifications are enabled but nothing arrives, check Focus or Do Not Disturb and the app’s alert settings.',
    'On other devices, allow Notifications for dashboard.smoothstudios.co in your browser’s site permissions and allow the browser’s notifications in device settings. Reload the dashboard and enable notifications again.',
    'If you only dismissed the permission prompt, tap Enable on this device again and choose Allow. You can still view and accept assignments in the dashboard while fixing notifications.',
  ], 'notifications not allowed denied blocked permission dont allow declined iphone ipad ios apple safari delete remove reinstall readd re-add add again home screen reset fix recover'),
  article('appearance', 'How do I switch between light and dark mode?', 'Account & notifications', 'Appearance controls are in Settings → Preferences.', [
    'Open Settings → Preferences.',
    'Under Appearance, change the Dark mode switch.',
  ], 'dark light theme appearance color mode'),
  article('accept-rental', 'How do I accept or decline a rental?', 'Schedule & availability', 'A pending offer needs your response before it is confirmed in the app.', [
    'Open Home or My Schedule and find the offer.',
    'Review the date, full time range, client or rental name, and preparation instructions.',
    'Choose Accept if you can cover it, or Decline if you cannot. Smooth receives your response.',
    'If a time conflict blocks acceptance, contact Smooth to review it. After accepting, contact Smooth if your plans change.',
  ], 'accept decline rental booking appointment offer invitation assignment pending confirm response', 'employee'),
  article('next-work', 'Where do I see my next assignment and its instructions?', 'Schedule & availability', 'Home shows upcoming work. My Schedule contains the fuller schedule and past responses.', [
    'On Home, open an item under Next assignments to read Rental details and Preparation & instructions.',
    'Open My Schedule for all upcoming offers and appointments.',
    'Use the Past view to check older appointments and offers.',
  ], 'next upcoming coming up appointment instructions details date time history past work', 'employee'),
  article('preferred-days', 'How do I add days I want to work?', 'Schedule & availability', 'Work preferences tell Smooth when you would like an assignment.', [
    'Open My Availability and add a work preference.',
    'Choose the date and either a full day or specific hours. Add a note if useful.',
    'For a repeating preference, choose the weekly option and its last date, then save. If a list has more than three entries, use Show N more to see the remaining times.',
    'A preference expresses interest; it does not create or confirm an assignment. You still accept offers separately.',
  ], 'available availability days hours want work preference preferred shift repeat weekly', 'employee'),
  article('block-time', 'How do I block time for class or personal plans?', 'Schedule & availability', 'Blocked time shows a known conflict so it can be considered before work is assigned.', [
    'Open Availability and choose Block time.',
    'Enter a reason for being unavailable, then the start and end. The reason starts blank.',
    'For a weekly class or recurring commitment, enable the weekly repeat and choose the last date.',
    'Save the block. If another schedule update arrives during saving, the dashboard refreshes and retries once without clearing your entries. If a second update interrupts the save, try again from the same form.',
    'Existing assignments are not automatically cancelled; contact Smooth about any accepted work that overlaps.',
  ], 'unavailable block time off class college school vacation personal recurring weekly conflict availability'),
  article('calendar-meaning', 'What do the accepted checks and pending labels mean?', 'Schedule & availability', 'App acceptance and Google Calendar acceptance are separate confirmations.', [
    'Accepted in app means the employee accepted that offer in the dashboard.',
    'Calendar accepted means they accepted the Google Calendar invitation.',
    'A pending label means the app offer is still awaiting a response. Receiving a push notification alone does not accept it.',
    'For studio rentals, the app response is copied into the Google Calendar event description after syncing. Google’s own guest RSVP check remains separate.',
    'Pending and tentative Google Calendar rental invitations also appear in the live app schedule. Respond in Google Calendar to update that invitation’s RSVP status.',
  ], 'green check tick accepted calendar google rsvp invite verified verification confirmation pending'),
  article('schedule-layout', 'How do I use the calendar views and filters?', 'Schedule & availability', 'Choose the view that makes the day or week easiest to scan.', [
    'Open Team Schedule and choose a calendar view, or use the list for upcoming work.',
    'Use Today, the arrows, or the month navigator to move between dates.',
    'Filter by team member to focus on one person. Open an event for its details and saved responses.',
    'Open Availability for one compact panel. Everyone starts with collapsed person rows; open a name or use the Team member picker to jump directly to their times.',
  ], 'calendar month week day list agenda filter employee navigation view schedule phone mobile', 'owner'),
  article('team-availability', 'How do I quickly find someone’s availability?', 'Manage the studio', 'Availability keeps everyone in one compact panel with a Team member picker.', [
    'Open Availability. Everyone starts as simple name rows with counts for preferred and unavailable entries.',
    'Tap a person to expand their times. Opening another name collapses the previous person. Choose a specific person in Team member to open them directly.',
    'Each section initially shows three entries. Use Show N more to reveal the rest, or Show less to keep the panel short.',
    'Use Add work preference or Block time within the person’s expanded row. Smooth can block personal time; work preferences belong to employees.',
    'Include past entries adds older records to the same person’s list. Returning the picker to Everyone closes the expanded details.',
  ], 'availability person everyone team member jump find compact collapsed accordion preferred unavailable times days work', 'owner'),
  article('calendar-rental-sync', 'How do Google Calendar rental assignments appear in the app?', 'Schedule & availability', 'Rental guests whose invitation address matches a team account sync into the live dashboard schedule.', [
    'Add the employee as a guest on the Google Calendar studio rental using their configured invitation email address.',
    'The scheduled Calendar import runs every five minutes; workflow timing can vary. Open Schedule or refresh the app after the import.',
    'Pending and tentative invitations appear with their Calendar status. Respond to those invitations in Google Calendar; app offers keep their own response controls.',
    'Confirmed hours and earnings require the existing acceptance and completion rules. A pending Calendar invitation does not add hours or earnings.',
  ], 'google calendar rental guest invite invitation assigned sync pending tentative accepted email roster calendar rsvp', 'owner'),
  article('assign-rental', 'How do I assign a studio rental?', 'Manage the studio', 'Create an offer in Team Schedule or add the employee as a Google Calendar rental guest.', [
    'Open Team Schedule and select the rental, or choose Assign work and select its Calendar appointment.',
    'Choose the employee and review the date, time, and availability information. Add instructions, then save.',
    'The employee sees the offer in the dashboard and receives a push alert if notifications are enabled.',
    'Check for Accepted in app. Rental assignment notes also appear near the top of the Google Calendar description after the next sync.',
  ], 'assign rental booking appointment employee person studio calendar send offer invitation', 'owner'),
  article('override-conflict', 'How do I override a scheduling conflict or reassign work?', 'Manage the studio', 'Smooth can approve a recorded overlap, but the employee still needs to accept the offer.', [
    'When creating the offer, review the listed conflicts and enable the conflict override before saving.',
    'For an existing offer, use Allow time conflict after reviewing the overlap.',
    'Changing the assignment time clears the earlier conflict approval. Review the new time again.',
    'To reassign a booking, cancel the existing app offer and create an offer for the new person. Cancelling an app offer does not remove a separate Google Calendar invitation.',
  ], 'override conflict overlap overlapping double booked reassign change employee cancel offer', 'owner'),
  article('creative-submit', 'How do I accept and submit creative work?', 'Creative work', 'Creative Work holds deliverables such as edits, photo selections, designs, and posts.', [
    'Open Creative Work, select the assignment, and check the deadline and agreed pay, plus any brief or reference links.',
    'Choose Accept assignment to start, or Decline offer if you cannot take it.',
    'When it is ready, upload the files to Content Vault or your sharing service. Choose Submit work and paste links Smooth can open.',
    'If changes are requested, read the feedback and submit a revised version. Pay becomes earned after Smooth approves the submission.',
  ], 'creative task project edit deliverable submit upload files links video photos design accept deadline feedback revision', 'employee'),
  article('creative-manage', 'How do I assign, review, and pay creative work?', 'Creative work', 'Add past or upcoming creative work with a deadline and fixed agreed pay. A brief is optional.', [
    'Open Creative Work → Assign work. Choose the employee, add the title, set the deadline and agreed pay, and save. Leave Brief & deliverables blank when instructions are not needed.',
    'Use a past deadline to add older work, or choose a deadline up to two years ahead. Edit offer also allows past deadlines and an empty brief before the employee accepts.',
    'Older work still follows the acceptance, submission, and approval steps. Earnings are counted when approved; entering a past deadline does not record a payout.',
    'Open submitted work to review the links. Choose Request changes or Approve work.',
    'Approved work appears in earnings and Payouts. A remaining advance covers eligible earnings first.',
    'After sending any remaining payment yourself, choose Record payout and enter the amount. This records payment; it does not transfer money.',
  ], 'creative create assign brief optional notes no note empty blank deadline past date backdate older historical work flat fee approve submitted review revisions payment payout', 'owner'),
  article('earnings', 'How do I read my earnings and pay owed?', 'Earnings & advances', 'Earned pay, upcoming estimates, and payments are different stages.', [
    'Open Earnings to see the summary, monthly chart, and appointment details. Choose a year to look at earlier earnings.',
    'Appointment pay becomes earned once the appointment is complete and the customer is fully paid. A future assignment is an estimate until then.',
    'Approved creative work is included in earnings. Unapproved creative work stays projected.',
    'Pay owed is earned pay that has not been recorded as settled. If something looks wrong, give Smooth the appointment or assignment name and date.',
  ], 'money earned earnings paycheck payroll payment paid owed income estimate pending commission rate', 'employee'),
  article('advance-balance', 'How does an advance affect my pay?', 'Earnings & advances', 'An advance is money already provided that covers eligible earnings as you earn them.', [
    'While an advance remains, the main pay card shows Advance remaining.',
    'Unpaid earned appointments and approved creative work reduce that balance. Work already marked paid stays unchanged.',
    'Appointment and creative-work details show the amount covered by the advance. Repeated syncs do not deduct it again.',
    'Once the balance reaches zero, the display returns to pay owed. If an earning is larger than the advance left, the extra amount becomes owed.',
  ], 'advance loan credit balance remaining clears prepaid already paid salary deduction earnings money'),
  article('owner-finances', 'What do This week and This month measure?', 'Earnings & advances', 'Home shows completed revenue, earned team pay, and the amount after team pay.', [
    'Revenue includes completed, fully paid appointments and their tips, grouped by the appointment date.',
    'Team pay includes the earnings for those appointments and creative work approved during the period. Pay remains a cost whether already paid, covered by an advance, or still owed.',
    'After team pay subtracts that team cost from revenue. Fees and other studio expenses are not deducted.',
    'Use Payouts for outstanding balances and payment history. Upcoming bookings and customer deposits are not completed revenue.',
  ], 'revenue money income made week month net profit subtraction team cost expenses payroll home overview total', 'owner'),
  article('team-hours', 'Where do I see each person’s hours by week?', 'Manage the studio', 'Home shows Team hours for every employee, with controls for earlier weeks.', [
    'Open Home and find Team hours. Use Previous week and Next week to browse completed weeks, or This week to return to the current totals. Each row keeps the person’s name and hours inside the card. The date range uses the studio’s Monday–Sunday week.',
    'Hours include accepted appointments and custom tasks that have ended. Pending, declined, cancelled, future, and still-running work does not add hours.',
    'The totals use Calendar booking start/end times and scheduled custom tasks from the live dashboard schedule, not clock-in records. Overlapping assignments and duplicate invitations count once. Hours do not depend on the customer’s payment status. Older weeks depend on the available imported schedule history.',
  ], 'team hours worked weekly per person employee work duration timesheet monday sunday', 'owner'),
  article('team-payouts', 'How much do I owe each team member?', 'Earnings & advances', 'Payouts starts with Pay by team member.', [
    'Find each person’s Amount owed, Total earned, and Paid totals in a simple row. Amount owed is the remaining earned pay you still owe that person. Advance applied appears separately only for the person whose earnings used that advance credit.',
    'The totals cover all recorded completed, fully paid appointments and approved creative work. Future work and unapproved submissions are not earned yet.',
    'Advance credits reduce only that person’s Amount owed without counting twice as earnings or reducing anyone else’s pay. Paid excludes the advance credit shown separately. The separate advance balance shows how much remains to be worked off.',
    'Record appointment pay and creative payouts using their existing controls after sending the payment.',
  ], 'payouts pay each person earned made total outstanding owe money advance balance', 'owner'),
  article('rental-details', 'Where can I read the client’s rental details?', 'Schedule & availability', 'Open a rental to see the client information and form answers provided with the booking.', [
    'In Schedule, open the booking and its Details section. Employees can also expand a rental under Next assignments on Home.',
    'Rental details includes the booking’s calendar, client name, phone, email, listed price, paid-online amount, rental form name, and setup answers such as shoot type, backdrop, and props. Blank form answers say Not provided. Preparation instructions added by Smooth remain separate.',
    'Details update after the next Calendar import. Smooth and the employees assigned to the rental can see them. The price and paid-online amount here are the values recorded in the booking description; the payment summary tracks the latest reconciled payment status.',
  ], 'rental appointment description booking client setup backdrop lights equipment photoshoot notes'),
  article('record-payout', 'How do I mark employee appointment pay as paid?', 'Earnings & advances', 'Record a payout after you have paid the employee.', [
    'Open Payouts → Record appointment pay.',
    'Choose the specific employee or all employees, then the last appointment date covered.',
    'Review the employee scope and eligible appointments, then confirm Mark earnings paid.',
    'Advance-covered earnings are already settled and do not need a second payment. Record creative-work payments on their own assignments.',
  ], 'mark paid employee payroll payout paid through individual employee cash apple pay record payment', 'owner'),
  article('review-customer-payment', 'How do I review a customer deposit or missing balance?', 'Manage the studio', 'Use the payment review controls to reconcile what was actually received.', [
    'Open the appointment’s payment review and compare Price, Recorded online, and Remaining.',
    'A partial payment on a future appointment is a deposit. A completed appointment with an unconfirmed remainder needs review.',
    'If you have confirmed the remainder through an invoice, cash, or another payment method, record the appropriate paid decision. Choose Not fully paid if a balance is still due.',
    'If the recorded payment is above the price, the extra is treated as a tip. Clear a manual status when you want the imported payment data to decide again.',
  ], 'customer price deposit pending review overdue unpaid remainder invoice acuity cash apple pay tip manual override', 'owner'),
  article('match-stripe', 'How do I match an unmatched Stripe payment?', 'Manage the studio', 'Match only when the charge and appointment belong together.', [
    'Open a payment in the Stripe matching area and choose the correct Calendar appointment.',
    'Compare the customer, payment date, amount, appointment date, and appointment price before saving.',
    'Choose Save payment match. A deposit, final payment, and tip can each be linked to the same appointment.',
    'Payment dates can differ from appointment dates. If you cannot identify the correct appointment, leave the payment unmatched until you can verify it.',
  ], 'stripe match unmatched charge payment receipt received invoice transaction deposit tip verification reconcile', 'owner'),
  article('sync-data', 'How do I refresh Calendar, payments, and assignment notes?', 'Manage the studio', 'Automatic sync is scheduled every five minutes. Workflow timing can vary.', [
    'Open Settings → Preferences → Data sync.',
    'Choose Sync now, review the action, and start it.',
    'Wait for completion. If it fails, use View details to see the workflow result before retrying.',
    'App assignment responses save immediately. Imported Calendar data, payments, payroll snapshots, and Calendar description notes update through sync.',
  ], 'sync refresh reload data calendar google stripe five 5 minutes workflow github stale not updated failure', 'owner'),
  article('studio-info', 'Where are the studio contacts, access codes, and Wi-Fi?', 'Studio resources', 'Studio Info keeps those details together for signed-in team members.', [
    'Open Settings → Studio info.',
    'Search for the item or filter by Contacts, Access, or Wi-Fi.',
    'Open a contact to expand its details. Use Show to reveal a hidden code and Copy where available.',
    'Keep access details within the authorized team.',
  ], 'contact phone number tay access code door lock password wifi wi fi internet key studio information'),
  article('rental-checklist', 'How do I use the rental checklist?', 'Studio resources', 'The checklist is a reusable guide for any studio rental.', [
    'Open Rental Checklist under Resources in the sidebar.',
    'Reset the checklist before starting the next rental.',
    'Work through the sections and check each completed step. The progress count shows what remains.',
    'Your checks stay in the current tab until you reset the list or close the tab. They are not a shared completion record for a specific booking.',
  ], 'rental checklist prep before after clean walkthrough backdrop lights strobe speaker polaroid reset steps setup'),
  article('guidelines', 'How do I find a studio rule or ask an unanswered question?', 'Studio resources', 'Studio Guidelines contains the studio’s operating rules and answers.', [
    'Open Studio Guidelines under Resources.',
    'Type what you need in search, or choose a category and open a matching question.',
    'If the answer is missing, choose Ask a question and add it to the queue.',
    'Check back after Smooth answers and publishes it. Help explains the dashboard; Studio Guidelines explains how the studio operates.',
  ], 'guidelines rulebook rules policy policies search questions answer queue ask request studio guide'),
  article('edit-resources', 'How do I update studio information and checklist steps?', 'Studio resources', 'Smooth can edit the shared studio resources.', [
    'For contacts, access, and Wi-Fi, open Settings → Studio info. Choose Add info, or Edit on an existing item.',
    'Set its category, label, value, and optional note. Use the code/password type for details that should start hidden.',
    'For the rental checklist, open Resources → Rental Checklist → Edit checklist.',
    'Add, edit, or remove steps and organize them by section. Save your changes for the team.',
  ], 'edit add remove delete contact access wifi information checklist steps customize sections', 'owner'),
  article('edit-guidelines', 'How do I publish guidelines and answer queued questions?', 'Studio resources', 'Use the owner controls in Studio Guidelines to keep the rulebook current.', [
    'Open Studio Guidelines → Edit or import, then choose New guideline or select an existing entry.',
    'Use a clear question as its title, a short answer, a suitable category, and useful search tags.',
    'Open Questions to answer to review the queue when you have time. Turn useful answers into published guidelines.',
    'Review the changes and publish them. Importing or editing a draft alone does not replace the team’s published guide.',
  ], 'guidelines rulebook publish edit import categories tags questions queue unanswered build together draft', 'owner'),
  article('external-apps', 'How do I open Productions or Content Vault?', 'Studio resources', 'These sidebar links open separate apps.', [
    'Choose Productions for production planning, or Content Vault for files and deliverables.',
    'The external-link icon means you are leaving this dashboard. The destination may ask you to sign in separately.',
    'For a creative submission, copy a shareable file or folder link and add it to Submit work in Creative Work.',
  ], 'productions production external links content vault upload files folder sharing deliverable shot list'),
  article('temp-check', 'How do I use Temp Check?', 'Temp Check & SmoothStars', 'Temp Check is a quick mood check-in on Home.', [
    'Open Home and choose Temp Check, or use the check-in popup when it appears.',
    'Choose the emoji that fits how you feel, or skip the check-in.',
    'The next check-in becomes available after three hours. Temp Check and Daily Quiz controls appear on Home.',
  ], 'temp temperature check mood emoji happy sad tired chilling overwhelmed checkin feeling popup'),
  article('daily-quiz', 'How do Daily Quiz questions and points work?', 'Temp Check & SmoothStars', 'You can answer up to three questions a day, with time between them.', [
    'Open Home → Daily Quiz when a question is ready.',
    'Choose your answer and submit it. Correct answers earn Easy: 5 points, Medium: 10, or Very Hard: 15.',
    'After answering, the next question unlocks two hours later. The remaining difficulty is chosen for you; the three daily questions are not offered at once.',
    'The questions cover photography, video, cameras, lighting, and studio work. Different employees receive different questions. Enable notifications for reminders when the next question is ready.',
  ], 'daily quiz creative question points answer correct wrong difficulty easy medium hard 5 10 15 two hours next tomorrow'),
  article('smoothstars', 'Where do I see my points and SmoothStars?', 'Temp Check & SmoothStars', 'Road to a SmoothStar lives in the sidebar.', [
    'Open the sidebar and look for Road to a SmoothStar.',
    'The card shows your points, collected stars, and progress toward the next one.',
    'Tap it to open My SmoothStars and see recent quiz answers. Each new goal takes 500 points; earlier stars and progress are preserved. The large X at the top and Done at the bottom stay visible while you scroll.',
    'Smooth can also adjust points or award and remove stars. Your current totals reflect those changes.',
  ], 'smoothstar smoothstars stars sticker reward points progress goal 500 score collection road badge'),
  article('manage-stars', 'How do I adjust points, stars, or today’s check-in?', 'Manage the studio', 'The team engagement controls let Smooth manage an employee’s current progress.', [
    'Open the team check-ins and SmoothStars area, then select the employee.',
    'The person opens on Overview with their latest Temp Check, points, stars, and today’s quiz progress. Choose Manage to reveal the editing controls.',
    'Choose the points or star action and enter the amount where requested.',
    'To let someone retry, reset today’s Temp Check or the selected question. Resetting a question removes points from that answer before a new attempt.',
    'Review the result. Use History and expand Temp Checks, Points & SmoothStars, Quiz answers, or Resets to review activity. Close with the large X at the top or Done at the bottom; both stay visible while you scroll. Points and star adjustment history is visible only to Smooth.',
  ], 'admin add remove reset points stars smoothstars mood temp check question daily quiz retry reward', 'owner'),
  article('team-accounts', 'How do I set up a new employee’s dashboard access?', 'Manage the studio', 'Use Team to manage the people who work with the studio.', [
    'Open Team → People and find the employee’s compact card. It shows earned pay, Still owed or Advance left, the appointment count, and the next accepted date.',
    'For an account awaiting setup, choose Set up private account and follow the owner setup flow.',
    'Employees use their own account to accept work, update availability, view earnings, and configure their own device settings.',
  ], 'new hire employee account access password team add onboarding login missing', 'owner'),
  article('updates', 'Where do I see what changed in the dashboard?', 'Getting started', 'The version and update history are at the bottom of the dashboard.', [
    'Open What changed from the version footer.',
    'Updates made on the same day share a box; each version still lists its own changes.',
    'Search or filter the history to find a feature. Employees see relevant feature and appearance notes; Smooth sees the complete history.',
    'Return to Settings → Help for instructions on using a changed feature.',
  ], 'version release updates notes changelog history what changed new features'),
];

const stop = new Set('a an and are as at be can could do does for from get have how i in is it me my of on or please the this to use we what where why with you your see much want need im ive find'.split(' '));
const equivalents = {
  faceid: ['face', 'id', 'passkey'], face: ['passkey'], login: ['sign', 'account'], signin: ['sign', 'account'],
  iphone: ['ios', 'safari'], alerts: ['notification'], alert: ['notification'], notify: ['notification'], notifications: ['notification'],
  money: ['pay', 'earnings'], paycheck: ['pay', 'earnings'], payroll: ['pay', 'earnings'], pay: ['earnings'],
  unavailable: ['block', 'time'], vacation: ['block', 'time'], classes: ['class'], school: ['class'],
  booked: ['rental'], booking: ['rental'], appointment: ['rental'], sticker: ['smoothstar'], star: ['smoothstar'], stars: ['smoothstar'],
  wifi: ['wi', 'fi'], password: ['sign', 'account'], upload: ['submit', 'files'], submitted: ['submit'],
};
const normalize = value => value.toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
const stem = word => word.length > 4 ? word.replace(/(?:ing|ies|s)$/, ending => ending === 'ies' ? 'y' : '') : word;
const words = value => normalize(value).split(' ').filter(word => word && !stop.has(word));
function closeWord(a, b) {
  if (a === b || (a.length >= 4 && b.startsWith(a))) return true;
  if (Math.min(a.length,b.length) < 5 || Math.abs(a.length-b.length) > 1) return false;
  let i=0,j=0,difference=0;
  while(i<a.length && j<b.length) {
    if(a[i]===b[j]) {i++;j++;continue;}
    if(++difference>1)return false;
    if(a.length>=b.length)i++;
    if(b.length>=a.length)j++;
  }
  return difference+(a.length-i)+(b.length-j)<=1;
}
export const helpForRole = isOwner => HELP_ARTICLES.filter(item => isOwner || item.role !== 'owner');
export function searchHelp(query, isOwner, category = 'all') {
  const available=helpForRole(isOwner).filter(item => category === 'all' || item.category === category);
  const terms=words(query);
  if(!terms.length)return available;
  return available.map(item => {
    const title=words(item.title).map(stem), tags=words(item.keywords).map(stem), content=words([item.summary,...item.steps].join(' ')).map(stem);
    let matched=0,score=0;
    for(const term of terms) {
      const choices=[term,...(equivalents[term]??[])].map(stem);
      const points=choices.some(q=>title.some(w=>closeWord(q,w))) ? 9 : choices.some(q=>tags.some(w=>closeWord(q,w))) ? 6 : choices.some(q=>content.some(w=>closeWord(q,w))) ? 2 : 0;
      if(points)matched++;score+=points;
    }
    if(normalize(item.title).includes(normalize(query)))score+=20;
    return {item,score:score*(matched/terms.length),matched};
  }).filter(result=>result.matched>0 && (terms.length<3 || result.matched>=Math.ceil(terms.length/2)))
    .sort((a,b)=>b.score-a.score || a.item.title.localeCompare(b.item.title)).map(result=>result.item);
}
