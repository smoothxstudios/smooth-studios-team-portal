export type QuizTier = "easy" | "medium" | "hard";
export type CreativeQuestion = {
  id: string; day: string; category: string; prompt: string; options: { id: string; text: string }[];
  tier: QuizTier; points: number;
};
export type CreativeAttempt = {
  day: string; tier: QuizTier; createdAt: string; question: CreativeQuestion; selectedOptionId: string;
  correctOptionId: string; correct: boolean; points: number; explanation: string;
  source: { label: string; url: string };
};
export type StudioStars = {
  points: number; stars: number; earnedStars: number; awardedStars: number; progress: number; goal: number; remaining: number;
  answered: number; correct: number; incorrect: number;
};
export type RewardChange = { id: string; kind: "points" | "star"; amount: number; reason: string; createdAt: string };
export type MoodCheckin = { id: string; mood: string; createdAt: string };
export type EmployeeEngagement = {
  quizVersion: 3;
  serverNow: number; day: string; moodDue: boolean; nextMoodAt: number;
  lastMood: MoodCheckin | null; questionDue: boolean; available: boolean;
  currentQuestionId: string | null; answeredToday: number; nextQuestionAt: number | null;
  quiz: { question: CreativeQuestion; attempt: CreativeAttempt | null }[];
  summary: StudioStars; history: CreativeAttempt[]; rewards: RewardChange[];
};
export type TeamEngagement = {
  quizVersion: 3;
  serverNow: number; day: string; members: {
    userId: string; name: string; color: string; summary: StudioStars;
    history: CreativeAttempt[]; moods: MoodCheckin[]; today: CreativeAttempt[]; rewards: RewardChange[];
  }[];
};
