const make = (id, category, title, prompt, choices) => ({ id, category, title, prompt, tags: ["follow-up"], choices: choices.map(([label, body]) => ({ label, body })) });
export const GUIDELINE_FOLLOWUPS = [
  make("solo-approval", "Team & assignments", "Approval to host alone", "What must a new team member complete before managing a rental alone?", [
    ["Shadow, then get approval", "Shadow an experienced host and get Smooth's approval before managing a rental alone."],
    ["Complete a training checklist", "Complete the studio training checklist and demonstrate the required setup and closing tasks before hosting alone."],
    ["Approval for each assignment", "Smooth will confirm whether a new team member may host independently for each assignment."],
  ]),
  make("quiet-shift-tasks", "Team & assignments", "Tasks between bookings", "What should team members work on when there are no clients in the studio?", [
    ["Reset, check supplies, then ask", "Use time between bookings to reset the studios, check supplies, and ask Smooth for the next priority."],
    ["Follow the assigned task list", "Work through the tasks included in the assignment when the studio is quiet. Confirm priorities with Smooth if the list is complete."],
    ["Prepare the next booking", "Prepare for the next booking first, then complete approved cleaning and equipment checks."],
  ]),
  make("parking-directions", "Opening & closing", "Parking directions", "What parking instructions should staff give clients?", [
    ["Use the booking instructions", "Direct clients to the parking instructions in their booking confirmation. Ask Smooth before suggesting an alternative location."],
    ["Use designated client spaces", "Direct clients to the designated studio parking spaces and keep entrances and access routes clear."],
    ["Confirm with Smooth", "Check with Smooth before giving parking directions when the approved parking location is unclear."],
  ]),
  make("loading-unloading", "Opening & closing", "Loading equipment", "How should clients load and unload large equipment or props?", [
    ["Coordinate with the host", "Ask clients to coordinate loading and unloading with their host. Keep entrances and access routes clear."],
    ["Use the designated loading area", "Direct clients to the designated loading area and have them move their vehicle after unloading."],
    ["Approve large items first", "Check with Smooth before allowing large props or equipment through the studio entrance."],
  ]),
  make("walk-in-client", "Bookings & payments", "Walk-ins without a booking", "What should a host do when someone arrives without a confirmed booking?", [
    ["Refer to Smooth", "Greet the visitor and contact Smooth before promising studio access, a time slot, or a price."],
    ["Direct them to booking", "Ask the visitor to make a confirmed booking before using a studio. Check with Smooth if assistance is needed."],
    ["Check availability first", "Check the calendar and contact Smooth to confirm whether a same-day booking can be accommodated."],
  ]),
  make("booking-name-mismatch", "Bookings & payments", "Different name on the booking", "How should staff verify a client whose name differs from the booking?", [
    ["Check the confirmation", "Ask to see the booking confirmation and verify the scheduled time and studio. Contact Smooth if the booking still cannot be confirmed."],
    ["Confirm with the booking contact", "Ask the person who made the booking to confirm the arriving client through the approved contact method."],
    ["Contact Smooth", "Contact Smooth before granting access when the arriving client cannot be matched to the booking."],
  ]),
  make("payment-service-down", "Bookings & payments", "Payment system unavailable", "What should staff do if the payment platform is unavailable at check-in?", [
    ["Ask Smooth for an approved method", "Contact Smooth for an approved payment method if the platform is unavailable. Do not mark an unverified payment as received."],
    ["Verify existing payment first", "Check the booking's existing payment record and contact Smooth before collecting another payment or starting an unpaid session."],
    ["Wait for instructions", "Explain the payment delay to the client and wait for Smooth's instructions before changing the booking or payment status."],
  ]),
  make("accessibility-requests", "Rentals & clients", "Accessibility requests", "How should the team handle a client who asks for accessibility assistance?", [
    ["Ask what help is needed", "Ask the client what assistance would help and coordinate with Smooth. Describe the available access and space accurately."],
    ["Plan with Smooth ahead of arrival", "Share accessibility requests with Smooth before the appointment so the team can confirm arrangements with the client."],
    ["Offer help and confirm limits", "Offer practical assistance and check with Smooth before promising changes to the space or equipment."],
  ]),
  make("polaroid-declined", "Rentals & clients", "Client declines a Polaroid", "What should happen if a client does not want a Polaroid photo or does not want to sign it?", [
    ["Respect their choice", "Respect a client's choice to decline the Polaroid photo or signature. Do not pressure them to participate."],
    ["Offer a group photo, then respect no", "Offer a group photo if the client prefers it. Respect their decision if they still do not want a photo or signature."],
    ["Let them choose who participates", "Let the group choose who participates in the Polaroid photo and signing. Anyone may decline."],
  ]),
  make("polaroid-film-empty", "Rentals & clients", "Polaroid supplies unavailable", "What should staff do if the Polaroid camera has no film or is not working?", [
    ["Report it and note the missed photo", "Tell Smooth when Polaroid film runs out or the camera stops working, and note which rental could not receive a photo."],
    ["Use approved spare film", "Check the approved supply location for spare film. If none is available or the camera still does not work, contact Smooth."],
    ["Ask about a substitute", "Contact Smooth before substituting another camera or promising to send the client a photo later."],
  ]),
  make("polaroid-book-storage", "Rentals & clients", "Storing signed Polaroids", "Where should signed Polaroids go if the book is full or unavailable?", [
    ["Use a designated holding spot", "Place signed Polaroids in the designated holding spot and tell Smooth that the book needs attention."],
    ["Ask Smooth where to store them", "Ask Smooth where to keep signed Polaroids when the book is full or unavailable. Keep them together and protected."],
    ["Use the approved next book", "Use the approved next Polaroid book. If there is no replacement book, contact Smooth before storing photos elsewhere."],
  ]),
  make("shared-equipment", "Equipment & backdrops", "Sharing equipment between studios", "Who gets priority when both studios need the same piece of equipment?", [
    ["Reserved equipment stays with its booking", "Keep reserved equipment with the booking it was assigned to. Contact Smooth to resolve competing requests before moving it."],
    ["Smooth decides priority", "Ask Smooth to decide equipment priority when both studios need the same item. Explain the options to clients after approval."],
    ["Use an approved substitute", "Keep the existing setup intact and offer an approved substitute. Contact Smooth if no suitable substitute is available."],
  ]),
  make("flash-channel-interference", "Equipment & backdrops", "Flashes firing in the other studio", "What should a host do if one studio's trigger fires the other studio's lights?", [
    ["Use separate approved channels", "Check the approved trigger channels for each studio and separate them. Test both studios before the clients resume shooting."],
    ["Ask for troubleshooting support", "Pause test flashes and contact Smooth or the designated lighting lead to resolve interference between the studios."],
    ["Restore each studio's standard settings", "Restore each studio's approved trigger and light settings, then test that each trigger controls only its intended lights."],
  ]),
  make("camera-trigger-compatibility", "Equipment & backdrops", "Client camera and trigger compatibility", "What should staff do when the studio trigger does not fit or work with the client's camera?", [
    ["Check the approved compatibility guide", "Check the approved compatibility guide for the client's camera. Ask Smooth before using an unfamiliar adapter or changing advanced camera settings."],
    ["Use a compatible approved trigger", "Use an approved compatible trigger if one is available. Test it with the client before continuing."],
    ["Contact Smooth", "Contact Smooth if the trigger is not compatible with the client's camera. Do not force the trigger into the camera mount."],
  ]),
  make("bluetooth-reset", "Equipment & backdrops", "Disconnecting a client's music", "How should the Bluetooth speaker be reset when one rental ends and another begins?", [
    ["Disconnect the previous client", "Disconnect the previous client's device and confirm that the next client can connect to the speaker."],
    ["Host manages the connection", "Have the host manage the speaker connection between rentals and confirm the previous client's device is disconnected."],
    ["Follow the speaker reset steps", "Follow the approved speaker reset steps between clients and check the volume before the next rental starts."],
  ]),
  make("overhead-light-controls", "Equipment & backdrops", "Changing overhead lighting", "Which overhead or room lights may clients change during a rental?", [
    ["Host handles the controls", "Ask clients to request room-light changes through their host. Keep shared areas and required exit lighting usable."],
    ["Only designated controls", "Show clients the designated lighting controls for their studio. Shared-area and restricted controls must remain with the team."],
    ["Confirm changes with Smooth", "Check with Smooth before changing overhead lighting outside the approved studio setup."],
  ]),
  make("tape-wall-mounting", "Equipment & backdrops", "Tape and attachments on walls", "Can clients tape or attach decorations to studio walls, ceilings, or equipment?", [
    ["Approval before attaching anything", "Get Smooth's approval before attaching decorations to walls, ceilings, or studio equipment."],
    ["Only approved materials and surfaces", "Use only the approved attachment materials and designated surfaces. Ask the host before placing decorations."],
    ["Use freestanding supports", "Use approved freestanding supports for decorations. Do not attach items to walls, ceilings, or studio equipment without approval."],
  ]),
  make("missing-equipment-check", "Equipment & backdrops", "Missing equipment during reset", "What should staff do if an item is missing when they reset the studio?", [
    ["Check nearby, then report", "Check the approved storage areas and the other studio, then report the missing item to Smooth. Avoid accusing a client without verified information."],
    ["Report before the next rental", "Tell Smooth about missing equipment before the next rental begins and confirm whether an approved substitute is available."],
    ["Use the inventory checklist", "Check the item against the studio inventory checklist and record what is missing before handing off to the next host."],
  ]),
  make("cleaning-supply-shortage", "Cleaning & reset", "Running out of cleaning supplies", "What should someone do if the studio runs out of a needed cleaning supply?", [
    ["Report it before it runs out", "Tell Smooth when a cleaning supply is running low. If it runs out, ask for an approved replacement before substituting another product."],
    ["Use the approved backup location", "Check the approved backup supply location and report the shortage. Do not mix or improvise cleaning products."],
    ["Pause the affected task and ask", "Contact Smooth when a required cleaning supply is unavailable and confirm how to complete the affected task."],
  ]),
  make("personal-items-storage", "Cleaning & reset", "Staff belongings", "Where should team members keep bags, food, and personal belongings during a shift?", [
    ["Designated staff storage", "Keep personal belongings in the designated staff storage area and keep client areas and walkways clear."],
    ["Ask the shift lead", "Ask the shift lead where to store personal belongings. Keep them away from rental setups and equipment."],
    ["Only essentials in the studio", "Bring only the personal items needed for the shift and store them in the approved staff area."],
  ]),
  make("water-leak", "Safety & incidents", "Leaks near electrical equipment", "What should staff do if they find water leaking near lights, outlets, or other electrical equipment?", [
    ["Keep people away and call for help", "Keep people away from the affected area and contact Smooth immediately. Do not touch wet electrical equipment. Contact emergency services if there is immediate danger."],
    ["Pause use of the affected studio", "Stop using the affected studio, move clients to a safe area, and contact Smooth for help. Do not handle equipment exposed to water."],
    ["Follow the incident procedure", "Follow the studio incident procedure, keep clients away from the hazard, and report the leak immediately."],
  ]),
  make("damaged-gear-return", "Safety & incidents", "Putting repaired equipment back in use", "Who may approve using equipment again after it was reported damaged or unsafe?", [
    ["Smooth gives clearance", "Keep reported equipment out of use until Smooth confirms it is cleared to return to service."],
    ["Designated equipment lead", "The designated equipment lead must check and clear reported equipment before it returns to a rental setup."],
    ["Documented repair and approval", "Return equipment to use only after the repair or inspection is documented and Smooth approves it."],
  ]),
  make("client-files-left", "Content & privacy", "Client files left on equipment", "What should staff do if they find a client's files on a studio device or memory card?", [
    ["Keep private and contact Smooth", "Keep the files private and contact Smooth. Do not copy, share, delete, or use them without instructions."],
    ["Secure the device or card", "Secure the device or memory card and tell Smooth where it was found. Do not browse files beyond what is needed to report the issue."],
    ["Follow the data handoff process", "Use the approved client-data handoff process and contact Smooth before transferring or deleting any files."],
  ]),
  make("studio-tour-filming", "Content & privacy", "Filming tours during other rentals", "Can staff film a studio tour or BTS while another client's rental is in progress?", [
    ["Wait until the space is clear", "Film studio tours and general BTS when the space is clear of other clients and their private belongings."],
    ["Permission from everyone involved", "Get approval from Smooth and consent from everyone who would appear before filming a tour or BTS during an active rental."],
    ["Use an empty studio only", "Use an empty studio for general tour content and avoid recording another rental, client conversation, or private booking information."],
  ]),
];
