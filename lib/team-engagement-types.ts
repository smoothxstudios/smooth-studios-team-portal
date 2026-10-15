export type CreativeQuestion = {
  id: string; day: string; category: string; prompt: string; options: { id: string; text: string }[];
};
export type CreativeAttempt = {
  day: string; createdAt: string; question: CreativeQuestion; selectedOptionId: string;
  correctOptionId: string; correct: boolean; points: number; explanation: string;
  source: { label: string; url: string };
};
export type StudioStars = {
  points: number; stars: number; progress: number; goal: number; remaining: number;
  answered: number; correct: number; incorrect: number;
};
export type MoodCheckin = { id: string; mood: string; createdAt: string };
export type EmployeeEngagement = {
  serverNow: number; day: string; moodDue: boolean; nextMoodAt: number;
  lastMood: MoodCheckin | null; questionDue: boolean; question: CreativeQuestion;
  attempt: CreativeAttempt | null; summary: StudioStars; history: CreativeAttempt[];
};
export type TeamEngagement = {
  serverNow: number; day: string; members: {
    userId: string; name: string; color: string; summary: StudioStars;
    history: CreativeAttempt[]; moods: MoodCheckin[]; today: CreativeAttempt | null;
  }[];
};
