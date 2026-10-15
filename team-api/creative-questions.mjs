// Server-only question bank. Do not import this module into client components.
// Explanations and correct choices are returned only after a recorded attempt.
const sources = {
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

// Interleave topics so employees do not receive a week of the same calculation.
export const QUESTION_BANK = [];
for (let i = 0; i < Math.max(shutter.length, frameRates.length, exposure.length, craft.length); i++) {
  for (const group of [shutter, craft, exposure, frameRates]) if (group[i]) QUESTION_BANK.push(group[i]);
}

export function dailyQuestion(day) {
  const epoch = Date.parse("2026-10-15T00:00:00Z"), date = Date.parse(`${day}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !Number.isFinite(date) || new Date(date).toISOString().slice(0, 10) !== day) throw new Error("Invalid question date.");
  const ordinal = Math.round((date - epoch) / 86400_000);
  const item = QUESTION_BANK[((ordinal % QUESTION_BANK.length) + QUESTION_BANK.length) % QUESTION_BANK.length];
  let seed = [...`${day}:${item.id}`].reduce((n, c) => Math.imul(n ^ c.charCodeAt(0), 16777619) >>> 0, 2166136261);
  const choices = item.choices.map((text, i) => ({ id: `choice-${i}`, text }));
  for (let i = choices.length - 1; i > 0; i--) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const j = seed % (i + 1); [choices[i], choices[j]] = [choices[j], choices[i]];
  }
  // Opaque display IDs must not reveal that the first authored option is correct.
  const correctIndex = choices.findIndex(choice => choice.text === item.correct);
  return { id: `v1:${day}:${item.id}`, day, category: item.category, prompt: item.prompt,
    options: choices.map((choice, i) => ({ id: `option-${i}`, text: choice.text })),
    correctOptionId: `option-${correctIndex}`, explanation: item.explanation, source: item.source };
}

export function publicQuestion(question) {
  const { id, day, category, prompt, options } = question;
  return { id, day, category, prompt, options };
}
