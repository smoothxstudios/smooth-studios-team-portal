// Server-only question bank. Do not import this module into client components.
// Explanations and correct choices are returned only after a recorded attempt.
import { QUIZ_TIERS } from "../lib/team-engagement.mjs";

const sources = {
  whiteBalance: { label: "Adobe · White balance", url: "https://www.adobe.com/creativecloud/photography/technique/white-balance.html" },
  raw: { label: "Adobe · RAW and JPEG", url: "https://www.adobe.com/creativecloud/photography/discover/raw-vs-jpeg.html" },
  composition: { label: "Adobe · Rule of thirds", url: "https://www.adobe.com/au/creativecloud/photography/discover/rule-of-thirds.html" },
  remote: { label: "Profoto · Radio channels and groups", url: "https://www.profoto.com/ie/remotes" },
  trigger: { label: "Profoto · Remote setup and testing", url: "https://www.profoto.com/globalassets/support/user-guides/air-remote-ttl-f/profoto-air-remote-ttl-f-user-guide-english.pdf" },
  nd: { label: "Adobe · ND filters", url: "https://www.adobe.com/creativecloud/photography/technique/nd-filter.html" },
  flash: { label: "Nikon · Flash and ambient light", url: "https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/flash-points-the-control-of-light" },
  hss: { label: "Nikon · High-speed sync", url: "https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/using-auto-fp-high-speed-sync-to-illuminate-fast-sports-action" },
  clip: { label: "Adobe · Color and tonal adjustments", url: "https://helpx.adobe.com/camera-raw/desktop/using/make-color-tonal-adjustments-camera.html" },
  playback: { label: "Adobe · Interpreting frame rates", url: "https://helpx.adobe.com/premiere/desktop/edit-projects/modify-clip-properties/change-the-frame-rate-of-a-clip.html" },
  phase: { label: "Shure · Microphone phase cancellation", url: "https://www.shure.com/en-GB/insights/recording-drums-part-5-phase-cancellation" },
  shutter: { label: "RED · Shutter angle", url: "https://docs.red.com/955-0196_v1.6/Content/4_Menus/Image_LUT/Shutter.htm" },
  exposure: { label: "Nikon · Exposure basics", url: "https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/a-basic-look-at-the-basics-of-exposure" },
  aperture: { label: "Nikon · Aperture", url: "https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/understanding-maximum-aperture" },
  light: { label: "Adobe · Soft light", url: "https://www.adobe.com/creativecloud/photography/technique/diffused-light.html" },
  audio: { label: "Shure · Recording techniques", url: "https://www.shure.com/en-US/docs/education/Microphone-Techniques-for-Recording" },
  gain: { label: "Shure · Gain and clipping", url: "https://www.shure.com/en-US/docs/guide/MV7" },
};
function question(id, category, prompt, correct, others, explanation, source) {
  return { id, category, prompt, choices: [correct, ...others], correct, explanation, source };
}

const shutter = [24, 25, 30, 48, 50, 60, 100, 120].map(fps => question(
  `shutter-${fps}`, "Video", `You are recording at exactly ${fps} fps. What shutter speed gives a 180° shutter angle?`,
  `1/${fps * 2} second`, [`1/${fps} second`, `1/${fps * 4} second`, `1/${fps / 2} second`],
  `At 180°, expose for half of each frame: 1 ÷ (2 × ${fps}) = 1/${fps * 2} second. A nearby camera setting is an approximation.`, sources.shutter));
const frameRates = [48, 50, 60, 100, 120, 125, 200, 240].map(denominator => question(
  `frame-rate-${denominator}`, "Video", `At exactly 180°, which frame rate corresponds to a shutter speed of 1/${denominator} second?`,
  `${denominator / 2} fps`, [`${denominator} fps`, `${denominator * 2} fps`, `${denominator / 4} fps`],
  `Frame rate = ${denominator} ÷ 2 = ${denominator / 2} fps.${denominator === 125 ? " At 60 fps the exact setting is 1/120; 1/125 is a close practical approximation." : " This is the exact calculation, not a rounded camera setting."}`, sources.shutter));
const exposure = [60, 125, 250, 500, 1000].flatMap(denominator => [
  question(`exposure-fast-${denominator}`, "Exposure", `With aperture, ISO, and continuous light fixed, changing from 1/${denominator} to 1/${denominator * 2} second does what?`,
    "Lets in half as much light", ["Lets in twice as much light", "Keeps the same exposure", "Lets in four times as much light"],
    "The exposure time is halved. The sensor receives half the light, a one-stop decrease.", sources.exposure),
  question(`exposure-slow-${denominator}`, "Exposure", `With aperture, ISO, and continuous light fixed, changing from 1/${denominator * 2} to 1/${denominator} second does what?`,
    "Lets in twice as much light", ["Lets in half as much light", "Keeps the same exposure", "Lets in four times as much light"],
    "The shutter stays open twice as long. That doubles the light reaching the sensor, a one-stop increase.", sources.exposure),
]);
const craft = [
  question("aperture-light", "Camera basics", "With shutter speed, ISO, and lighting unchanged, which aperture lets in the most light?", "f/2", ["f/4", "f/8", "f/16"], "A smaller f-number means a wider opening. Of these choices, f/2 lets in the most light.", sources.aperture),
  question("aperture-depth", "Camera basics", "Keeping the lens, framing, and focus distance the same, which change usually gives a shallower depth of field?", "Change from f/8 to f/2.8", ["Change from f/8 to f/16", "Lower the ISO", "Use a faster shutter"], "Opening the aperture reduces depth of field when the other conditions stay the same.", sources.aperture),
  question("aperture-group", "Camera basics", "With people at slightly different distances, which change usually increases depth of field, all else equal?", "Stop down from f/2.8 to f/8", ["Open up from f/2.8 to f/1.4", "Use a faster shutter", "Raise ISO without changing aperture"], "A smaller aperture increases depth of field. You still need appropriate focus and enough light.", sources.aperture),
  question("motion-freeze", "Camera basics", "Using continuous light, which shutter speed is most likely to freeze a quickly moving hand?", "1/1000 second", ["1/30 second", "1/60 second", "1/125 second"], "A shorter exposure records less movement. Of these options, 1/1000 is the shortest exposure.", sources.shutter),
  question("motion-blur", "Video", "At a fixed frame rate, changing the shutter angle from 180° to 90° generally produces what?", "Less motion blur", ["More motion blur", "Twice the frame rate", "A wider field of view"], "The exposure time halves, recording less movement in each frame. It also lets in less light.", sources.shutter),
  question("motion-smear", "Video", "At a fixed frame rate, changing from 180° to 360° generally produces what?", "More motion blur", ["Less motion blur", "Half the frame rate", "A longer focal length"], "The exposure time doubles, so moving objects can travel farther during each frame's exposure.", sources.shutter),
  question("shutter-fps", "Video", "You change from 30 fps to 60 fps while keeping a 180° shutter. What happens to exposure time per frame?", "It halves", ["It doubles", "It stays the same", "It becomes four times longer"], "At 30 fps it is 1/60 second; at 60 fps it is 1/120. The per-frame exposure time halves.", sources.shutter),
  question("hard-light", "Lighting", "Which visible clue most clearly indicates a hard light source?", "Sharp-edged shadows", ["Soft shadow transitions", "No shadows anywhere", "A high ISO value"], "Hard light tends to create defined shadow edges. Soft light spreads the transition between light and shadow.", sources.light),
  question("soft-light", "Lighting", "A portrait has harsh shadow edges. Which tool is intended to diffuse the light?", "A diffusion panel", ["A memory card", "A camera trigger", "A lens cap"], "Diffusion scatters the light. A sufficiently large illuminated diffuser can soften its appearance on the subject.", sources.light),
  question("cloud-light", "Lighting", "Why does an overcast sky usually give softer shadows than direct midday sun?", "The clouds spread the light across a larger apparent source", ["The shutter automatically slows down", "Clouds increase the lens focal length", "The camera records fewer pixels"], "Clouds act as diffusion, spreading the sunlight and softening shadow transitions.", sources.light),
  question("light-quality", "Lighting", "Is hard light always a mistake in a portrait?", "No; it can be an intentional creative choice", ["Yes; every portrait must use soft light", "Yes; it means the lens is broken", "Only if ISO is below 400"], "Hard and soft light create different looks. Choose the quality of light to support the intended image.", sources.light),
  question("audio-clipping", "Audio", "Your recording is distorting because the microphone input is overloading. What should you try first?", "Lower the input gain and test again", ["Raise the input gain", "Increase the camera's ISO", "Turn up only the headphone volume"], "Input overload can cause clipping. Reducing input gain helps prevent that overload; headphone volume does not change the recorded input level.", sources.gain),
  question("audio-monitor", "Audio", "Which action helps you catch handling noise during a take?", "Listen to the recording feed through headphones", ["Watch only the video preview", "Increase shutter speed", "Turn the microphone away and stop monitoring"], "Monitoring the recording feed lets you hear problems while they can still be corrected.", sources.audio),
  question("audio-distance", "Audio", "To reduce room sound relative to a speaker's voice, what microphone change usually helps?", "Move the microphone appropriately closer to the speaker", ["Move it farther from the speaker", "Raise gain while leaving it far away", "Change the lens aperture"], "Closer placement generally improves the ratio of direct voice to room sound. Test the position and avoid unwanted breath or handling noise.", sources.audio),
  question("audio-plosives", "Audio", "What is a pop filter mainly used to reduce when recording speech?", "Bursts of air from sounds like P and B", ["Camera shake", "Overexposed highlights", "Video frame rate"], "Plosive consonants can send air at the microphone. A pop filter helps reduce that disturbance.", sources.audio),
  question("audio-test", "Audio", "Before recording an interview, which check is most useful for choosing an input level?", "Have the speaker talk at their expected volume while you monitor", ["Choose gain using only the room's silence", "Use the highest gain available", "Set gain from the camera's white balance"], "Set and test the recording level using the actual voice and expected loudness, leaving room for louder moments.", sources.gain),
];

// Difficulty is authored, not assigned randomly to the same bank.
const advanced = [
  [24, 100, 90], [25, 200, 45], [30, 400, 90], [50, 800, 45],
].map(([fps, iso, angle]) => {
  const factor = 2 * 180 / angle;
  return question(`compensate-${fps}`, "Video + exposure", `You switch from ${fps} fps / 180° to ${fps * 2} fps / ${angle}°. Aperture and continuous light stay fixed. Starting at ISO ${iso}, which ISO preserves brightness?`,
    `ISO ${iso * factor}`, [`ISO ${iso}`, `ISO ${iso * factor / 2}`, `ISO ${iso * factor * 2}`],
    `Exposure time is shutter angle ÷ (360 × fps). Doubling frame rate and changing 180° to ${angle}° makes exposure time ${factor} times shorter. Compensate with ${factor} times the ISO: ${iso} × ${factor} = ${iso * factor}.`, sources.exposure);
});
const angles = [[24, 96], [30, 80], [48, 240], [60, 100], [100, 500], [120, 320]].map(([fps, denominator]) => {
  const angle = 360 * fps / denominator;
  return question(`angle-${fps}`, "Video", `At ${fps} fps, you need exactly 1/${denominator} second per frame. What shutter angle achieves that, and how does its exposure time compare with 180°?`,
    `${angle}°; ${angle < 180 ? "shorter" : "longer"} exposure`, [`${angle}°; ${angle < 180 ? "longer" : "shorter"} exposure`, `180°; the same exposure`, `${angle / 2}°; shorter exposure`],
    `Angle = 360 × fps × exposure time = 360 × ${fps} ÷ ${denominator} = ${angle}°. At a fixed frame rate, ${angle < 180 ? "a smaller" : "a larger"} angle gives ${angle < 180 ? "less" : "more"} exposure time than 180°.`, sources.shutter);
});
const combinedExposure = [
  [100, 4, 8, 125, 500], [200, 4, 8, 250, 500], [400, 8, 4, 125, 1000], [800, 8, 4, 250, 500],
  [100, 2, 4, 500, 250], [400, 4, 8, 500, 125],
].map(([iso, beforeF, afterF, beforeSpeed, afterSpeed], index) => {
  const apertureFactor = (afterF / beforeF) ** 2, shutterFactor = afterSpeed / beforeSpeed;
  const neededIso = iso * apertureFactor * shutterFactor;
  return question(`combined-stops-${index}`, "Exposure", `Under fixed continuous light, you change f/${beforeF} to f/${afterF} AND 1/${beforeSpeed} to 1/${afterSpeed} second. Starting at ISO ${iso}, which ISO preserves brightness?`,
    `ISO ${neededIso}`, [`ISO ${neededIso / 2}`, `ISO ${neededIso * 2}`, `ISO ${neededIso * 4}`],
    `Account for both changes: ISO × (new f-number ÷ old f-number)² × (new shutter denominator ÷ old denominator). Here: ${iso} × ${apertureFactor} × ${shutterFactor} = ISO ${neededIso}.`, sources.exposure);
});
// A mix of practical studio skills, photography, video, audio, and post-production.
// These are general technical questions, not private studio-policy answers.
const studioEasy = [
  question("white-balance-purpose", "Color", "What does white balance help correct?", "An unwanted color cast from the lighting", ["Motion blur", "A tilted horizon", "An out-of-focus face"], "White balance adjusts color so neutral objects can appear neutral under the light used.", sources.whiteBalance),
  question("raw-flexibility", "Photo workflow", "Which format generally preserves more flexibility for adjusting white balance after a photo is taken?", "RAW", ["A small JPEG thumbnail", "A screenshot", "An exported GIF"], "RAW preserves more capture information. JPEG already has processing applied, which limits major adjustments.", sources.raw),
  question("thirds-grid", "Composition", "What does the rule-of-thirds grid divide your frame into?", "Nine sections using two horizontal and two vertical lines", ["Four sections using one line each way", "Three diagonal strips", "Twelve equal circles"], "The 3×3 grid offers lines and intersections for placing visual elements. It is a creative guide, not a requirement.", sources.composition),
  question("trigger-test", "Studio equipment", "Before a shoot, what does the TEST button on a compatible radio flash trigger help you check?", "Whether the linked flash fires", ["Whether the lens is in focus", "Whether a memory card is formatted", "Whether the camera's white balance is correct"], "A trigger test checks the radio firing path. Follow with a camera test shot to check the complete setup and exposure.", sources.trigger),
  question("nd-purpose", "Camera equipment", "What is the main purpose of a neutral-density filter?", "Reduce the light entering the lens", ["Make the lens longer", "Record sound", "Increase the sensor's pixel count"], "An ND filter reduces incoming light, allowing choices such as a wider aperture or longer exposure in bright conditions.", sources.nd),
];
const studioMedium = [
  question("flash-channel", "Studio equipment", "Your compatible radio trigger and flash are powered on but set to different radio channels. What should you check first?", "Set them to the same channel and test again", ["Close the aperture by two stops", "Change JPEG quality", "Switch the camera's aspect ratio"], "The trigger and receiving flash must share the intended channel to communicate. Other compatibility and receiver settings also need to be correct.", sources.trigger),
  question("flash-groups", "Studio equipment", "You want to adjust a key light without changing the fill light from your radio remote. How should you organize the lights?", "Use separate controllable groups on the same channel", ["Use different channels and expect both to respond together", "Put both lights in the same group", "Change only the camera's white balance"], "Groups let a compatible remote control different lights separately while they share a communication channel.", sources.remote),
  question("neutral-reference", "Color", "When using a white-balance eyedropper, which reference is the best starting point?", "A neutral gray surface lit by the subject's light", ["A bright red shirt", "A fully clipped white highlight", "A gray card photographed under different lighting"], "Use a neutral reference in the relevant lighting. Colored or clipped areas are poor references for neutralizing a cast.", sources.clip),
  question("flash-ambient", "Studio lighting", "With manual flash power, aperture, and ISO fixed, you slow the shutter from 1/200 to 1/100 within normal sync limits. What mainly increases?", "The ambient-light contribution", ["The flash's selected power", "The flash recycle speed", "The lens focal length"], "The longer exposure collects more ambient light. If the entire flash pulse is captured at both speeds, its contribution stays approximately the same.", sources.flash),
  question("playback-half", "Video editing", "A silent 60 fps clip is played at 30 fps, showing every captured frame once. What happens?", "It runs at half speed and lasts twice as long", ["It runs twice as fast", "It keeps the same duration", "Its resolution doubles"], "Playing 60 captured frames at 30 frames per second takes two seconds. This calculation assumes no frames are skipped or generated.", sources.playback),
  question("mic-spacing", "Audio", "Using the 3-to-1 guideline for two speakers with individual microphones, each mouth is 0.5 m from its microphone. What minimum microphone spacing does the guideline suggest?", "1.5 m", ["0.5 m", "0.75 m", "1.0 m"], "Three times 0.5 m is 1.5 m. The guideline helps limit problematic bleed; monitoring still matters and it does not guarantee no phase interaction.", sources.phase),
];
const studioHard = [
  question("phase-combined", "Audio troubleshooting", "Two microphones on one instrument sound full individually but thin when mixed. What is the most useful first investigation?", "Monitor them together while checking placement and phase interaction", ["Add the same gain to both without listening", "Boost only the headphone volume", "Compress both tracks as heavily as possible"], "Different arrival times can cause cancellation when signals combine. Check placement and phase relationships while listening to the combined result.", sources.phase),
  question("mixed-light-color", "Color workflow", "A face is lit by warm room light on one side and daylight on the other. A single global white-balance adjustment leaves one side tinted. Why?", "The two light sources need different color corrections", ["White balance only works at low ISO", "The shutter speed is necessarily wrong", "JPEG compression always creates orange shadows"], "A global adjustment affects the whole image. Mixed lighting may require controlling or matching the lights, or making selective color adjustments.", sources.whiteBalance),
  question("hss-tradeoff", "Studio lighting", "You need a shutter speed above a camera's normal flash sync limit. Which setup requirement matters?", "The camera, trigger, and flash must support and correctly use high-speed sync", ["Any flash will sync if ISO is high enough", "A modeling lamp automatically enables high-speed sync", "A faster memory card raises the flash sync limit"], "High-speed sync uses compatible equipment and a different flash firing behavior to illuminate during curtain travel. A fast shutter alone does not enable it.", sources.hss),
  question("nd-three-stops", "Exposure planning", "Your continuous-light shot is correct at 1/500, f/4, ISO 400. You add a 3-stop ND and keep f/4 and ISO 400. What exact exposure time restores brightness?", "1/62.5 second", ["1/1000 second", "1/250 second", "1/4000 second"], "Three stops remove a factor of eight in light. Multiply 1/500 second by eight to get 1/62.5 second; 1/60 is a nearby practical setting.", sources.nd),
  question("raw-clipped", "Photo workflow", "Every color channel in a highlight was saturated at capture, leaving no underlying detail. What can a RAW exposure slider reliably do?", "Darken that area, but not reconstruct the missing original detail", ["Recover all original detail automatically", "Restore it by changing white balance alone", "Recover it by exporting a larger JPEG"], "RAW offers adjustment latitude, but genuinely uncaptured information cannot be restored as the original scene detail. Prevent clipping of important highlights at capture.", sources.raw),
  question("playback-duration", "Video editing", "A silent 10-second recording at exactly 60 fps is conformed to exactly 24 fps, playing every captured frame once. How long is it?", "25 seconds", ["4 seconds", "20 seconds", "60 seconds"], "The clip contains 600 frames. At 24 frames per second, 600 ÷ 24 = 25 seconds, or 40% of the original playback speed.", sources.playback),
  question("flash-balance-compensation", "Studio lighting", "At 1/100, f/4, ISO 100, you want ambient light one stop darker while keeping manual-flash brightness similar. Assume 1/200 is within normal sync and captures the full pulse. Which change fits?", "Use 1/200 and keep aperture, ISO, and flash power unchanged", ["Use 1/50 with everything else unchanged", "Close to f/5.6 with flash power unchanged", "Reduce ISO to 50 with flash power unchanged"], "Halving the shutter time reduces ambient exposure by one stop. Under the stated sync conditions, it still captures the same flash pulse.", sources.flash),
  question("depth-exposure-tradeoff", "Portrait planning", "A group needs more depth of field. You change f/2.8 to f/5.6 under fixed continuous light and must keep shutter speed fixed. Starting at ISO 100, what ISO approximately preserves brightness?", "ISO 400", ["ISO 50", "ISO 200", "ISO 800"], "Closing from f/2.8 to f/5.6 is approximately two stops. Increasing ISO by two stops, from 100 to 400, compensates while preserving the chosen shutter speed.", sources.exposure),
];
const interleave = groups => Array.from({ length: Math.max(...groups.map(g => g.length)) }, (_, i) => groups.flatMap(g => g[i] ? [g[i]] : [])).flat();
export const QUESTION_BANKS = {
  easy: interleave([studioEasy, craft.filter(q => !["motion-blur", "motion-smear", "shutter-fps"].includes(q.id))]),
  medium: interleave([studioMedium, [shutter.find(q => q.id === "shutter-60"), frameRates.find(q => q.id === "frame-rate-125"), exposure[0], exposure[1], shutter[0]], craft.filter(q => ["motion-blur", "motion-smear", "shutter-fps"].includes(q.id))]),
  hard: interleave([studioHard, [advanced[0], angles[0], combinedExposure[0]]]),
};
export const QUESTION_BANK = Object.values(QUESTION_BANKS).flat();

export function dailyQuestion(day, tier = "medium") {
  const difficulty = QUIZ_TIERS.find(item => item.id === tier);
  if (!difficulty) throw new Error("Invalid question tier.");
  const epoch = Date.parse("2026-10-15T00:00:00Z"), date = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== day) throw new Error("Invalid question date.");
  const ordinal = Math.round((date - epoch) / 86400_000), bank = QUESTION_BANKS[tier];
  const item = bank[((ordinal % bank.length) + bank.length) % bank.length];
  let seed = [...`${day}:${item.id}`].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const choices = item.choices.map((text, i) => ({ id: `choice-${i}`, text }));
  for (let i = choices.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  // Opaque display IDs must not reveal that the first authored option is correct.
  const correctIndex = choices.findIndex(choice => choice.text === item.correct);
  return { id: `v3:${day}:${tier}:${item.id}`, day, tier, points: difficulty.points, category: item.category, prompt: item.prompt,
    options: choices.map((choice, i) => ({ id: `option-${i}`, text: choice.text })),
    correctOptionId: `option-${correctIndex}`, explanation: item.explanation, source: item.source };
}

export function publicQuestion(question) {
  const { id, day, tier, points, category, prompt, options } = question;
  return { id, day, tier, points, category, prompt, options };
}
