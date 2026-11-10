// Scenario prompts and distractors only. Answers always come from the published
// rulebook. A changed policy must be reviewed before its scenario can be reused.
export const GUIDELINE_SCENARIOS = [
  {
    "entryId": "question-accept-deadline",
    "fingerprint": "b0c3bd2a",
    "prompt": "An offer for a later date arrives while you are free. How soon should you respond?",
    "alternatives": [
      "Wait until the evening before the rental.",
      "Respond only if you want to decline the offer."
    ]
  },
  {
    "entryId": "question-availability-updates",
    "fingerprint": "ad8395f3",
    "prompt": "Your class schedule changes after you accepted a rental. What should you update?",
    "alternatives": [
      "Only change your availability; accepted work updates automatically.",
      "Wait until Smooth sends another offer before mentioning the change."
    ]
  },
  {
    "entryId": "question-running-late",
    "fingerprint": "9003155",
    "prompt": "You realize you cannot make an accepted shift. What should you do first?",
    "alternatives": [
      "Remove yourself from the schedule and let the next person take it.",
      "Wait until the client arrives to see whether coverage is needed."
    ]
  },
  {
    "entryId": "question-coverage-swaps",
    "fingerprint": "64b2d7e7",
    "prompt": "A coworker agrees to cover your rental. What makes the swap final?",
    "alternatives": [
      "The coworker's message is enough; you can stop preparing for the shift.",
      "Update your own availability and assume the swap is confirmed."
    ]
  },
  {
    "entryId": "question-break-coverage",
    "fingerprint": "60f3b5f8",
    "prompt": "Your client is settled and you want a break. What is allowed?",
    "alternatives": [
      "Leave the building and have the client call if they need anything.",
      "Take a break only after every rental that day has ended."
    ]
  },
  {
    "entryId": "question-shift-handoff",
    "fingerprint": "cb760196",
    "prompt": "The next host arrives while one battery is low and a stand is faulty. What belongs in your handoff?",
    "alternatives": [
      "Mention only the next client's name; equipment issues can wait.",
      "Leave the equipment as it is and let the next host discover the issues."
    ]
  },
  {
    "entryId": "question-personal-guests",
    "fingerprint": "ad5aedd7",
    "prompt": "A friend visits while you are hosting. What rule applies?",
    "alternatives": [
      "They may wait alone in the employee area while you help clients.",
      "Personal visitors are never allowed during an assigned shift."
    ]
  },
  {
    "entryId": "question-early-finish",
    "fingerprint": "9d1af247",
    "prompt": "A client finishes early and leaves. When can you leave?",
    "alternatives": [
      "Leave immediately because the client is no longer in the studio.",
      "Stay until the next host arrives even if your assignment has ended."
    ]
  },
  {
    "entryId": "question-routine-channel",
    "fingerprint": "96e3d9d0",
    "prompt": "You have a routine studio update that the team needs to know. Where should it go?",
    "alternatives": [
      "Put it only in your private phone notes.",
      "Send it to the current client and ask them to pass it along."
    ]
  },
  {
    "entryId": "question-urgent-contact",
    "fingerprint": "1d30c448",
    "prompt": "An urgent message is unanswered and the appointment needs a decision now. What should you do?",
    "alternatives": [
      "Keep sending the same text and wait until the rental ends.",
      "Make the decision yourself without contacting Smooth again."
    ]
  },
  {
    "entryId": "question-client-contact",
    "fingerprint": "3f6534fa",
    "prompt": "You want to message a client about their booking. What should guide you?",
    "alternatives": [
      "Contact every client directly from your personal account.",
      "Ask another client to relay the message."
    ]
  },
  {
    "entryId": "question-unanswered-question",
    "fingerprint": "232b5028",
    "prompt": "A client asks about an exception you cannot confirm. What should you say?",
    "alternatives": [
      "Give the answer you think is most likely so the client can continue.",
      "Promise the exception and check with Smooth after the rental."
    ]
  },
  {
    "entryId": "question-opening-checkin",
    "fingerprint": "6961b968",
    "prompt": "You finish the routine opening checks and nothing is wrong. Is an opening message required?",
    "alternatives": [
      "Send a photo and wait for approval before every rental begins.",
      "Ask the client to message Smooth before you can open."
    ]
  },
  {
    "entryId": "question-occupied-entry",
    "fingerprint": "871dfd6c",
    "prompt": "Someone walks in while a rental is in progress. What should you do?",
    "alternatives": [
      "Direct them to whichever studio door is open.",
      "Let the current client decide whether the visitor belongs there."
    ]
  },
  {
    "entryId": "question-outside-hours",
    "fingerprint": "1fdfa9b4",
    "prompt": "A client asks for access outside regular studio hours. Who can approve it?",
    "alternatives": [
      "Any host who is willing to stay later can approve it.",
      "The client may choose a time as long as a studio looks empty."
    ]
  },
  {
    "entryId": "question-opening-issues",
    "fingerprint": "9c2e4b2",
    "prompt": "You arrive and find a problem with the setup. What should you do before changing it?",
    "alternatives": [
      "Fix it first and describe what you remember after the rental.",
      "Keep the issue out of the handoff if the client has not noticed it."
    ]
  },
  {
    "entryId": "question-last-person-check",
    "fingerprint": "64d1e9ee",
    "prompt": "You are the last team member leaving. What should your final check cover?",
    "alternatives": [
      "Only the front door; the next host handles the studio reset.",
      "Only the shooting area; charging, lights, and doors are separate tasks."
    ]
  },
  {
    "entryId": "question-closing-confirmation",
    "fingerprint": "e88799dd",
    "prompt": "The studio is reset and securely closed with no unresolved issue. Is a routine closing message required?",
    "alternatives": [
      "Send a closing message after every shift before you can leave.",
      "Have the last client confirm closing for you."
    ]
  },
  {
    "entryId": "question-temperature-controls",
    "fingerprint": "fc176818",
    "prompt": "A client says the studio is too warm. What can you adjust?",
    "alternatives": [
      "Switch the portable A/C units off and on whenever the room feels warm.",
      "Only Smooth may adjust any temperature setting or fan."
    ]
  },
  {
    "entryId": "question-keys-at-close",
    "fingerprint": "8a97526e",
    "prompt": "You finish coverage at the studio. What is the correct access closeout?",
    "alternatives": [
      "Leave a physical key with the last client.",
      "Hide a spare key outside for the next host."
    ]
  },
  {
    "entryId": "question-overnight-setup",
    "fingerprint": "aeeee54b",
    "prompt": "A regular rental client asks to leave their setup overnight. What does the guideline allow?",
    "alternatives": [
      "Any client may leave a setup if the next morning appears open.",
      "Clients and team members must always remove every setup immediately."
    ]
  },
  {
    "entryId": "question-next-day-check",
    "fingerprint": "247623ad",
    "prompt": "You are closing but cannot see the full next-day schedule. What should you focus on?",
    "alternatives": [
      "Wait for access to the full schedule before completing the reset.",
      "Leave the current setup untouched in case tomorrow's client wants it."
    ]
  },
  {
    "entryId": "question-closing-problem",
    "fingerprint": "e7861a2e",
    "prompt": "The door will not secure at the end of your shift. What should you do?",
    "alternatives": [
      "Leave a message and depart once your scheduled shift ends.",
      "Ask the last client to watch the door until another employee arrives."
    ]
  },
  {
    "entryId": "question-booking-review",
    "fingerprint": "1b5ef5ed",
    "prompt": "Before setting up a rental, what should you check in the booking?",
    "alternatives": [
      "Only the client name and start time; equipment can be chosen on arrival.",
      "Only the studio room; payment and add-ons do not affect preparation."
    ]
  },
  {
    "entryId": "question-missing-booking-detail",
    "fingerprint": "a3576076",
    "prompt": "The booking does not list a backdrop color. How should you prepare?",
    "alternatives": [
      "Leave the backdrop down from the previous rental without checking.",
      "Delay all preparation until the client arrives."
    ]
  },
  {
    "entryId": "question-two-studio-priority",
    "fingerprint": "39ceecb3",
    "prompt": "Both studios need help and you are covering them alone. What comes first?",
    "alternatives": [
      "Help whichever client asks most loudly, regardless of the issue.",
      "Finish every cosmetic setup detail before addressing equipment problems."
    ]
  },
  {
    "entryId": "question-special-setup-approval",
    "fingerprint": "6587c9f8",
    "prompt": "A client requests equipment and setup work beyond their booking. How should you handle it?",
    "alternatives": [
      "Agree to every request now and discuss any charges after the client leaves.",
      "Refuse all changes, even when an included item is available."
    ]
  },
  {
    "entryId": "question-preparation-confirmation",
    "fingerprint": "5c5e4586",
    "prompt": "You notice existing damage before a rental starts. When should you document it?",
    "alternatives": [
      "Wait until after the client leaves to document the original condition.",
      "Document it only if the client later makes a complaint."
    ]
  },
  {
    "entryId": "question-host-presence",
    "fingerprint": "f63bca20",
    "prompt": "The client is shooting without needing help right now. Where should you be?",
    "alternatives": [
      "Leave the studio and return near the scheduled end time.",
      "Stay beside the client throughout the shoot even when they want privacy."
    ]
  },
  {
    "entryId": "question-included-assistance",
    "fingerprint": "5899f80",
    "prompt": "A client needs help with an included piece of equipment. What assistance should you provide?",
    "alternatives": [
      "Let clients solve every setup issue themselves because they rented the space.",
      "Attempt any advanced setup the client requests, even beyond your experience."
    ]
  },
  {
    "entryId": "question-extra-attendees",
    "fingerprint": "23f4ccc2",
    "prompt": "More guests arrive than the booking lists. What does that difference alone require?",
    "alternatives": [
      "Automatically cancel the rental before checking the studio conditions.",
      "Charge each extra guest without checking the studio's rules."
    ]
  },
  {
    "entryId": "question-waiting-clients",
    "fingerprint": "680898",
    "prompt": "A client arrives early while you are helping another rental. Where should they wait?",
    "alternatives": [
      "Let them start setting up in the other client's occupied studio.",
      "Ask them to wait in the employee room."
    ]
  },
  {
    "entryId": "question-unbooked-studio",
    "fingerprint": "1a9adec4",
    "prompt": "The other studio is unoccupied and would better meet a client's needs. What does the guideline allow?",
    "alternatives": [
      "A client can move studios even when the other space is occupied.",
      "A host can never move a client to the other studio."
    ]
  },
  {
    "entryId": "question-changing-privacy",
    "fingerprint": "63b2bf51",
    "prompt": "You need to enter an occupied private space. How should you protect the client's privacy?",
    "alternatives": [
      "Announce yourself while opening the door.",
      "Enter immediately because you are the assigned studio host."
    ]
  },
  {
    "entryId": "question-late-client",
    "fingerprint": "da4c01ed",
    "prompt": "A client arrives late and asks to shift their end time. What is the rule?",
    "alternatives": [
      "Move the end time later by the number of minutes they arrived late.",
      "Let them stay as long as the next client has not entered the studio."
    ]
  },
  {
    "entryId": "question-no-show",
    "fingerprint": "b99f444",
    "prompt": "A client has not arrived or contacted the studio. When should you notify Smooth?",
    "alternatives": [
      "Wait until the entire rental is over before reporting the no-show.",
      "Release the space as soon as the scheduled start time passes."
    ]
  },
  {
    "entryId": "question-end-reminder",
    "fingerprint": "2506c33a",
    "prompt": "A rental is approaching its end with no overrun yet. Are routine end-time reminders required?",
    "alternatives": [
      "Send several reminders during every rental regardless of the situation.",
      "Stop the shoot early so the client can leave before the end time."
    ]
  },
  {
    "entryId": "question-packup-time",
    "fingerprint": "e9005700",
    "prompt": "The rental time ends and the client has finished shooting. What happens with packing and resetting?",
    "alternatives": [
      "Stop all packing at the scheduled end time and remove their items yourself.",
      "Start moving equipment while the client is still using it."
    ]
  },
  {
    "entryId": "question-extension-approval",
    "fingerprint": "75280820",
    "prompt": "A client asks to keep shooting longer. What must happen before you agree?",
    "alternatives": [
      "Approve extra time yourself if nobody is waiting at the door.",
      "Let the client continue and add the extension after they leave."
    ]
  },
  {
    "entryId": "question-complaint-handling",
    "fingerprint": "7e302ff0",
    "prompt": "A client complains about their experience. How should you respond?",
    "alternatives": [
      "Promise free time immediately so the conversation ends quickly.",
      "Debate the complaint before hearing what outcome the client wants."
    ]
  },
  {
    "entryId": "question-requested-item-unavailable",
    "fingerprint": "178bf1ac",
    "prompt": "The requested backdrop or equipment is unavailable. What should you do?",
    "alternatives": [
      "Substitute an item silently and avoid mentioning the change.",
      "Tell the client nothing can be done without checking available alternatives."
    ]
  },
  {
    "entryId": "question-standard-lighting",
    "fingerprint": "d3ddffd3",
    "prompt": "The booking has no lighting arrangement listed. What should you prepare?",
    "alternatives": [
      "Leave every light off and wait for the client to choose a setup.",
      "Repeat the previous client's setup without testing it."
    ]
  },
  {
    "entryId": "question-equipment-handling",
    "fingerprint": "1fa5d236",
    "prompt": "A client wants to change modifiers and move heavy equipment. What rule applies?",
    "alternatives": [
      "Orientation gives clients permission to make every equipment and set change.",
      "Clients are never allowed to use even the basic equipment controls."
    ]
  },
  {
    "entryId": "question-trigger-troubleshooting",
    "fingerprint": "4d81e0c2",
    "prompt": "A camera trigger does not fire the lights. How should you troubleshoot?",
    "alternatives": [
      "Keep changing unfamiliar camera settings until the flash fires.",
      "Assume the client's camera is faulty without checking the setup."
    ]
  },
  {
    "entryId": "question-equipment-failure",
    "fingerprint": "d50ee820",
    "prompt": "A piece of equipment stops working during a rental. What should you do?",
    "alternatives": [
      "Return it to shared storage without mentioning the fault.",
      "Keep using the faulty item until the client finishes their rental."
    ]
  },
  {
    "entryId": "question-equipment-storage",
    "fingerprint": "d8a9bc2d",
    "prompt": "You finish using equipment and accessories. Where should they go?",
    "alternatives": [
      "Leave them wherever the last client placed them.",
      "Store them in any empty drawer even if it has a different label."
    ]
  },
  {
    "entryId": "question-charging-area",
    "fingerprint": "e617b07d",
    "prompt": "You check a strobe battery after use. When should charging begin?",
    "alternatives": [
      "Wait until the battery is completely empty.",
      "Leave charging for the next host even when the battery level has dropped."
    ]
  },
  {
    "entryId": "question-equipment-leaving",
    "fingerprint": "8c59a84c",
    "prompt": "A studio rental client asks to take a light off site. What should you do?",
    "alternatives": [
      "Let them take it if they promise to bring it back before closing.",
      "Approve it yourself when the studio is not using the light."
    ]
  },
  {
    "entryId": "question-client-equipment",
    "fingerprint": "159ad418",
    "prompt": "A client brings their own equipment. What is the condition for using it?",
    "alternatives": [
      "Their own equipment is always prohibited.",
      "Their equipment may be used even if it could damage studio property."
    ]
  },
  {
    "entryId": "question-backdrop-changes",
    "fingerprint": "be4442e5",
    "prompt": "A client wants to raise or lower the backdrop. Who should do it?",
    "alternatives": [
      "The client should operate the backdrop after a quick verbal explanation.",
      "Any visitor may adjust it if the host is helping someone else."
    ]
  },
  {
    "entryId": "question-extra-backdrop-color",
    "fingerprint": "614d50ee",
    "prompt": "A client asks for another backdrop color during their rental. How should you handle it?",
    "alternatives": [
      "Decline every color change once the rental has started.",
      "Promise extra rental time automatically to fit the color change."
    ]
  },
  {
    "entryId": "question-damaged-paper",
    "fingerprint": "6b542420",
    "prompt": "A client tears the backdrop paper. What should you do?",
    "alternatives": [
      "Cut away the damaged section yourself and report it at the end of the week.",
      "Treat the tear as normal use and continue without telling Smooth."
    ]
  },
  {
    "entryId": "question-moving-furniture",
    "fingerprint": "d803cbc",
    "prompt": "A client wants a couch moved for their next shot. Who handles the move?",
    "alternatives": [
      "Ask the client to drag it into position while you watch.",
      "Let any guest move it if two people help."
    ]
  },
  {
    "entryId": "question-prop-inspection",
    "fingerprint": "37a5d86c",
    "prompt": "You are about to hand a prop to a client. What should you check?",
    "alternatives": [
      "Check it only after the rental so you do not slow the client down.",
      "Use it even if it is damaged, as long as it looks fine on camera."
    ]
  },
  {
    "entryId": "question-trash-removal",
    "fingerprint": "5d87b4a7",
    "prompt": "A trash bin is nearly overflowing before the next rental. What should you do?",
    "alternatives": [
      "Leave all trash until the next day's opening shift.",
      "Empty the bin but leave replacing the liner to the next client."
    ]
  },
  {
    "entryId": "question-supply-restock",
    "fingerprint": "4967ed42",
    "prompt": "You notice that a studio supply is running low. How should you report it?",
    "alternatives": [
      "Wait until the supply is completely gone before reporting it.",
      "Keep the shortage in your own notes until someone else asks."
    ]
  },
  {
    "entryId": "question-unfinished-reset",
    "fingerprint": "687b27cf",
    "prompt": "The next booking is about to start and the reset is unfinished. What should you prioritize?",
    "alternatives": [
      "Focus on decorative details before clearing the areas the client needs.",
      "Leave without telling anyone what is unfinished."
    ]
  },
  {
    "entryId": "question-collecting-payment",
    "fingerprint": "23d43a76",
    "prompt": "A client wants to pay the studio in cash. What should you do?",
    "alternatives": [
      "Tell them cash can never be accepted at the studio.",
      "Keep the cash with your personal money and report it on payday."
    ]
  },
  {
    "entryId": "question-new-bookings",
    "fingerprint": "6d39200e",
    "prompt": "A client asks you to make a new reservation or change an existing booking. Where should you direct them?",
    "alternatives": [
      "Promise a time based only on whether the studio looks empty.",
      "Write the change in your personal notes and treat it as confirmed."
    ]
  },
  {
    "entryId": "question-price-questions",
    "fingerprint": "7f6b9670",
    "prompt": "A discount question is not answered in the booking. Who should handle it?",
    "alternatives": [
      "Choose a discount yourself based on how long the client has been waiting.",
      "Use a previous client's price without checking whether it applies."
    ]
  },
  {
    "entryId": "question-invoice-only-events",
    "fingerprint": "f5d131bb",
    "prompt": "A manually added event has unclear booking and payment details. What should you do before check-in?",
    "alternatives": [
      "Treat the event as fully paid because it appears on the Calendar.",
      "Ask the client to choose the price and continue without checking."
    ]
  },
  {
    "entryId": "question-refund-requests",
    "fingerprint": "a5de1fac",
    "prompt": "A client asks for a refund or free time. What can you promise?",
    "alternatives": [
      "Guarantee a refund before anyone reviews the concern.",
      "Offer free time yourself as long as the studio appears available."
    ]
  },
  {
    "entryId": "question-incident-report",
    "fingerprint": "99575e3e",
    "prompt": "An incident needs to be reported. How should you communicate it?",
    "alternatives": [
      "Wait until the next team meeting and explain it from memory.",
      "Send only a vague message that something went wrong."
    ]
  },
  {
    "entryId": "question-equipment-damage",
    "fingerprint": "268b021d",
    "prompt": "You discover damage to studio equipment. What should happen next?",
    "alternatives": [
      "Put it back into service if the damage is not visible in photos.",
      "Wait for another host to report it before taking action."
    ]
  },
  {
    "entryId": "question-walkways-cables",
    "fingerprint": "72869d2d",
    "prompt": "The lighting setup changes during a rental. When should you recheck cables and walkways?",
    "alternatives": [
      "Only at closing, because the initial safety check already passed.",
      "Only if a client trips or complains."
    ]
  },
  {
    "entryId": "question-social-posting",
    "fingerprint": "9211f2ea",
    "prompt": "You want to publish studio or client content. What should you verify?",
    "alternatives": [
      "That the footage looks good; an approved plan and permission are unnecessary.",
      "That another employee likes the post, even if the client has not approved it."
    ]
  },
  {
    "entryId": "question-private-information",
    "fingerprint": "6300d17b",
    "prompt": "You need to refer to a client's contact and payment details. Where should those details stay?",
    "alternatives": [
      "Copy them into a public team note for easier access.",
      "Keep a separate personal list of every client's contact and payment details."
    ]
  },
  {
    "entryId": "question-personal-studio-use",
    "fingerprint": "2ea24b9d",
    "prompt": "You want to use the studio for your own shoot or practice. What should you arrange first?",
    "alternatives": [
      "Use any empty studio without checking because you are on the team.",
      "Start the shoot and discuss booking or charges afterward."
    ]
  },
  {
    "entryId": "question-content-delivery",
    "fingerprint": "cd4b71b4",
    "prompt": "Your approved BTS files are ready. How should you deliver them?",
    "alternatives": [
      "Keep them only on your phone until someone asks for them.",
      "Upload unnamed files wherever you have spare storage."
    ]
  },
  {
    "entryId": "question-client-reviews",
    "fingerprint": "bbc1638a",
    "prompt": "At closeout, what does the guideline say about reviews and social follows?",
    "alternatives": [
      "Require a review before the client can leave.",
      "Ask for neither reviews nor social follows under any circumstances."
    ]
  },
  {
    "entryId": "guide-61a01e8e-300f-470b-a1a3-07d456238c38",
    "fingerprint": "385cd826",
    "prompt": "The client is about to leave. What studio keepsake task should you complete?",
    "alternatives": [
      "Ask the client to sign a blank equipment form for the next host.",
      "Give the client a printed booking screenshot to take home."
    ]
  },
  {
    "entryId": "question-balance-before-start",
    "fingerprint": "2742b3ab",
    "prompt": "A rental has an unpaid balance. When should you collect and verify it?",
    "alternatives": [
      "Wait until the weekly payout review to ask whether the client paid.",
      "Let the client leave and assume an online payment will appear later."
    ]
  }
];
