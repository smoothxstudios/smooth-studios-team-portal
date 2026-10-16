export const TEMP_CHECK_INTERVAL_MS = 3 * 60 * 60 * 1000;
export const QUIZ_INTERVAL_MS = 2 * 60 * 60 * 1000;
export const QUIZ_TIERS = [
  { id: "easy", label: "Easy", points: 5 },
  { id: "medium", label: "Medium", points: 10 },
  { id: "hard", label: "Very Hard", points: 15 },
];
export const STAR_POINTS = 100;
export const MOODS = [
  { id: "happy", label: "Happy", emoji: "😊" },
  { id: "chilling", label: "Chilling", emoji: "😎" },
  { id: "okay", label: "Eh / okay", emoji: "😐" },
  { id: "sad", label: "Sad", emoji: "🙁" },
  { id: "overwhelmed", label: "Overwhelmed", emoji: "😢" },
  { id: "tired", label: "Tired", emoji: "😴" },
];

export function starProgress(points, peakPoints = points, awardedStars = 0, removedStars = 0) {
  const total = Number.isSafeInteger(points) && points > 0 ? points : 0;
  const peak = Number.isSafeInteger(peakPoints) ? Math.max(total, peakPoints) : total;
  const earnedStars = Math.floor(peak / STAR_POINTS);
  const awarded = Number.isSafeInteger(awardedStars) && awardedStars > 0 ? awardedStars : 0;
  const removed = Number.isSafeInteger(removedStars) && removedStars > 0 ? Math.min(removedStars, earnedStars + awarded) : 0;
  const goal = (earnedStars + 1) * STAR_POINTS;
  return { points: total, stars: earnedStars + awarded - removed, earnedStars, awardedStars: awarded, removedStars: removed,
    progress: Math.max(0, total - earnedStars * STAR_POINTS), goal, remaining: goal - total };
}

// Due times are supplied by the server, never awarded from a device clock.
export function nextEngagementPrompt(state, homeActive = true) {
  if (!state || !homeActive) return null;
  if (state.moodDue) return "mood";
  if (state.questionDue && state.available) return "question";
  return null;
}
