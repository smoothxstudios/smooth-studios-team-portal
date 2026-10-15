export const TEMP_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const CORRECT_ANSWER_POINTS = 10;
export const STAR_POINTS = 100;
export const MOODS = [
  { id: "happy", label: "Happy", emoji: "😊" },
  { id: "okay", label: "Eh / okay", emoji: "😐" },
  { id: "sad", label: "Sad", emoji: "🙁" },
  { id: "overwhelmed", label: "Overwhelmed", emoji: "😢" },
  { id: "tired", label: "Tired", emoji: "😴" },
];

export function starProgress(points) {
  const total = Number.isSafeInteger(points) && points > 0 ? points : 0;
  const stars = Math.floor(total / STAR_POINTS);
  return { points: total, stars, progress: total % STAR_POINTS, goal: (stars + 1) * STAR_POINTS,
    remaining: STAR_POINTS - total % STAR_POINTS };
}

// Due times are supplied by the server, never awarded from a device clock.
export function nextEngagementPrompt(state) {
  if (!state) return null;
  if (state.moodDue) return "mood";
  if (state.questionDue && !state.attempt) return "question";
  return null;
}
