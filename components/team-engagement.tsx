"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Check, ChevronRight, RefreshCw, Smile, Sparkles, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useSidebar } from "@/components/ui/sidebar";
import { teamRequest } from "@/lib/team-api";
import { MOODS, nextEngagementPrompt, QUIZ_TIERS, STAR_POINTS } from "@/lib/team-engagement.mjs";
import type { CreativeAttempt, EmployeeEngagement, QuizTier, StudioStars, TeamEngagement } from "@/lib/team-engagement-types";

const clock = (value: string | number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const moodFor = (id?: string) => MOODS.find(mood => mood.id === id);
const tierLabel = (id: string) => QUIZ_TIERS.find(tier => tier.id === id)?.label ?? "Medium";
const answerText = (attempt: CreativeAttempt, correct = false) => attempt.question.options.find(option => option.id === (correct ? attempt.correctOptionId : attempt.selectedOptionId))?.text ?? "—";

function StarGoal({ summary }: { summary: StudioStars }) {
  return <div className="studio-star-goal">
    <div className="engagement-row"><strong><Star size={17} aria-hidden="true" /> {summary.points} points</strong><span>{summary.stars} {summary.stars === 1 ? "SmoothStar" : "SmoothStars"} earned</span></div>
    <progress aria-label={`Progress toward SmoothStar ${summary.stars + 1}`} max={STAR_POINTS} value={summary.progress} />
    <small>{summary.remaining} points to SmoothStar {summary.stars + 1} · Goal: {summary.goal} total points</small>
  </div>;
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
  const [tier, setTier] = useState<QuizTier>("easy");
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
    if (result.quizVersion !== 2 || !Array.isArray(result.quiz)) throw new Error("Daily Quiz is updating. Please refresh in a moment.");
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
  const current = state?.quiz.find(item => item.question.tier === tier);
  useEffect(() => { setOption(""); setCelebration(""); if (popupRef.current) popupRef.current.scrollTop = 0; }, [current?.question.id]);
  useEffect(() => { if (!homeActive) setPanel(null); }, [homeActive]);
  useEffect(() => {
    if (!state || panel || progressOpen || busy || error || document.querySelector('[role="dialog"][data-state="open"]')) return;
    const kind = nextEngagementPrompt(state, homeActive) as "mood" | "question" | null;
    if (!kind) return;
    const key = kind === "mood" ? `mood:${state.nextMoodAt}` : `question:${state.day}`;
    if (shown.current.has(key)) return;
    shown.current.add(key); setPanel(kind);
    if (kind === "question") {
      setTier(state.quiz.find(item => !item.attempt)!.question.tier);
      // One automatic quiz popup per studio day; all three tiers stay on Home.
      void save("/engagement/dismiss", { kind, day: state.day }, () => {});
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
    void save("/engagement/dismiss", { kind: panel, day: state.day }, () => { setNotice(""); setPanel(null); });
  }
  function submitAnswer() {
    if (!state || !current || !option || current.attempt) return;
    const previousStars = state.summary.stars, submittedId = current.question.id;
    void save("/engagement/answer", { day: state.day, tier, questionId: submittedId, optionId: option }, result => {
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
      setTier(state.quiz.find(item => !item.attempt)?.question.tier ?? "easy");
      if (state.questionDue) void save("/engagement/dismiss", { kind, day: state.day }, () => {});
    }
  }
  const latestMood = moodFor(state?.lastMood?.mood);
  const remaining = state?.quiz.filter(item => !item.attempt) ?? [];
  const context: EngagementContextValue = { state, busy, error, notice, homeActive, panel, openPanel,
    openProgress: () => { setPanel(null); setProgressOpen(true); }, refresh: () => void load() };
  return <EngagementContext.Provider value={enabled ? context : null}>
    {children}
    <Dialog open={Boolean(enabled && homeActive && state && panel)} onOpenChange={open => { if (!open) dismiss(); }}>
      <DialogContent ref={popupRef} className="engagement-popup" showCloseButton={false}>
        <div className="engagement-popup-heading"><DialogTitle>{panel === "mood" ? "Temp Check" : "Daily Quiz"}</DialogTitle><button type="button" className="engagement-close" aria-label={panel === "mood" ? "Dismiss Temp Check" : "Dismiss Daily Quiz"} disabled={busy} onClick={dismiss}><X size={19} /></button></div>
        <DialogDescription className={panel === "mood" ? "engagement-muted" : "sr-only"}>{panel === "mood" ? state?.moodDue ? "How are you feeling?" : "You're checked in for now." : "Three questions each day: Easy, Medium, and Very Hard. Choose a difficulty."}</DialogDescription>
        {state && (panel === "mood" ? <>
          {state.moodDue ? <div className="temp-check-moods">{MOODS.map(mood => <button type="button" key={mood.id} disabled={busy} onClick={() => recordMood(mood.id)} aria-label={`I'm feeling ${mood.label.toLowerCase()}`}><span aria-hidden="true">{mood.emoji}</span><strong>{mood.label}</strong></button>)}</div> : <div className="temp-check-saved">{latestMood ? <><span aria-hidden="true">{latestMood.emoji}</span><strong>{latestMood.label}</strong><small>{clock(state.lastMood!.createdAt)} Eastern</small></> : <strong>You skipped this check-in.</strong>}<p>Next Temp Check: {clock(state.nextMoodAt)} Eastern</p></div>}
          <p className="engagement-privacy">Only you and Smooth can see your check-ins.</p>
          <Button variant="outline" disabled={busy} onClick={dismiss}>{state.moodDue ? "Skip for now" : "Done"}</Button>
        </> : current && <>
          <div className="quiz-tiers" role="group" aria-label="Question difficulty">{state.quiz.map(item => <button type="button" key={item.question.tier} className={tier === item.question.tier ? "selected" : ""} aria-pressed={tier === item.question.tier} disabled={busy} onClick={() => setTier(item.question.tier)}><strong>{tierLabel(item.question.tier)}</strong><span>{item.attempt ? <>{item.attempt.correct ? <Check size={12} /> : <X size={12} />} +{item.attempt.points} pts</> : `${item.question.points} pts`}</span></button>)}</div>
          <div className="engagement-row creative-question-meta"><span>{current.question.category}</span><span>{state.quiz.length - remaining.length}/3 answered · {dayLabel(state.day)}</span></div>
          <h3 className="creative-question-title">{current.question.prompt}</h3>
          {current.attempt ? <>
            <AnswerResult key={current.question.id} attempt={current.attempt} celebrate={celebration === current.question.id} />
            {remaining.length ? <div className="engagement-row"><Button variant="outline" disabled={busy} onClick={dismiss}>Done for now</Button><Button onClick={() => setTier(remaining[0].question.tier)}>Next question<ChevronRight size={15} /></Button></div> : <><p className="engagement-muted quiz-tomorrow">Come back tomorrow for a new question.</p><Button onClick={dismiss}>Done</Button></>}
          </> : <form onSubmit={event => { event.preventDefault(); submitAnswer(); }}>
            <fieldset className="creative-choices" disabled={busy}><legend className="sr-only">Choose one answer</legend>{current.question.options.map(choice => <label key={choice.id} className={option === choice.id ? "selected" : ""}><input type="radio" name="daily-quiz-answer" value={choice.id} checked={option === choice.id} onChange={() => setOption(choice.id)} /><span>{choice.text}</span></label>)}</fieldset>
            <p className="engagement-privacy">One attempt per difficulty. You and Smooth can review your results.</p>
            <div className="engagement-row"><Button type="button" variant="outline" onClick={dismiss} disabled={busy}>Later</Button><Button type="submit" disabled={!option || busy}>{busy ? "Saving…" : "Submit answer"}<ChevronRight size={15} /></Button></div>
          </form>}
        </>)}
        {error && <p className="engagement-error" role="alert">{error} <button disabled={busy} type="button" onClick={() => void load()}>Refresh</button></p>}
      </DialogContent>
    </Dialog>
    <Dialog open={enabled && progressOpen} onOpenChange={setProgressOpen}><DialogContent className="schedule-modal studio-stars-dialog"><DialogHeader><DialogTitle>My SmoothStars</DialogTitle><DialogDescription>Easy: 5 points. Medium: 10. Very Hard: 15. Every 100 points earns a SmoothStar sticker.</DialogDescription></DialogHeader>
      {state && <><div className="studio-sticker-wall" aria-label={`${state.summary.stars} SmoothStars earned`}>{Array.from({ length: Math.min(10, Math.max(1, state.summary.stars)) }, (_, i) => <span className={`studio-star-sticker${state.summary.stars ? " earned" : ""}`} key={i}><Star size={40} aria-hidden="true" /></span>)}{state.summary.stars > 10 && <strong>+{state.summary.stars - 10} more</strong>}</div><StarGoal summary={state.summary} /><p className="engagement-muted">{state.summary.correct} correct · {state.summary.incorrect} incorrect · {state.summary.answered} answered</p><h3 className="creative-history-title">Recent answers</h3><AttemptHistory attempts={state.history} /></>}
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
      <button type="button" disabled={!state || busy} onClick={() => openPanel("question")} aria-expanded={panel === "question"}><Sparkles size={16} /><span>Daily Quiz</span>{state && <small>{state.quiz.filter(item => item.attempt).length}/3</small>}</button>
    </div>
    {notice && <p className="engagement-feedback" role="status">{notice}</p>}
    {error && !panel && <p className="engagement-error" role="alert">{error} <button type="button" disabled={busy} onClick={refresh}>Refresh</button></p>}
  </section>;
}

export function SmoothStarSidebar() {
  const engagement = useContext(EngagementContext), { setOpenMobile } = useSidebar();
  if (!engagement) return null;
  const { state, openProgress } = engagement;
  return <button type="button" className="smoothstar-sidebar" disabled={!state} onClick={() => { setOpenMobile(false); openProgress(); }} aria-label={state ? `SmoothStars: ${state.summary.points} points, ${state.summary.stars} earned. View progress.` : "Loading SmoothStars"}>
    <span className="engagement-row"><strong><Star size={16} aria-hidden="true" /> SmoothStars</strong><span>{state ? `${state.summary.points} pts` : "…"}</span></span>
    <progress aria-label="Progress toward your next SmoothStar" max={STAR_POINTS} value={state?.summary.progress ?? 0} />
    <small>{state ? `${state.summary.stars} earned · ${state.summary.remaining} pts to next` : "Loading progress…"}<ChevronRight size={13} /></small>
  </button>;
}

export function TeamEngagementReview({ token }: { token: string }) {
  const [state, setState] = useState<TeamEngagement | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current; setBusy(true);
    try { const result = await teamRequest<TeamEngagement>(token, "/engagement/team"); if (result.quizVersion !== 2) throw new Error("Quiz update pending"); if (request === sequence.current) { setState(result); setError(""); } }
    catch { if (request === sequence.current) setError("Team check-ins couldn't load. Try refreshing."); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const member = state?.members.find(person => person.userId === selected);
  return <section className="panel team-engagement-review">
    <div className="panel-heading"><div><h2><Smile size={20} /> Temp Check & SmoothStars</h2><p>Employee check-ins and Daily Quiz results. Visible to you; employees see only their own.</p></div><Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />{busy ? "Loading…" : "Refresh"}</Button></div>
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
    <Dialog open={Boolean(member)} onOpenChange={open => { if (!open) setSelected(""); }}><DialogContent className="schedule-modal studio-stars-dialog"><DialogHeader><DialogTitle>{member?.name} · Check-ins & SmoothStars</DialogTitle><DialogDescription>Self-reported moods and recorded daily answers. All dates are Eastern.</DialogDescription></DialogHeader>
      {member && <><StarGoal summary={member.summary} /><p className="engagement-muted">{member.summary.correct} correct · {member.summary.incorrect} incorrect · {member.summary.answered} answered</p><h3 className="creative-history-title">Recent Temp Checks</h3><div className="team-mood-history">{member.moods.length ? member.moods.map(checkin => { const mood = moodFor(checkin.mood); return <div key={checkin.id}><strong><span aria-hidden="true">{mood?.emoji}</span> {mood?.label}</strong><span>{clock(checkin.createdAt)}</span></div>; }) : <p className="engagement-muted">No check-ins recorded yet.</p>}</div><h3 className="creative-history-title">Recent quiz answers</h3><AttemptHistory attempts={member.history} /></>}
    </DialogContent></Dialog>
  </section>;
}
