// Suggested policies only. Nothing becomes a guideline until Smooth answers.
import { guidelineTopic, tidyGuidelineBody } from "./guideline-content.mjs";
import { GUIDELINE_FOLLOWUPS } from "./guideline-followups.mjs";
/** @param {string} category
 * @param {Array<[string, string, string, Array<[string, string]>]>} rows */
const section = (category, rows) => rows.map(([id, title, prompt, choices]) => ({
  id, category: guidelineTopic(category), title, prompt,
  choices: choices.map(([label, body]) => ({ label, body })),
  tags: [category.toLowerCase(), title.toLowerCase().split(" ").slice(0, 3).join(" ")].filter(tag => tag.length <= 30),
}));

export const GUIDELINE_QUESTIONS = [
  ...section("Team & scheduling", [
    ["arrival-time", "Arrival and preparation time", "How early should the assigned team member arrive before a rental?", [
      ["15 minutes early", "Arrive at least 15 minutes before the rental begins so the studio is ready when the client arrives."],
      ["30 minutes early", "Arrive at least 30 minutes before the rental begins so there is time to prepare and check the studio."],
      ["Time set for each assignment", "Follow the arrival time specified in the assignment. Ask Smooth before the appointment if no preparation time is listed."],
    ]],
    ["accept-deadline", "Responding to assignments", "How quickly should someone accept or decline an assignment?", [
      ["Within 1 hour", "Accept or decline assignment offers within one hour of seeing the notification. Contact Smooth immediately if a same-day offer needs clarification."],
      ["Within 4 hours", "Accept or decline assignment offers within four hours. Respond to same-day offers as soon as possible."],
      ["By the deadline in the offer", "Respond by the deadline included in the assignment offer. If no deadline is provided, contact Smooth to confirm."],
    ]],
    ["availability-updates", "Keeping availability current", "When should team members update their availability and class schedules?", [
      ["As soon as anything changes", "Update dashboard availability as soon as a class, job, or personal commitment changes. Notify Smooth separately if the change affects accepted work."],
      ["Weekly check plus changes", "Review availability every Sunday and update new conflicts immediately. Notify Smooth if an accepted assignment is affected."],
      ["Before each scheduling period", "Submit availability before the scheduling period begins and report any later changes directly to Smooth."],
    ]],
    ["running-late", "Running late or unable to attend", "What should someone do if they are late or cannot cover accepted work?", [
      ["Call, then send an ETA", "Call Smooth immediately if you may be late or cannot attend accepted work. Send your estimated arrival time and wait for instructions about coverage."],
      ["Text, then call if urgent", "Text Smooth as soon as a problem arises. Call if the appointment is approaching or your message has not been acknowledged."],
      ["Use the team channel and call", "Post the coverage issue in the team channel and call Smooth. An accepted assignment remains your responsibility until a replacement is confirmed."],
    ]],
    ["coverage-swaps", "Swapping assignment coverage", "Can team members arrange their own coverage swaps?", [
      ["Smooth approves every swap", "Request approval from Smooth before swapping coverage. The replacement must accept the assignment and the dashboard must reflect the change."],
      ["Arrange it, then confirm", "Arrange a swap with an available team member, then send the details to Smooth for confirmation before treating the swap as final."],
      ["Smooth arranges replacements", "Contact Smooth when coverage is needed. Smooth will select and confirm the replacement."],
    ]],
    ["break-coverage", "Breaks during studio coverage", "How should breaks work while clients are using the studio?", [
      ["Coordinate coverage first", "Coordinate breaks with another assigned team member so clients know who is available to help. Do not leave an active rental without confirmed coverage."],
      ["Check with Smooth", "Check with Smooth before stepping away during an active rental and confirm how the client will receive assistance."],
      ["Plan around rentals", "Plan breaks between rentals whenever possible. Tell Smooth if appointment timing prevents a break so coverage can be arranged."],
    ]],
    ["shift-handoff", "Handing work to the next person", "What should be included when one team member takes over from another?", [
      ["Short written handoff", "Send the next team member a handoff covering active clients, upcoming bookings, setup changes, equipment issues, and anything still unfinished."],
      ["Walkthrough and written issues", "Walk through the studio with the next team member and send a written note about anything unresolved."],
      ["Dashboard notes", "Record handoff details in the assignment notes and confirm the incoming team member has reviewed them."],
    ]],
  ]),
  ...section("Opening & access", [
    ["opening-checkin", "Opening check-in", "How should the first person let you know the studio is open and ready?", [
      ["Message when ready", "Complete the opening checks, then message Smooth to confirm the studio is open and ready for clients."],
      ["Send a setup photo", "After opening checks, send Smooth a photo of the prepared studio and confirm that the space is ready."],
      ["Only report problems", "Complete the opening checks and contact Smooth promptly about any issue that could affect the first appointment."],
    ]],
    ["entry-problem", "Trouble accessing the studio", "What should someone do if their approved entry method does not work?", [
      ["Call Smooth immediately", "Call Smooth immediately if you cannot access the studio. Do not force a door or improvise another entry method."],
      ["Contact the assigned opener", "Contact the assigned opener first, then Smooth if access is still unresolved. Stay with any arriving clients and explain the delay."],
      ["Use the designated contact", "Contact the designated studio access contact. Keep Smooth informed if entry delays may affect a booking."],
    ]],
    ["key-control", "Handling keys and access details", "Who may receive studio keys or access instructions?", [
      ["Approved team members only", "Give keys and access instructions only to team members approved by Smooth. Do not share access details with clients or visitors."],
      ["Smooth handles all access", "Direct every request for keys or access instructions to Smooth. Team members must not pass access details to someone else."],
      ["Assignment-specific approval", "Share access instructions only when Smooth has approved that person for the specific assignment."],
    ]],
    ["occupied-entry", "Managing the entrance during rentals", "How should the entrance be managed while the studio is occupied?", [
      ["Greet every arrival", "Keep track of the entrance and greet every arriving visitor. Confirm their appointment before directing them into a studio."],
      ["Clients contact the host", "Ask arriving clients to contact their assigned host for entry. Keep all required exits usable while the studio is occupied."],
      ["Follow the assigned host plan", "The assigned host manages client entry for each booking and keeps required exits usable throughout the rental."],
    ]],
    ["outside-hours", "Requests outside regular hours", "Who may approve a booking outside the normal studio hours?", [
      ["Smooth only", "Only Smooth may approve bookings outside regular studio hours. Do not promise access or coverage until approval is confirmed."],
      ["Ask before discussing options", "Refer requests outside regular hours to Smooth before discussing availability or pricing with the client."],
      ["Only prearranged bookings", "Provide access outside regular hours only for bookings that Smooth has approved and added to the schedule in advance."],
    ]],
    ["opening-issues", "Issues discovered on arrival", "What should happen if someone opens the studio and finds damage or a mess?", [
      ["Document, then contact Smooth", "Photograph the issue before changing the setup, contact Smooth, and explain whether it affects the next booking."],
      ["Clean minor issues; report damage", "Handle minor cleanup before the client arrives. Document and report damage, missing equipment, or a condition that prevents safe use."],
      ["Report everything before reset", "Report unexpected damage, missing items, or leftover mess to Smooth before resetting the affected area."],
    ]],
    ["personal-guests", "Personal visitors while working", "May team members bring friends or personal visitors while covering the studio?", [
      ["Only with prior approval", "Personal visitors require Smooth's approval before they come to the studio. Visitors must not interfere with clients or assigned work."],
      ["No personal visitors", "Do not bring personal visitors while covering studio assignments."],
      ["Brief visits with notice", "Tell Smooth before a brief personal visit. Keep visitors out of active rental spaces and focused work areas."],
    ]],
  ]),
  ...section("Rental preparation", [
    ["booking-review", "Reviewing the booking", "Besides the backdrop color, which booking details must the host review before setup?", [
      ["Full booking and add-ons", "Review the studio, start and end times, client requests, headcount when provided, props, equipment, and paid add-ons before preparing the space."],
      ["Studio, timing, and requests", "Confirm the assigned studio, appointment timing, and all client setup requests before preparation."],
      ["Use a written setup checklist", "Review the booking and create a brief setup checklist for any special equipment, props, or client requests."],
    ]],
    ["missing-booking-detail", "Missing setup information", "What should the host do if the calendar is missing a backdrop color or another setup detail?", [
      ["Ask Smooth", "Ask Smooth to confirm missing setup information before making a choice for the client."],
      ["Ask the client through approved contact", "Use the approved client contact method to confirm missing setup details and update the booking notes."],
      ["Prepare a neutral setup and confirm", "Prepare a neutral starting setup when information is missing, then confirm the client's choice before the rental starts."],
    ]],
    ["requested-item-unavailable", "Unavailable requested equipment or backdrop", "What should happen if a requested item is unavailable or not usable?", [
      ["Smooth approves the alternative", "Notify Smooth immediately when a requested item is unavailable. Confirm an approved alternative before promising it to the client."],
      ["Offer available options", "Explain the unavailable item to the client, offer suitable available alternatives, and notify Smooth of the change."],
      ["Wait for a replacement plan", "Pause that part of the setup and contact Smooth for a replacement plan. Continue preparing the rest of the studio."],
    ]],
    ["standard-lighting", "Default lighting setup", "What lighting setup should be ready when the client has not requested anything specific?", [
      ["Two-light starting setup", "Prepare and test a two-light starting setup when the booking does not specify a lighting arrangement."],
      ["One-light starting setup", "Prepare and test a one-light starting setup when the booking does not specify a lighting arrangement."],
      ["Use that studio's standard setup", "Prepare the standard starting setup assigned to Studio A or Studio B and test it before the client arrives."],
    ]],
    ["two-studio-priority", "Preparing both studios", "When Studio A and Studio B need attention at once, how should the host prioritize?", [
      ["Safety, then the next arrival", "Address urgent safety or equipment issues first, then prepare the studio with the earliest client arrival. Keep both clients informed when assistance is delayed."],
      ["Assign a host to each room", "Confirm who is covering each studio before clients arrive. Contact Smooth if two simultaneous rentals need more support than the assigned team can provide."],
      ["Check the coverage plan with Smooth", "Confirm the coverage and setup order with Smooth when both studios need attention at the same time."],
    ]],
    ["special-setup-approval", "Requests beyond the booked setup", "Can the host agree to special setups or extra accessories that were not booked?", [
      ["Ask before promising extras", "Check with Smooth before promising equipment, accessories, or setup work beyond the booking."],
      ["Included items only", "Help with available items that are already included in the rental. Refer additional equipment, charges, or extended setup requests to Smooth."],
      ["Check availability and pricing first", "Confirm availability and any additional charge before agreeing to an unbooked setup request."],
    ]],
    ["preparation-confirmation", "Confirming the space is ready", "Should the host document the prepared space before the client arrives?", [
      ["Photo before every rental", "Take a quick photo of the prepared space before each rental to document its starting condition."],
      ["Only unusual setups or issues", "Document unusual setups, existing damage, or equipment issues before the rental begins."],
      ["Checklist without photos", "Complete the preparation checklist before every rental. Take photos when an issue needs to be reported."],
    ]],
  ]),
  ...section("Client experience", [
    ["client-greeting", "Welcoming a client", "What should the host cover when a client first arrives?", [
      ["Brief tour and time reminder", "Welcome the client, confirm their booking and end time, show the assigned studio and restroom, and explain how to get help."],
      ["Tour plus equipment orientation", "Welcome the client, confirm the rental end time, show the facilities, and demonstrate the included equipment and trigger before the session begins."],
      ["Quick check-in", "Welcome the client, confirm the correct studio and booking, and ask whether they need help getting started."],
    ]],
    ["host-presence", "Where the host stays during a rental", "Where should the assigned team member be while clients are using the studio?", [
      ["On site and available", "Stay on site throughout the rental and remain available to assist. Give clients space to work without leaving them without support."],
      ["In the designated host area", "Remain in the designated host area during the rental and tell clients how to reach you for assistance."],
      ["Follow assignment instructions", "Follow the coverage instructions for the assignment. Do not leave an active rental unless Smooth has approved the arrangement."],
    ]],
    ["included-assistance", "What rental assistance includes", "How much setup or photography help should the host provide?", [
      ["Basic equipment help", "Help clients operate the included equipment and resolve basic setup issues. Direct requests for photography or creative production services to Smooth."],
      ["Setup plus lighting adjustments", "Help with the initial setup and reasonable lighting adjustments during the rental. Confirm additional services with Smooth."],
      ["Technical assistance only", "Provide technical assistance with studio equipment. The client remains responsible for their photography and creative direction."],
    ]],
    ["extra-attendees", "Unexpected additional guests", "What should the host do when more people arrive than the booking lists?", [
      ["Check with Smooth first", "Contact Smooth if more people arrive than listed in the booking. Confirm capacity and approval before admitting the additional guests."],
      ["Use the posted room limit", "Check the studio's approved occupancy limit before admitting additional guests and update the booking notes."],
      ["Keep to the booked headcount", "Keep attendance to the headcount approved for the booking unless Smooth authorizes a change."],
    ]],
    ["waiting-clients", "Early arrivals and waiting guests", "Where should early clients or people waiting for a session stay?", [
      ["Designated waiting area", "Direct early arrivals and waiting guests to the designated waiting area. Keep them out of another client's rental space."],
      ["Contact host before entering", "Ask early arrivals to contact the host before entering so the previous rental and studio reset are not interrupted."],
      ["Host decides based on available space", "The host may use an available waiting area while keeping active rentals private and pathways clear."],
    ]],
    ["unbooked-studio", "Using the other studio", "Can a client use Studio A and Studio B when only one was booked?", [
      ["Only with Smooth's approval", "Clients may use only the studio in their booking unless Smooth approves a change or additional rental."],
      ["Book the additional room first", "Arrange and confirm the additional studio booking before allowing a client to use both rooms."],
      ["Available room with approved upgrade", "Check room availability and obtain approval for any upgrade before moving a client into the other studio."],
    ]],
    ["changing-privacy", "Changing areas and client privacy", "How should staff protect privacy during outfit changes or private sessions?", [
      ["Use the designated changing area", "Show clients the designated changing area. Knock and wait for permission before entering a private or occupied space."],
      ["Confirm privacy needs at check-in", "Ask about privacy needs at check-in and agree on how the host will provide assistance without interrupting changing or private moments."],
      ["Coordinate access with the client", "Coordinate room access with the client whenever privacy is needed. Keep unrelated visitors out of the rental space."],
    ]],
  ]),
  ...section("Timing & extensions", [
    ["late-client", "Clients who arrive late", "Does a late arrival change the rental's scheduled end time?", [
      ["Original end time stays", "A late arrival does not change the scheduled rental end time. Any extension must be approved and added to the booking."],
      ["Smooth decides exceptions", "Keep the scheduled end time unless Smooth approves an exception. Do not promise replacement time to a late client."],
      ["Extend only if approved and available", "Check availability and request approval before offering a late client extra time."],
    ]],
    ["no-show", "When a client does not arrive", "When should the host report a client who has not arrived?", [
      ["After 10 minutes", "If the client has not arrived ten minutes after the start time, notify Smooth and follow the approved contact procedure."],
      ["After 15 minutes", "Notify Smooth when a client is fifteen minutes late and has not made contact. Wait for instructions before leaving or releasing the space."],
      ["At the start time", "Check for a message at the scheduled start time. If the client has not arrived or made contact, notify Smooth."],
    ]],
    ["end-reminder", "Rental end-time reminders", "When should the host remind clients that their rental is almost over?", [
      ["15 minutes before the end", "Give a polite reminder fifteen minutes before the rental ends so clients have time to finish and pack up."],
      ["10 minutes before the end", "Give a polite reminder ten minutes before the rental ends and confirm that the studio must be cleared by the scheduled end time."],
      ["Two reminders", "Give a reminder fifteen minutes before the end and a final reminder five minutes before the end."],
    ]],
    ["packup-time", "Packing up within rental time", "Should client packing and equipment reset fit inside the booked time?", [
      ["Client packing is included", "Clients should finish shooting and pack their belongings within the booked rental time. Staff complete the studio reset afterward."],
      ["Everything cleared by end time", "The client and their belongings must be out of the studio by the scheduled end time so the next setup can begin."],
      ["Explain the booking-specific arrangement", "Explain the packing and departure arrangement at check-in and follow the timing approved for that booking."],
    ]],
    ["extension-approval", "Approving extra rental time", "Who can approve an extension during a rental?", [
      ["Smooth approves every extension", "Ask Smooth before agreeing to extra time. Confirm availability and payment before extending the rental."],
      ["Host checks calendar and payment", "The host may approve extra time only when the calendar is clear, the published extension rate is confirmed, and payment is recorded."],
      ["Client books the extension", "Have the client complete an available extension booking before continuing beyond the original rental time."],
    ]],
    ["overrun", "Clients going past their end time", "What should the host do if a client continues past the agreed end time?", [
      ["Stop and contact Smooth", "Politely remind the client that the rental has ended. Contact Smooth if they do not begin leaving or request unapproved extra time."],
      ["Check for an approved extension", "Confirm whether an extension has been approved. If it has not, ask the client to finish packing and notify Smooth."],
      ["Escalate if next booking is affected", "Ask the client to clear the space at the scheduled end time and notify Smooth immediately if the next booking is at risk."],
    ]],
    ["early-finish", "Clients finishing early", "Can the host leave as soon as a client finishes early?", [
      ["Complete reset and confirm", "Complete the walkthrough and studio reset, then check with Smooth before leaving early."],
      ["Remain for assigned coverage", "Complete the reset and remain available for the rest of the assigned coverage period unless Smooth releases you."],
      ["Follow the assignment's end time", "Finish all closeout tasks and follow the end time specified in your assignment."],
    ]],
  ]),
  ...section("Equipment & lighting", [
    ["equipment-handling", "Who adjusts studio equipment", "Which equipment adjustments may renters make themselves?", [
      ["Basic controls after orientation", "Clients may use basic equipment controls after orientation. Ask the host before changing modifiers, moving heavy equipment, or altering the studio setup."],
      ["Staff handle setup changes", "Clients should ask the host for equipment moves and setup changes. Staff handle studio equipment adjustments."],
      ["Experienced users with host approval", "The host may approve familiar equipment adjustments after confirming that the client can operate the equipment safely."],
    ]],
    ["trigger-troubleshooting", "A camera trigger does not work", "What should the host do if the prepared trigger will not fire the lights?", [
      ["Basic checks, then escalate", "Check trigger power, connection, and matching channel settings. Use an approved replacement if available; contact Smooth if the issue continues."],
      ["Use the troubleshooting checklist", "Follow the equipment troubleshooting checklist and contact Smooth if the trigger still will not work. Do not keep changing unfamiliar camera settings."],
      ["Contact Smooth for help", "Contact Smooth if the trigger does not work after checking power and connection. Keep the client updated while the problem is resolved."],
    ]],
    ["equipment-failure", "Equipment stops working", "What should happen when a light or another piece of equipment fails during a rental?", [
      ["Stop using it and report", "Stop using the faulty equipment, inform Smooth, and move to an approved replacement when available. Record what failed and when."],
      ["Swap approved spare and notify", "Use an approved spare if it is safe to do so, notify Smooth, and set the faulty item aside so it is not reused."],
      ["Pause that setup for assistance", "Pause use of the affected setup and contact Smooth for assistance. Tell the client what is happening."],
    ]],
    ["equipment-storage", "Returning equipment to storage", "How should equipment be stored after use?", [
      ["Return to labeled locations", "Return equipment and accessories to their labeled storage locations so the next host can find them quickly."],
      ["Match the reference setup", "Return equipment to the approved studio layout and storage reference. Report any missing item."],
      ["Use the equipment checklist", "Check equipment against the reset checklist and return each item to its assigned place."],
    ]],
    ["charging-area", "Charging batteries safely", "Where should used strobe batteries be placed for charging?", [
      ["Designated charging station", "Use the designated charging station and approved chargers for strobe batteries. Keep the charging area clear and report damaged batteries or chargers."],
      ["Labeled charger for each battery", "Place each battery on its labeled compatible charger. Keep charged and charging batteries clearly separated."],
      ["Follow the equipment storage guide", "Charge batteries in the location shown in the equipment storage guide using only the assigned compatible charger."],
    ]],
    ["equipment-leaving", "Taking studio equipment off site", "Can team members or clients take studio equipment outside the building?", [
      ["Written approval first", "Do not take studio equipment off site without written approval from Smooth and a record of the items and return time."],
      ["Only approved production assignments", "Equipment may leave the studio only for an approved production assignment with a documented equipment list."],
      ["Rental equipment stays inside", "Studio rental equipment stays inside the studio. Refer off-site equipment requests to Smooth."],
    ]],
    ["client-equipment", "Clients bringing their own gear", "What should the host check when a client brings lights or other equipment?", [
      ["Placement and power needs", "Confirm that the client's equipment fits safely in the booked space and check power and cable placement before use."],
      ["Approve special equipment first", "Refer large or unusual equipment to Smooth for approval before it is brought into the rental space."],
      ["Allow gear within studio rules", "Clients may use their own equipment when it follows studio rules and does not damage the space or interfere with another booking."],
    ]],
  ]),
  ...section("Backdrops & props", [
    ["backdrop-changes", "Who changes backdrops", "Who should lower, raise, or change a backdrop during the rental?", [
      ["Team members only", "Clients must ask the host to lower, raise, or change a studio backdrop. Team members handle backdrop adjustments."],
      ["Host supervises adjustments", "The host must supervise backdrop adjustments and confirm the setup is secure before use."],
      ["Only trained team members", "Only team members trained on the backdrop system may change it. Contact Smooth if trained help is unavailable."],
    ]],
    ["extra-backdrop-color", "Additional backdrop colors", "How should the host handle a request for another backdrop color?", [
      ["Check approval and any charge", "Confirm availability, approval, and any additional charge before changing to an unbooked backdrop color."],
      ["Ask Smooth first", "Refer requests for additional backdrop colors to Smooth before making the change."],
      ["Included changes when available", "Provide an available color change when it is included in the client's rental. Confirm any additional charge before proceeding."],
    ]],
    ["damaged-paper", "Dirty or damaged backdrop paper", "What should happen when backdrop paper is torn or too dirty to use?", [
      ["Photograph and ask before cutting", "Photograph damaged or heavily soiled paper and ask Smooth before cutting or replacing a section."],
      ["Trained staff may reset it", "Trained team members may reset backdrop paper using the approved method. Record unusual damage or excessive paper use for Smooth."],
      ["Switch to an approved alternative", "Contact Smooth about unusable paper and confirm an alternative setup before offering it to the client."],
    ]],
    ["shoes-on-paper", "Footwear on backdrop paper", "What footwear rule should apply to seamless paper?", [
      ["Clean shoes before stepping on", "Check that footwear is clean before anyone steps onto backdrop paper. Keep outdoor dirt away from the shooting surface."],
      ["Shoe covers until the shot", "Use shoe covers while setting up on seamless paper and remove them only when needed for the photograph."],
      ["Follow the setup's stated rule", "Explain the footwear rule for the selected backdrop before clients begin and help protect the paper throughout the rental."],
    ]],
    ["messy-materials", "Glitter, paint, liquids, and messy setups", "How should staff handle a client who wants to use messy materials?", [
      ["Prior approval required", "Messy materials such as glitter, paint, liquids, or confetti require prior approval from Smooth, including a cleanup plan."],
      ["Not permitted in rentals", "Do not allow glitter, paint, liquids, or confetti in rental setups. Refer exception requests to Smooth."],
      ["Only in a preapproved setup", "Allow messy materials only as part of a setup approved in advance, with appropriate surface protection and cleanup arrangements."],
    ]],
    ["moving-furniture", "Moving furniture and set pieces", "May clients move studio furniture or props?", [
      ["Ask the host first", "Clients must ask the host before moving furniture or set pieces. Return everything to its assigned position after use."],
      ["Small props only", "Clients may reposition small approved props. Staff must handle furniture and larger set pieces."],
      ["Staff handle all moves", "Staff handle furniture and set changes. Do not let clients drag or move studio furniture on their own."],
    ]],
    ["prop-inspection", "Checking props before use", "How should staff handle damaged or missing props?", [
      ["Inspect, set aside, and report", "Check props before handing them to a client. Set damaged items aside and tell Smooth about damaged or missing pieces."],
      ["Use a prop checklist", "Check props against the setup list before and after use. Report discrepancies to Smooth."],
      ["Report anything unsuitable", "Do not provide a prop that is unstable, damaged, or unsuitable for the intended use. Contact Smooth for an alternative."],
    ]],
  ]),
  ...section("Cleaning & supplies", [
    ["restroom-checks", "Restroom checks", "How often should staff check the restroom?", [
      ["At opening and between rentals", "Check the restroom at opening and between rentals. Restock essentials and address visible mess before the next client arrives."],
      ["At opening, closing, and as needed", "Check the restroom at opening and closing, and whenever a client reports a problem."],
      ["During each assigned shift", "Include a restroom check in each assigned coverage period and report anything that cannot be resolved promptly."],
    ]],
    ["trash-removal", "Emptying studio trash", "When should trash be taken out?", [
      ["Before full and at closing", "Empty bins before they overflow and remove remaining trash during closing. Replace liners before the next booking."],
      ["After food or messy rentals", "Remove trash after food or messy setups and whenever bins need attention. Leave clean, lined bins for the next rental."],
      ["At every closing", "Empty studio trash during every closing reset and sooner when bins are full or create an odor."],
    ]],
    ["lost-property", "Lost items after a rental", "What should staff do with items a client leaves behind?", [
      ["Label, store, and notify Smooth", "Label found items with the rental date and studio, place them in the designated lost-property area, and notify Smooth."],
      ["Contact client through approved channel", "Secure the item, document where it was found, and use the approved client contact method to arrange retrieval."],
      ["Smooth manages returns", "Secure found items and send the details to Smooth. Smooth will coordinate contact and return arrangements."],
    ]],
    ["cleaning-products", "Approved cleaning products", "How should the team choose cleaning products for studio surfaces and equipment?", [
      ["Labeled products by surface", "Use only the cleaning products labeled for the surface being cleaned. Ask before using a product on equipment or an unfamiliar material."],
      ["Follow the cleaning checklist", "Follow the cleaning checklist and use the listed product for each area. Do not substitute chemicals on equipment or backdrops."],
      ["Ask when unsure", "Use the studio's supplied cleaning products and contact Smooth when unsure whether a product is appropriate for a surface."],
    ]],
    ["supply-restock", "Reporting low supplies", "When should staff report supplies that are running low?", [
      ["When the last spare is opened", "Notify Smooth when the last spare package of a regular studio supply is opened so replacements can be arranged."],
      ["At the end of every shift", "Check essential supplies before leaving and send Smooth a short list of anything that needs restocking."],
      ["Update the shared supply list", "Add low supplies to the shared restock list as soon as they are noticed. Contact Smooth directly for an item needed for the next rental."],
    ]],
    ["fabric-care", "Fabric, towels, and reusable items", "How should used fabrics or reusable cleaning items be handled?", [
      ["Separate used items for cleaning", "Keep used fabrics and reusable cleaning items separate from clean supplies and place them in the designated collection area."],
      ["Follow labeled care instructions", "Follow the care instructions for each fabric or reusable item. Report stains or damage before putting an item back into service."],
      ["Ask before laundering studio fabric", "Set used or stained fabrics aside and check with Smooth before washing or treating them."],
    ]],
    ["unfinished-reset", "A reset cannot be finished in time", "What should staff do when cleanup threatens the next appointment?", [
      ["Call for help immediately", "Tell Smooth immediately if the reset may delay the next appointment. Explain what remains and request help before the next client arrives."],
      ["Prioritize safety and client areas", "Make the space safe, clean the areas needed for the next booking, and notify Smooth about remaining work and possible delays."],
      ["Coordinate with the next host", "Contact the next host and Smooth as soon as a reset delay becomes likely. Agree on the remaining tasks and client communication."],
    ]],
  ]),
  ...section("Payments & bookings", [
    ["balance-before-start", "Checking the remaining client balance", "When should the host verify whether the rental balance has been settled?", [
      ["Before the session begins", "Check the booking's payment status before the session begins. Ask Smooth to resolve any remaining or unclear balance before proceeding."],
      ["During check-in", "Verify payment status during client check-in and contact Smooth about any remaining or unclear balance."],
      ["Smooth handles payment decisions", "Review the displayed payment status and refer payment questions or exceptions to Smooth. Do not assume an unclear balance is unpaid."],
    ]],
    ["payment-not-reflected", "Client says they already paid", "What should staff do if the client says they paid but the dashboard does not show it?", [
      ["Verify with Smooth", "Ask for the payment confirmation and contact Smooth to verify it. A payment missing from the dashboard is not proof that the client has not paid."],
      ["Check the invoice reference", "Collect the invoice or transaction reference and send it to Smooth for reconciliation before asking the client to pay again."],
      ["Pause the payment discussion", "Tell the client the payment needs verification and let Smooth handle the follow-up. Do not charge the client again without confirmation."],
    ]],
    ["collecting-payment", "Who collects rental payments", "May team members collect rental payments directly?", [
      ["Approved invoice or link only", "Direct clients to the approved invoice or payment link. Do not collect payment through a personal account."],
      ["Smooth handles all payments", "Refer all payment collection to Smooth. Staff should not accept or arrange an alternative payment method independently."],
      ["Only methods Smooth authorizes", "Collect payment only through methods explicitly authorized by Smooth and make sure each payment is recorded against the booking."],
    ]],
    ["new-bookings", "Making or changing bookings", "Can the studio host create or change a client's booking?", [
      ["Smooth approval required", "Get Smooth's approval before creating, moving, or changing a client booking."],
      ["Direct client to booking page", "Direct clients to the booking page for new reservations. Refer changes to an existing booking to Smooth."],
      ["Authorized hosts may update", "Only authorized hosts may change a booking. Confirm studio availability and record the final details in the calendar."],
    ]],
    ["price-questions", "Prices, discounts, and exceptions", "What authority should staff have to offer discounts or adjust prices?", [
      ["Smooth approves all changes", "Only Smooth may approve discounts, price changes, or payment exceptions. Staff may explain published prices without making new offers."],
      ["Use published offers only", "Use only the published prices and approved offers. Refer any additional discount request to Smooth."],
      ["Refer all pricing questions", "Refer pricing and discount questions to Smooth when the answer is not clearly included in the booking."],
    ]],
    ["tips", "Handling tips", "How should staff handle a tip offered by a rental client?", [
      ["May accept; report separately", "Staff may accept a tip and should report it separately from the rental charge so the booking and gratuity are recorded correctly."],
      ["Use the approved payment process", "Direct tips through the approved payment process and keep them separate from the rental balance."],
      ["Ask Smooth about tip handling", "Check with Smooth about how a client tip should be accepted and recorded."],
    ]],
    ["invoice-only-events", "Invoice bookings and calendar blocks", "How should a host verify an event that was added manually and paid by invoice?", [
      ["Confirm the event and invoice", "Confirm with Smooth that the calendar block represents a booked event and check the associated invoice status. Do not treat missing online booking fields as proof of nonpayment."],
      ["Follow assignment notes", "Use the assignment notes and invoice confirmation supplied by Smooth for manually scheduled events."],
      ["Ask Smooth before check-in", "Contact Smooth before client check-in when a manually added event does not include clear booking or payment details."],
    ]],
  ]),
  ...section("Safety & incidents", [
    ["urgent-emergency", "Immediate danger or an emergency", "What communication order should staff follow in an urgent emergency?", [
      ["Emergency services, then Smooth", "Call emergency services when there is immediate danger or a medical emergency. Move to safety and notify Smooth as soon as it is safe to do so."],
      ["Split responsibilities when possible", "In an emergency, have one person contact emergency services while another helps direct people to safety and informs Smooth."],
      ["Follow the posted emergency plan", "Follow the posted emergency plan, contact emergency services when needed, and notify Smooth once immediate safety needs are addressed."],
    ]],
    ["incident-report", "Documenting an incident", "What should an incident report include?", [
      ["Time, facts, actions, and photos", "Send Smooth the time, location, factual description, actions taken, and relevant photos when safe and appropriate. Keep personal incident details out of shared guidelines."],
      ["Call first, then written summary", "Call Smooth promptly about an incident, then provide a factual written summary and any relevant documentation."],
      ["Use an incident form", "Complete the designated incident form as soon as practical and tell Smooth when it has been submitted."],
    ]],
    ["equipment-damage", "Accidental equipment or property damage", "What should staff do when someone damages equipment or the studio?", [
      ["Make safe, document, notify", "Stop using the affected item, make the area safe, document what happened, and notify Smooth. Do not decide charges or blame on the spot."],
      ["Contact Smooth before continuing", "Contact Smooth immediately about damage and wait for instructions before returning the affected item or area to use."],
      ["Separate damaged items", "Set damaged items aside, label them as unavailable, and send Smooth the details before the next booking."],
    ]],
    ["unsafe-client-behavior", "Unsafe or threatening behavior", "What should the host do if a client behaves unsafely or becomes threatening?", [
      ["Pause and get help", "Pause the activity, prioritize everyone's safety, and contact Smooth. Leave danger and contact emergency services if there is an immediate threat."],
      ["Enforce the rule and escalate", "Calmly state the relevant studio rule and stop the unsafe activity. Escalate continued or threatening behavior to Smooth and seek emergency help when needed."],
      ["Do not handle a threat alone", "Do not confront a threatening person alone. Move to safety, get help, and notify Smooth."],
    ]],
    ["walkways-cables", "Clear walkways and cables", "When should staff check cables, stands, and walkways?", [
      ["Before entry and after changes", "Check cable placement, stands, and clear walkways before clients enter and whenever the setup changes."],
      ["Throughout the rental", "Monitor cables, stands, and walkways throughout the rental and correct hazards as soon as they appear."],
      ["During each setup check", "Include stable stands, managed cables, and clear exits in every setup check."],
    ]],
    ["smoke-flame-effects", "Smoke, flames, and special effects", "What should staff do if a client requests smoke, candles, or another effect?", [
      ["Written approval before use", "Smoke, open flames, and special effects require prior written approval from Smooth and any required safety arrangements before use."],
      ["Not allowed in regular rentals", "Do not allow smoke, open flames, or special effects during a regular rental. Refer any exception request to Smooth."],
      ["Approved equipment and operator only", "Allow special effects only as part of a preapproved setup using approved equipment and a designated operator."],
    ]],
    ["pets-food-drinks", "Food, drinks, and animals on set", "How should staff handle food, drinks, or animals brought into the studio?", [
      ["Confirm booking approval", "Confirm any food, drink, or animal setup with Smooth before it enters the shooting area. Keep liquids away from electrical equipment."],
      ["Food and drinks in designated areas", "Keep food and drinks in designated areas and away from equipment. Refer animal-related requests to Smooth."],
      ["Use the booking-specific rules", "Explain the approved arrangements for food, drinks, and animals at check-in and refer unclear requests to Smooth."],
    ]],
  ]),
  ...section("Communication", [
    ["routine-channel", "Everyday team communication", "Where should routine studio updates be sent?", [
      ["Team group chat", "Send routine studio updates in the team group chat so the assigned team can stay informed."],
      ["Direct message to Smooth", "Send routine studio updates directly to Smooth and include the appointment date or assignment when relevant."],
      ["Dashboard notes plus urgent messages", "Keep routine appointment information in the dashboard notes. Send time-sensitive updates directly to Smooth."],
    ]],
    ["urgent-contact", "When a message is urgent", "When should staff call instead of only sending a text?", [
      ["Anything affecting an active booking", "Call Smooth when an issue affects an active booking, client access, safety, or immediate coverage. Follow up with a written summary."],
      ["No reply and the appointment is near", "Call when an urgent message has not been acknowledged and the appointment or client needs an immediate decision."],
      ["Safety, access, and major equipment issues", "Call immediately about safety, access failures, or major equipment problems. Use messages for routine updates."],
    ]],
    ["client-contact", "Contacting clients", "Which channel should staff use to contact a client?", [
      ["Approved studio channel", "Use the studio's approved client communication channel and identify yourself as the assigned studio host."],
      ["Smooth handles client messages", "Send client communication requests to Smooth unless the assignment specifically authorizes direct contact."],
      ["Booking contact for logistics", "Use the contact listed in the booking only for appointment logistics. Keep communication professional and related to the rental."],
    ]],
    ["complaint-handling", "Responding to a complaint", "What should staff do first when a client complains?", [
      ["Listen, clarify, contact Smooth", "Listen without arguing, clarify the issue, and contact Smooth with a factual summary and the client's requested resolution."],
      ["Resolve simple issues; escalate others", "Resolve straightforward setup or cleanliness issues when possible. Refer pricing, refunds, or unresolved complaints to Smooth."],
      ["Bring Smooth into the conversation", "Acknowledge the concern and let the client know that Smooth will help resolve it. Do not promise an outcome before approval."],
    ]],
    ["refund-requests", "Refund or compensation requests", "What should staff say when a client requests a refund or free time?", [
      ["Smooth reviews the request", "Explain that Smooth reviews refunds and compensation requests. Record the concern and do not promise a refund or free time."],
      ["Collect details for follow-up", "Collect the booking details and reason for the request, then refer it to Smooth for a decision."],
      ["Contact Smooth while client is present", "Contact Smooth while the client is present when possible so the request can be handled by the authorized person."],
    ]],
    ["noise-between-studios", "Noise affecting the other studio", "How should staff handle music or noise disturbing another booking?", [
      ["Lower volume and coordinate", "Ask the louder group to lower the volume and coordinate reasonable sound levels between studios."],
      ["Follow the quietest booking's needs", "Coordinate sound levels around the booking that requires quiet and involve Smooth if the needs conflict."],
      ["Ask Smooth to resolve conflicts", "Notify Smooth when noise from one studio interferes with another client's booking and help coordinate an immediate adjustment."],
    ]],
    ["unanswered-question", "When staff do not know the answer", "What should someone tell a client when they do not know a studio policy?", [
      ["Check the guidelines, then ask", "Check Studio Guidelines first. If the answer is missing or unclear, tell the client you will confirm with Smooth before giving a definite answer."],
      ["Confirm directly with Smooth", "Tell the client that you need to confirm the answer with Smooth. Do not guess about prices, exceptions, access, or equipment rules."],
      ["Use known rules only", "Explain only the rules you can verify and refer anything uncertain to Smooth."],
    ]],
  ]),
  ...section("Content & privacy", [
    ["bts-permission", "Permission for behind-the-scenes content", "When may staff record behind-the-scenes photos or videos of a rental?", [
      ["Ask permission first", "Ask the client for permission before recording behind-the-scenes content. Respect a refusal and avoid interrupting the session."],
      ["Only when arranged in advance", "Record behind-the-scenes content only when it has been arranged and approved before the session."],
      ["Smooth coordinates recording", "Let Smooth coordinate permission and instructions for behind-the-scenes recording."],
    ]],
    ["social-posting", "Posting studio or client content", "Who approves content before it is posted on a studio account?", [
      ["Smooth approves each post", "Send proposed content to Smooth for approval before posting on a studio account."],
      ["Use the approved content plan", "Post only content included in the approved content plan and confirm that required client permission has been obtained."],
      ["Send content; Smooth posts", "Send finished content to Smooth. Smooth handles publication on studio accounts."],
    ]],
    ["personal-posts", "Posting client content on personal accounts", "May team members post rental content on their own accounts?", [
      ["Client and Smooth approval", "Get permission from both the client and Smooth before posting rental content on a personal account."],
      ["No personal posting", "Do not post client rental content on personal accounts."],
      ["Only approved shared posts", "Share only studio posts that have already been approved for public sharing. Do not publish unpublished client content."],
    ]],
    ["private-information", "Handling private client information", "Where should staff keep client contact details and payment information?", [
      ["Approved studio systems only", "Keep client contact and payment information in approved studio systems. Do not copy it into personal notes, public posts, or shared guidelines."],
      ["Use only the booking record", "Use the booking record for client details and limit access to the information needed for the assignment."],
      ["Refer sensitive requests to Smooth", "Refer requests involving private client or payment information to Smooth and avoid sharing details outside the assigned work."],
    ]],
    ["personal-studio-use", "Personal shoots and practice sessions", "Can team members use the studio for their own shoots or equipment practice?", [
      ["Book with Smooth first", "Arrange personal shoots and practice sessions with Smooth in advance. Confirm the time, studio, equipment, and any applicable charges."],
      ["Approved practice periods only", "Use the studio for personal practice only during approved practice periods and complete the same reset expected after a rental."],
      ["No unscheduled personal use", "Do not use unbooked studio time for a personal shoot without prior approval."],
    ]],
    ["content-delivery", "Delivering studio BTS files", "How should staff deliver approved behind-the-scenes content to you?", [
      ["Shared studio folder", "Upload approved behind-the-scenes files to the designated studio folder and label them with the date and booking reference."],
      ["Send through the team channel", "Send approved behind-the-scenes content through the designated team channel with the rental date and a short description."],
      ["Follow assignment instructions", "Deliver behind-the-scenes content using the location and naming instructions included in the assignment."],
    ]],
    ["client-reviews", "Requesting a review", "Should the host invite clients to leave a review after their rental?", [
      ["Yes, use the approved link", "At the end of the rental, politely offer the approved review link without pressuring the client."],
      ["Smooth sends the follow-up", "Let Smooth handle review requests and post-rental follow-up."],
      ["Only if the client asks", "Provide the approved review link when a client asks how to share feedback."],
    ]],
  ]),
  ...section("Closing & handoffs", [
    ["last-person-check", "Final closing check", "What should the last team member check before leaving?", [
      ["Reset, equipment, doors, and lights", "Confirm the studio is reset, equipment is stored or charging correctly, unnecessary lights are off, and doors are secured before leaving."],
      ["Use a closing checklist", "Complete the studio closing checklist and confirm that no clients, personal items, or unresolved hazards remain."],
      ["Walkthrough with Smooth's instructions", "Complete a final walkthrough and follow the closing instructions provided by Smooth for that day."],
    ]],
    ["closing-confirmation", "Confirming the studio is closed", "How should the closing team member report completion?", [
      ["Message and reset photos", "Send Smooth a closing message with photos of the reset studios and confirmation that the doors are secured."],
      ["Short checklist message", "Send a short message confirming the reset, equipment check, and secured doors. Include any unresolved issue."],
      ["Dashboard handoff note", "Record closing completion and any unresolved issues in the dashboard handoff notes."],
    ]],
    ["temperature-controls", "Thermostat and climate controls", "Who may change the thermostat or other climate settings?", [
      ["Follow posted settings", "Use the posted studio climate settings. Check with Smooth before making a significant change or changing closing settings."],
      ["Ask Smooth before adjustments", "Ask Smooth before adjusting the thermostat or other climate controls."],
      ["Adjust within approved range", "Adjust climate controls only within the approved range and return them to the required closing setting."],
    ]],
    ["keys-at-close", "Keys after closing", "What should happen to studio keys at the end of coverage?", [
      ["Return to the approved location", "Return keys to the approved secure location and confirm the handoff when required. Do not describe access details in shared notes."],
      ["Hand directly to the next host", "Hand keys directly to the next approved host or follow Smooth's closing instructions if no host is taking over."],
      ["Follow individual key assignment", "Keep or return keys according to the individual key arrangement approved by Smooth."],
    ]],
    ["overnight-setup", "Leaving a setup overnight", "Can a client or team member leave equipment or a set assembled overnight?", [
      ["Prior approval only", "Leave a setup or outside equipment overnight only with Smooth's prior approval and clear instructions for the next booking."],
      ["Reset after every booking", "Reset the space after every booking unless Smooth has specifically approved an exception."],
      ["Approved multiday bookings", "Overnight setups are allowed only for approved multiday bookings with a documented storage and access arrangement."],
    ]],
    ["next-day-check", "Preparing for the next day's bookings", "Should the closing host check the next day's schedule?", [
      ["Check and flag special needs", "Review the next day's bookings before leaving and flag unusual equipment, backdrop, or coverage needs for Smooth and the next host."],
      ["Prepare approved items in advance", "Check the next day's first booking and prepare approved items when doing so will not interfere with cleaning or secure storage."],
      ["Leave a handoff for the opener", "Leave a short handoff for the next opener covering any known preparation needs or unresolved issues."],
    ]],
    ["closing-problem", "Unable to secure the studio", "What should staff do if a door, lock, or closing system does not work?", [
      ["Call before leaving", "Call Smooth before leaving if the studio cannot be secured. Wait for a confirmed plan instead of leaving the issue unresolved."],
      ["Contact the designated access lead", "Contact the designated access lead and keep Smooth informed. Do not leave until responsibility for securing the space has been confirmed."],
      ["Follow the closing escalation plan", "Follow the closing escalation plan and confirm who is responsible for the unresolved security issue before departing."],
    ]],
  ]),
  ...GUIDELINE_FOLLOWUPS,
];

export const GUIDELINE_CATEGORIES = [...new Set(GUIDELINE_QUESTIONS.map(question => question.category))];
export const guidelineQuestionEntryId = id => `question-${id}`;

export function tidyGuidelineAnswer(value) {
  return tidyGuidelineBody(value);
}

export function composeGuidelineAnswer(question, selectedChoice, customAnswer) {
  const choice = selectedChoice >= 0 ? question.choices[selectedChoice]?.body ?? "" : "";
  const custom = tidyGuidelineAnswer(customAnswer);
  return [choice, custom].filter(Boolean).join("\n\n");
}
