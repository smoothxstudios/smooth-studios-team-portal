import { teamToken } from "../../lib/team-auth.mjs";
import { TEAM_API_URL } from "../../lib/team-schedule.mjs";
export async function syncGuidelineQuiz(rulebook, ownerPassword) {
  if (!rulebook?.updatedAt) return;
  const token = await teamToken(ownerPassword, "sync");
  const response = await fetch(`${TEAM_API_URL}/sync/quiz-guidelines`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(30000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(rulebook),
  });
  if (!response.ok) throw new Error(`Published studio guideline quiz sync failed (${response.status}).`);
  const result = await response.json();
  process.stdout.write(`Studio guideline quiz: ${result.questions} approved questions synced.\n`);
}
