"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, Clock3, RefreshCw, Smile, Sparkles, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSidebar } from "@/components/ui/sidebar";
import { teamRequest } from "@/lib/team-api";
import { MOODS, nextEngagementPrompt, QUIZ_TIERS, STAR_POINTS } from "@/lib/team-engagement.mjs";
import type { CreativeAttempt, EmployeeEngagement, RewardChange, StudioStars, TeamEngagement } from "@/lib/team-engagement-types";

const clock = (value: string | number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const moodFor = (id?: string) => MOODS.find(mood => mood.id === id);
const tierLabel = (id: string) => QUIZ_TIERS.find(tier => tier.id === id)?.label ?? "Medium";
const answerText = (attempt: CreativeAttempt, correct = false) => attempt.question.options.find(option => option.id === (correct ? attempt.correctOptionId : attempt.selectedOptionId))?.text ?? "—";

function StarGoal({ summary }: { summary: StudioStars }) {
  return <div className="studio-star-goal">
    <div className="engagement-row"><strong><Star size={17} aria-hidden="true" /> {summary.points} points</strong><span>{summary.stars} {summary.stars === 1 ? "SmoothStar" : "SmoothStars"} collected</span></div>
    <progress aria-label="Progress toward your next earned SmoothStar" max={STAR_POINTS} value={summary.progress} />
    <small>{summary.remaining} points to your next earned SmoothStar · Goal: {summary.goal} total points</small>
  </div>;
}

function StarCollection({ summary }: { summary: StudioStars }) {
  return <div className="smoothstar-collection" aria-label={`${summary.stars} SmoothStars collected`}>
    <Star size={32} aria-hidden="true" /><div><strong>{summary.stars}</strong><span>SmoothStars collected</span><small>{summary.earnedStars} earned · {summary.awardedStars} awarded{summary.removedStars > 0 ? ` · ${summary.removedStars} removed` : ""}</small></div>
  </div>;
}
function RewardHistory({ rewards }: { rewards: RewardChange[] }) {
  if (!rewards.length) return null;
  return <><h3 className="creative-history-title">Points & star activity</h3><div className="reward-history">{rewards.map(reward => <div key={reward.id}><div className="engagement-row"><strong>{`${reward.amount > 0 ? "+" : ""}${reward.amount} ${reward.kind === "star" ? Math.abs(reward.amount) === 1 ? "SmoothStar" : "SmoothStars" : "points"}`}</strong><small>{clock(reward.createdAt)}</small></div><p>{reward.reason}</p></div>)}</div></>;
}
function NextQuizTime({ state }: { state: EmployeeEngagement }) {
  return state.nextQuestionAt ? <p className="quiz-next-time"><Clock3 size={16} aria-hidden="true" /><span>Next question: <strong>{clock(state.nextQuestionAt)} Eastern</strong></span></p> : <p className="engagement-muted quiz-tomorrow">Come back tomorrow for a new question.</p>;
}

function AnswerResult({ attempt, celebrate = false }: { attempt: CreativeAttempt; celebrate?: boolean }) {
  return <div className={`creative-result ${attempt.correct ? "is-correct" : "is-incorrect"}${celebrate ? " celebrate-correct" : ""}`} role="status">
    {celebrate && attempt.correct && <div className="quiz-celebration" aria-hidden="true"><span className="quiz-success-mark"><Check size={30} /></span>{Array.from({ length: 6 }, (_, i) => <i key={i} className={`quiz-confetti confetti-${i}`} />)}</div>}
    <strong>{attempt.correct ? `Correct! +${attempt.points} points` : "Not quite · 0 points"}</strong>
    {!attempt.correct && <p>Your answer: {answerText(attempt)}</p>}
    <p><b>Answer:</b> {answerText(attempt, true)}</p>
    <p>{attempt.explanation}</p>
    <a href={attempt.source.url} target="_blank" rel="noopener noreferrer">{attempt.source.label} ↗</a>
  </div>;
}

function AttemptHistory({ attempts }: { attempts: CreativeAttempt[] }) {
  return <div className="creative-history">{attempts.length ? attempts.map(attempt => <details key={`${attempt.day}:${attempt.tier}`}>
    <summary><span>{dayLabel(attempt.day)} · {tierLabel(attempt.tier)} · {attempt.question.category}</span><strong className={attempt.correct ? "creative-correct" : ""}>{attempt.correct ? `+${attempt.points} · Correct` : "0 · Incorrect"}</strong><p>{attempt.question.prompt}</p></summary>
    <AnswerResult attempt={attempt} />
  </details>) : <p className="engagement-muted">Your answered questions will appear here.</p>}</div>;
}

type EngagementContextValue = {
  state: EmployeeEngagement | null; busy: boolean; error: string; notice: string; homeActive: boolean;
  panel: "mood" | "question" | null; openPanel: (panel: "mood" | "question") => void;
  openProgress: () => void; refresh: () => void;
};
const EngagementContext = createContext<EngagementContextValue | null>(null);

export function EmployeeEngagementProvider({ token, enabled, homeActive, children }: { token: string; enabled: boolean; homeActive: boolean; children: ReactNode }) {
  const [state, setState] = useState<EmployeeEngagement | null>(null);
  const [panel, setPanel] = useState<"mood" | "question" | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [option, setOption] = useState("");
  const [celebration, setCelebration] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0), busyRef = useRef(false), shown = useRef(new Set<string>());
  const moodRequestId = useRef("");
  const popupRef = useRef<HTMLDivElement>(null);
  const mounted = useRef(false);
  const checkedState = (result: EmployeeEngagement) => {
    if (result.quizVersion !== 3 || !Array.isArray(result.quiz)) throw new Error("Daily Quiz is updating. Please refresh in a moment.");
    return result;
  };
  const load = useCallback(async () => {
    if (!enabled || busyRef.current) return;
    const sequence = ++requestSequence.current;
    try {
      const result = checkedState(await teamRequest<EmployeeEngagement>(token, "/engagement"));
      if (mounted.current && sequence === requestSequence.current) { setState(result); setError(""); }
    } catch { if (mounted.current && sequence === requestSequence.current) setError("Check-ins couldn't load. Try refreshing in a moment."); }
  }, [token, enabled]);

  useEffect(() => {
    mounted.current = true;
    if (!enabled) return () => { mounted.current = false; };
    void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh); window.addEventListener("focus", refresh);
    return () => { mounted.current = false; requestSequence.current++; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [load, enabled]);
  const current = state?.quiz.find(item => item.question.id === state.currentQuestionId);
  useEffect(() => { moodRequestId.current = ""; }, [state?.moodRevision]);
  useEffect(() => { setOption(""); setCelebration(""); if (popupRef.current) popupRef.current.scrollTop = 0; }, [current?.question.id]);
  useEffect(() => { if (!homeActive) setPanel(null); }, [homeActive]);
  useEffect(() => {
    if (!state || panel || progressOpen || busy || error || document.querySelector('[role="dialog"][data-state="open"]')) return;
    const kind = nextEngagementPrompt(state, homeActive) as "mood" | "question" | null;
    if (!kind) return;
    const key = kind === "mood" ? `mood:${state.moodRevision ?? 0}:${state.nextMoodAt}` : `question:${state.currentQuestionId}`;
    if (shown.current.has(key)) return;
    shown.current.add(key); setPanel(kind);
    if (kind === "question") {
      // Each server-issued question prompts once, including across devices.
      void save("/engagement/dismiss", { kind, day: state.day, questionId: state.currentQuestionId }, () => {});
    }
  }, [state, panel, progressOpen, busy, error, homeActive]);

  async function save(path: string, data: unknown, onSuccess: (result: EmployeeEngagement) => void) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const sequence = ++requestSequence.current;
    try {
      const result = checkedState(await teamRequest<EmployeeEngagement>(token, path, data));
      if (mounted.current && sequence === requestSequence.current) { setState(result); onSuccess(result); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "This wasn't saved. Please try again."); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function recordMood(mood: string) {
    if (!moodRequestId.current) moodRequestId.current = crypto.randomUUID();
    void save("/engagement/mood", { mood, requestId: moodRequestId.current }, () => {
      moodRequestId.current = ""; setNotice("Temp Check saved."); setPanel(null);
    });
  }
  function dismiss() {
    if (!state || !panel || busy) return;
    if ((panel === "question" && !state.questionDue) || (panel === "mood" && !state.moodDue)) { setPanel(null); return; }
    void save("/engagement/dismiss", { kind: panel, day: state.day, questionId: state.currentQuestionId }, () => { setNotice(""); setPanel(null); });
  }
  function submitAnswer() {
    if (!state || !current || !option || current.attempt || !state.available) return;
    const previousStars = state.summary.stars, submittedId = current.question.id;
    void save("/engagement/answer", { day: state.day, tier: current.question.tier, questionId: submittedId, optionId: option }, result => {
      const attempt = result.quiz.find(item => item.question.id === submittedId)?.attempt;
      if (attempt?.correct) setCelebration(submittedId);
      if (popupRef.current) popupRef.current.scrollTop = 0;
      setNotice(result.summary.stars > previousStars ? `You earned SmoothStar ${result.summary.stars}!` : "");
    });
  }
  function openPanel(kind: "mood" | "question") {
    if (!homeActive || !state) return;
    setProgressOpen(false); setPanel(kind); setError(""); setCelebration("");
    if (kind === "question") {
      if (state.questionDue) void save("/engagement/dismiss", { kind, day: state.day, questionId: state.currentQuestionId }, () => {});
    }
  }
  const latestMood = moodFor(state?.lastMood?.mood);
  const context: EngagementContextValue = { state, busy, error, notice, homeActive, panel, openPanel,
    openProgress: () => { setPanel(null); setProgressOpen(true); }, refresh: () => void load() };
  return <EngagementContext.Provider value={enabled ? context : null}>
    {children}
    <Dialog open={Boolean(enabled && homeActive && state && panel)} onOpenChange={open => { if (!open) dismiss(); }}>
      <DialogContent ref={popupRef} className={`engagement-popup${panel === "mood" ? " temp-check-popup" : ""}`} showCloseButton={false}>
        <div className="engagement-popup-heading"><DialogTitle>{panel === "mood" ? "Temp Check" : "Daily Quiz"}</DialogTitle><button type="button" className="engagement-close" aria-label={panel === "mood" ? "Dismiss Temp Check" : "Dismiss Daily Quiz"} disabled={busy} onClick={dismiss}><X size={19} /></button></div>
        <DialogDescription className={panel === "mood" ? "engagement-muted" : "sr-only"}>{panel === "mood" ? state?.moodDue ? "How are you feeling?" : "You're checked in for now." : "One question at a time, with two hours between answers. Up to three different difficulties each day."}</DialogDescription>
        {state && (panel === "mood" ? <>
          {state.moodDue ? <div className="temp-check-moods">{MOODS.map(mood => <button type="button" key={mood.id} disabled={busy} onClick={() => recordMood(mood.id)} aria-label={`I'm feeling ${mood.label.toLowerCase()}`}><span aria-hidden="true">{mood.emoji}</span><strong>{mood.label}</strong></button>)}</div> : <div className="temp-check-saved">{latestMood ? <><span aria-hidden="true">{latestMood.emoji}</span><strong>{latestMood.label}</strong><small>{clock(state.lastMood!.createdAt)} Eastern</small></> : <strong>You skipped this check-in.</strong>}</div>}
          <Button variant="outline" disabled={busy} onClick={dismiss}>{state.moodDue ? "Skip for now" : "Done"}</Button>
        </> : current && <>
          <div className="engagement-row quiz-current-tier"><strong>{tierLabel(current.question.tier)} · {current.question.points} points</strong><span>{state.answeredToday}/3 answered today</span></div>
          <div className="creative-question-meta"><span>{current.question.category}</span></div>
          <h3 className="creative-question-title">{current.question.prompt}</h3>
          {current.attempt ? <>
            <AnswerResult key={current.question.id} attempt={current.attempt} celebrate={celebration === current.question.id} />
            <NextQuizTime state={state} /><Button variant="outline" disabled={busy} onClick={dismiss}>Done for now</Button>
          </> : <form onSubmit={event => { event.preventDefault(); submitAnswer(); }}>
            <fieldset className="creative-choices" disabled={busy}><legend className="sr-only">Choose one answer</legend>{current.question.options.map(choice => <label key={choice.id} className={option === choice.id ? "selected" : ""}><input type="radio" name="daily-quiz-answer" value={choice.id} checked={option === choice.id} onChange={() => setOption(choice.id)} /><span>{choice.text}</span></label>)}</fieldset>
            <p className="engagement-privacy">Your next question unlocks two hours after you answer.</p>
            <div className="engagement-row"><Button type="button" variant="outline" onClick={dismiss} disabled={busy}>Later</Button><Button type="submit" disabled={!option || busy}>{busy ? "Saving…" : "Submit answer"}<ChevronRight size={15} /></Button></div>
          </form>}
        </>)}
        {error && <p className="engagement-error" role="alert">{error} <button disabled={busy} type="button" onClick={() => void load()}>Refresh</button></p>}
      </DialogContent>
    </Dialog>
    <Dialog open={enabled && progressOpen} onOpenChange={setProgressOpen}><DialogContent className="schedule-modal studio-stars-dialog"><DialogHeader><DialogTitle>My SmoothStars</DialogTitle><DialogDescription>Easy: 5 points. Medium: 10. Very Hard: 15. Reach each 100-point milestone to earn a SmoothStar. Smooth can also award stickers directly.</DialogDescription></DialogHeader>
      {state && <><StarCollection summary={state.summary} /><div className="studio-sticker-wall" aria-label={`${state.summary.stars} SmoothStars collected`}>{Array.from({ length: Math.min(10, Math.max(1, state.summary.stars)) }, (_, i) => <span className={`studio-star-sticker${state.summary.stars ? " earned" : ""}`} key={i}><Star size={40} aria-hidden="true" /></span>)}{state.summary.stars > 10 && <strong>+{state.summary.stars - 10} more</strong>}</div><StarGoal summary={state.summary} /><p className="engagement-muted">{state.summary.correct} correct · {state.summary.incorrect} incorrect · {state.summary.answered} answered</p><h3 className="creative-history-title">Recent answers</h3><AttemptHistory attempts={state.history} /><RewardHistory rewards={state.rewards} /></>}
    </DialogContent></Dialog>
  </EngagementContext.Provider>;
}

export function EmployeeEngagementBar() {
  const engagement = useContext(EngagementContext);
  if (!engagement?.homeActive) return null;
  const { state, busy, panel, openPanel, notice, error, refresh } = engagement;
  return <section className="engagement-widget" aria-label="Temp Check and Daily Quiz">
    <div className="engagement-bar engagement-links">
      <button type="button" disabled={!state || busy} onClick={() => openPanel("mood")} aria-expanded={panel === "mood"}><Smile size={17} /><span>Temp Check</span>{state?.moodDue && <i className="engagement-dot" aria-label="Due now" />}</button>
      <button type="button" disabled={!state || busy} onClick={() => openPanel("question")} aria-expanded={panel === "question"}><Sparkles size={16} /><span>Daily Quiz</span>{state && <small>{state.answeredToday}/3</small>}{state?.available && <i className="engagement-dot" aria-label="Question ready" />}</button>
    </div>
    {notice && <p className="engagement-feedback" role="status">{notice}</p>}
    {error && !panel && <p className="engagement-error" role="alert">{error} <button type="button" disabled={busy} onClick={refresh}>Refresh</button></p>}
  </section>;
}

export function SmoothStarSidebar() {
  const engagement = useContext(EngagementContext), { setOpenMobile } = useSidebar();
  if (!engagement) return null;
  const { state, openProgress } = engagement;
  return <button type="button" className="smoothstar-sidebar" disabled={!state} onClick={() => { setOpenMobile(false); openProgress(); }} aria-label={state ? `Road to a SmoothStar: ${state.summary.points} points, ${state.summary.stars} collected. View progress.` : "Loading SmoothStars"}>
    <strong className="smoothstar-heading"><Star size={16} aria-hidden="true" /> Road to a SmoothStar</strong><span className="smoothstar-sidebar-count"><b>{state?.summary.stars ?? "—"}</b><span>SmoothStars collected</span></span>
    <progress aria-label="Progress toward your next SmoothStar" max={STAR_POINTS} value={state?.summary.progress ?? 0} />
    <small>{state ? `${state.summary.points} pts · ${state.summary.remaining} to next` : "Loading progress…"}<ChevronRight size={13} /></small>
  </button>;
}

export function TeamEngagementReview({ token }: { token: string }) {
  const [state, setState] = useState<TeamEngagement | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0), savingRef = useRef(false), rewardRequest = useRef({ key: "", id: "" });
  const [action, setAction] = useState("add");
  const [amount, setAmount] = useState("5");
  const [questionId, setQuestionId] = useState("");
  const [saving, setSaving] = useState(false);
  const [rewardError, setRewardError] = useState("");
  const [rewardNotice, setRewardNotice] = useState("");
  useEffect(() => { setAction("add"); setAmount("5"); setQuestionId(""); setRewardError(""); setRewardNotice(""); rewardRequest.current = { key: "", id: "" }; }, [selected]);
  const load = useCallback(async () => {
    const request = ++sequence.current; setBusy(true);
    try { const result = await teamRequest<TeamEngagement>(token, "/engagement/team"); if (result.quizVersion !== 3) throw new Error("Quiz update pending"); if (request === sequence.current) { setState(result); setError(""); } }
    catch { if (request === sequence.current) setError("Team check-ins couldn't load. Try refreshing."); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const member = state?.members.find(person => person.userId === selected);
  const todaysQuestions = member?.todayQuiz ?? [];
  const resetQuestion = todaysQuestions.find(item => item.question.id === questionId) ?? todaysQuestions.find(item => !item.attempt) ?? todaysQuestions.at(-1);
  const resetting = action === "reset-mood" || action === "reset-question";
  const starAction = action === "star" || action === "remove-stars";
  const numericAmount = Number(amount), signedAmount = ["remove", "remove-stars"].includes(action) ? -numericAmount : numericAmount;
  const validAmount = Number.isSafeInteger(numericAmount) && numericAmount > 0 && numericAmount <= 10000;
  const pointsRemoved = Math.min(resetQuestion?.attempt?.points ?? 0, member?.summary.points ?? 0);
  const supportsControls = state?.ownerControlsVersion === 1;
  const validReward = Boolean(member && (resetting ? supportsControls && (action === "reset-mood" || resetQuestion) :
    action === "star" || (validAmount && (action === "remove-stars" ? supportsControls && numericAmount <= member.summary.stars : member.summary.points + signedAmount >= 0))));
  const actionLabel = action === "star" ? "Award SmoothStar" : action === "remove-stars" ? "Remove SmoothStars" : action === "remove" ? "Remove points" :
    action === "reset-mood" ? "Reset today's Temp Check" : action === "reset-question" ? "Reset question" : "Add points";
  async function saveReward() {
    if (!member || !state || !validReward || busy || savingRef.current) return;
    const payload = resetting ? { userId: member.userId, reason: "Reset by Smooth", day: state.day,
      ...(action === "reset-mood" ? { kind: "mood", moodRevision: member.moodRevision } : {
        kind: "question", tier: resetQuestion!.question.tier, questionId: resetQuestion!.question.id, attemptedAt: resetQuestion!.attempt?.createdAt ?? null,
      }) } : { userId: member.userId, kind: starAction ? "star" : "points", amount: action === "star" ? 1 : signedAmount, reason: "Adjusted by Smooth" };
    const key = JSON.stringify(payload);
    if (rewardRequest.current.key !== key) rewardRequest.current = { key, id: crypto.randomUUID() };
    savingRef.current = true; setSaving(true); setRewardError(""); setRewardNotice("");
    const request = ++sequence.current;
    try {
      const result = await teamRequest<TeamEngagement>(token, resetting ? "/engagement/reset" : "/engagement/rewards", { ...payload, requestId: rewardRequest.current.id });
      if (result.quizVersion !== 3) throw new Error("SmoothStars is updating. Please refresh in a moment.");
      if (request === sequence.current) {
        setState(result); setRewardNotice(action === "reset-mood" ? `Today's Temp Check is ready again for ${member.name}.` :
          action === "reset-question" ? `${member.name}'s question is ready to retry.` : action === "remove-stars" ? `Removed ${numericAmount} ${numericAmount === 1 ? "SmoothStar" : "SmoothStars"} from ${member.name}.` :
          action === "star" ? `Awarded a SmoothStar to ${member.name}.` : `Updated ${member.name}'s points.`);
        setQuestionId(""); rewardRequest.current = { key: "", id: "" };
      }
    } catch (e) { if (request === sequence.current) setRewardError(e instanceof Error ? e.message : "That wasn't saved. Try again."); }
    finally { savingRef.current = false; setSaving(false); }
  }
  return <section className="panel team-engagement-review">
    <div className="panel-heading"><div><h2><Smile size={20} /> Temp Check & SmoothStars</h2><p>Employee check-ins and Daily Quiz results. Visible to you; employees see only their own.</p></div><Button variant="outline" disabled={busy || saving} onClick={() => void load()}><RefreshCw size={15} />{busy ? "Loading…" : "Refresh"}</Button></div>
    {error && <p className="engagement-error" role="alert">{error}</p>}
    {state && <><p className="engagement-muted engagement-review-note">Easy: 5 points · Medium: 10 · Very Hard: 15 · 100 points per SmoothStar.</p><div className="team-checkin-grid">{state.members.map(person => {
      const mood = moodFor(person.moods[0]?.mood);
      return <button type="button" key={person.userId} className="team-checkin-card" onClick={() => setSelected(person.userId)}>
        <span className="engagement-row"><strong className="schedule-person"><i style={{ background: person.color }} />{person.name}</strong><ChevronRight size={16} /></span>
        <span className="team-checkin-mood">{mood ? <><span aria-hidden="true">{mood.emoji}</span>{mood.label}</> : "No check-in yet"}</span>
        <small>{person.moods[0] ? `${clock(person.moods[0].createdAt)} Eastern` : "Employees can skip a check-in."}</small>
        <span className="team-checkin-score"><Star size={16} />{person.summary.points} points · {person.summary.stars} SmoothStars</span>
        <small>Today: {person.today.length}/3 answered · +{person.today.reduce((sum, attempt) => sum + attempt.points, 0)} points</small>
      </button>;
    })}</div></>}
    <Dialog open={Boolean(member)} onOpenChange={open => { if (!open && !saving) setSelected(""); }}><DialogContent className="schedule-modal studio-stars-dialog"><DialogHeader><DialogTitle>{member?.name} · Check-ins & SmoothStars</DialogTitle><DialogDescription>Self-reported moods and recorded daily answers. All dates are Eastern.</DialogDescription></DialogHeader>
      {member && <><StarCollection summary={member.summary} /><StarGoal summary={member.summary} />
        <form className="reward-controls" onSubmit={event => { event.preventDefault(); void saveReward(); }}>
          <h3>Manage check-ins, points & SmoothStars</h3>
          <fieldset disabled={saving || busy}>
            <div className="reward-control-fields"><label>Action<select aria-label="Action" value={action} onChange={event => { setAction(event.target.value); setAmount(event.target.value === "remove-stars" ? "1" : "5"); setRewardError(""); setRewardNotice(""); }}><option value="add">Add points</option><option value="remove">Remove points</option><option value="star">Award a SmoothStar</option><option value="remove-stars" disabled={!supportsControls}>Remove SmoothStars</option><option value="reset-mood" disabled={!supportsControls}>Reset today's Temp Check</option><option value="reset-question" disabled={!supportsControls}>Reset a question for today</option></select></label>
            {!resetting && action !== "star" && <label>{action === "remove-stars" ? "SmoothStars" : "Points"}<input type="number" min="1" max="10000" step="1" inputMode="numeric" value={amount} onChange={event => setAmount(event.target.value)} required /></label>}</div>
            {action === "reset-question" && <><label>Today's question<select aria-label="Today's question" value={resetQuestion?.question.id ?? ""} onChange={event => setQuestionId(event.target.value)} disabled={!todaysQuestions.length}><option value="" disabled>Choose a question</option>{todaysQuestions.map(item => <option key={item.question.id} value={item.question.id}>{tierLabel(item.question.tier)} · {item.attempt ? `${item.attempt.correct ? "Correct" : "Incorrect"} · ${item.attempt.points} points` : "Not answered"}</option>)}</select></label>{resetQuestion ? <p className="engagement-muted">{resetQuestion.question.prompt}</p> : <p className="engagement-muted">No question has been opened today. Have them open Daily Quiz first.</p>}</>}
            <p className="engagement-muted">{action === "reset-mood" ? `Clears today's Temp Check entries for ${member.name} and lets them check in again now. Earlier days stay in their history.` :
              action === "reset-question" ? `Reopens this question now and removes ${pointsRemoved} points from the available balance. Other answers and collected stickers stay. Any other unanswered question waits until two hours after this retry.` :
              action === "star" ? `${member.name} will have ${member.summary.stars + 1} SmoothStars. Points stay the same.` :
              action === "remove-stars" ? `${member.name}: ${member.summary.stars} → ${validAmount ? Math.max(0, member.summary.stars - numericAmount) : "—"} SmoothStars. Points and the next points milestone stay the same.` :
              validAmount ? `${member.name}: ${member.summary.points} → ${member.summary.points + signedAmount} points. Collected stickers are kept.` : "Enter a whole number of points."}</p>
            {action === "remove" && validAmount && member.summary.points + signedAmount < 0 && <p className="engagement-error">Choose an amount up to {member.summary.points} points.</p>}
            {action === "remove-stars" && validAmount && numericAmount > member.summary.stars && <p className="engagement-error">They have {member.summary.stars} SmoothStars available to remove.</p>}
            <Button type="submit" disabled={saving || busy || !validReward}>{saving ? "Saving…" : actionLabel}</Button>
          </fieldset>
          {rewardError && <p className="engagement-error" role="alert">{rewardError}</p>}{rewardNotice && <p className="engagement-feedback" role="status">{rewardNotice}</p>}
        </form>{Boolean(member.resets?.length) && <details className="engagement-reset-history"><summary>Recent resets</summary><div className="reward-history">{member.resets.map(reset => <div key={reset.id}><strong>{reset.kind === "mood" ? "Temp Check reset" : `${tierLabel(reset.tier ?? "")} question reset · −${reset.pointsRemoved} points`}</strong><p>{reset.reason}</p><small>{clock(reset.createdAt)}</small></div>)}</div></details>}<RewardHistory rewards={member.rewards} /><p className="engagement-muted">{member.summary.correct} correct · {member.summary.incorrect} incorrect · {member.summary.answered} answered</p><h3 className="creative-history-title">Recent Temp Checks</h3><div className="team-mood-history">{member.moods.length ? member.moods.map(checkin => { const mood = moodFor(checkin.mood); return <div key={checkin.id}><strong><span aria-hidden="true">{mood?.emoji}</span> {mood?.label}</strong><span>{clock(checkin.createdAt)}</span></div>; }) : <p className="engagement-muted">No check-ins recorded yet.</p>}</div><h3 className="creative-history-title">Recent quiz answers</h3><AttemptHistory attempts={member.history} /></>}
    </DialogContent></Dialog>
  </section>;
}
