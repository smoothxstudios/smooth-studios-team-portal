"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Check, ChevronRight, RefreshCw, Smile, Sparkles, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { teamRequest } from "@/lib/team-api";
import { MOODS, nextEngagementPrompt, STAR_POINTS } from "@/lib/team-engagement.mjs";
import type { CreativeAttempt, EmployeeEngagement, StudioStars, TeamEngagement } from "@/lib/team-engagement-types";

const clock = (value: string | number) => new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
const dayLabel = (day: string) => new Intl.DateTimeFormat("en-US", { timeZone: "UTC", month: "short", day: "numeric" }).format(new Date(`${day}T12:00:00Z`));
const moodFor = (id?: string) => MOODS.find(mood => mood.id === id);
const answerText = (attempt: CreativeAttempt, correct = false) => attempt.question.options.find(option => option.id === (correct ? attempt.correctOptionId : attempt.selectedOptionId))?.text ?? "—";

function StarGoal({ summary }: { summary: StudioStars }) {
  return <div className="studio-star-goal">
    <div className="engagement-row"><strong><Star size={17} aria-hidden="true" /> {summary.points} points</strong><span>{summary.stars} {summary.stars === 1 ? "star" : "stars"} earned</span></div>
    <progress aria-label={`Progress toward star ${summary.stars + 1}`} max={STAR_POINTS} value={summary.progress} />
    <small>{summary.remaining} points to star {summary.stars + 1} · Goal: {summary.goal} total points</small>
  </div>;
}

function AnswerResult({ attempt }: { attempt: CreativeAttempt }) {
  return <div className={`creative-result ${attempt.correct ? "is-correct" : "is-incorrect"}`} role="status">
    <strong>{attempt.correct ? `Correct! +${attempt.points} points` : "Not quite · 0 points"}</strong>
    {!attempt.correct && <p>Your answer: {answerText(attempt)}</p>}
    <p><b>Answer:</b> {answerText(attempt, true)}</p>
    <p>{attempt.explanation}</p>
    <a href={attempt.source.url} target="_blank" rel="noopener noreferrer">{attempt.source.label} ↗</a>
  </div>;
}

function AttemptHistory({ attempts }: { attempts: CreativeAttempt[] }) {
  return <div className="creative-history">{attempts.length ? attempts.map(attempt => <details key={attempt.day}>
    <summary><span>{dayLabel(attempt.day)} · {attempt.question.category}</span><strong className={attempt.correct ? "creative-correct" : ""}>{attempt.correct ? "+10 · Correct" : "0 · Incorrect"}</strong><p>{attempt.question.prompt}</p></summary>
    <AnswerResult attempt={attempt} />
  </details>) : <p className="engagement-muted">Your answered questions will appear here.</p>}</div>;
}

export function EmployeeEngagementBar({ token }: { token: string }) {
  const [state, setState] = useState<EmployeeEngagement | null>(null);
  const [panel, setPanel] = useState<"mood" | "question" | null>(null);
  const [progressOpen, setProgressOpen] = useState(false);
  const [option, setOption] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const requestSequence = useRef(0), busyRef = useRef(false), shown = useRef(new Set<string>());
  const moodRequestId = useRef("");
  const mounted = useRef(false);
  const load = useCallback(async () => {
    if (busyRef.current) return;
    const sequence = ++requestSequence.current;
    try {
      const result = await teamRequest<EmployeeEngagement>(token, "/engagement");
      if (mounted.current && sequence === requestSequence.current) { setState(result); setError(""); }
    } catch { if (mounted.current && sequence === requestSequence.current) setError("Check-ins couldn't load. Your schedule is still available."); }
  }, [token]);

  useEffect(() => {
    mounted.current = true; void load();
    const refresh = () => { if (document.visibilityState === "visible") void load(); };
    const timer = window.setInterval(refresh, 60_000);
    document.addEventListener("visibilitychange", refresh); window.addEventListener("focus", refresh);
    return () => { mounted.current = false; requestSequence.current++; window.clearInterval(timer); document.removeEventListener("visibilitychange", refresh); window.removeEventListener("focus", refresh); };
  }, [load]);
  useEffect(() => { setOption(""); }, [state?.question.id]);
  useEffect(() => {
    if (!state || panel || progressOpen || busy || error) return;
    const kind = nextEngagementPrompt(state) as "mood" | "question" | null;
    if (!kind) return;
    const key = kind === "mood" ? `mood:${state.nextMoodAt}` : `question:${state.day}`;
    if (shown.current.has(key)) return;
    shown.current.add(key); setPanel(kind);
    // Remember the daily popup across refreshes and devices. The question stays
    // available from the bar until answered, even after its automatic appearance.
    if (kind === "question") void save("/engagement/dismiss", { kind, day: state.day }, () => {});
  }, [state, panel, progressOpen, busy, error]);

  async function save(path: string, data: unknown, onSuccess: (result: EmployeeEngagement) => void) {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError("");
    const sequence = ++requestSequence.current;
    try {
      const result = await teamRequest<EmployeeEngagement>(token, path, data);
      if (mounted.current && sequence === requestSequence.current) { setState(result); onSuccess(result); }
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : "This wasn't saved. Please try again."); }
    finally { busyRef.current = false; if (mounted.current) setBusy(false); }
  }
  function recordMood(mood: string) {
    if (!moodRequestId.current) moodRequestId.current = crypto.randomUUID();
    void save("/engagement/mood", { mood, requestId: moodRequestId.current }, () => {
      moodRequestId.current = ""; setNotice("Temp Check saved. Thanks for checking in."); setPanel(null);
    });
  }
  function dismiss() {
    if (!state || !panel || busy) return;
    if ((panel === "question" && state.attempt) || (panel === "mood" && !state.moodDue)) { setPanel(null); return; }
    void save("/engagement/dismiss", { kind: panel, day: state.day }, () => { setNotice(""); setPanel(null); });
  }
  function submitAnswer() {
    if (!state || !option) return;
    const previousStars = state.summary.stars;
    void save("/engagement/answer", { day: state.day, questionId: state.question.id, optionId: option }, result => {
      setNotice(result.summary.stars > previousStars ? `You earned studio star ${result.summary.stars}!` : "Today's answer is saved.");
    });
  }
  const latestMood = moodFor(state?.lastMood?.mood);
  return <section className="engagement-widget" aria-label="Temp Check and studio stars">
    <div className="engagement-bar">
      <div className="engagement-links">
        <button type="button" disabled={!state || busy} onClick={() => { setPanel("mood"); setError(""); }} aria-expanded={panel === "mood"}><Smile size={17} /><span>Temp Check</span>{state?.moodDue && <i className="engagement-dot" aria-label="Due now" />}</button>
        <button type="button" disabled={!state || busy} onClick={() => { setPanel("question"); setError(""); }} aria-expanded={panel === "question"}><Sparkles size={16} /><span>Daily creative</span>{state?.attempt && <Check size={14} aria-label="Answered" />}</button>
      </div>
      <button type="button" className="engagement-points" disabled={!state} onClick={() => setProgressOpen(true)} aria-label={`Studio stars: ${state?.summary.points ?? 0} points, ${state?.summary.stars ?? 0} stars. View progress.`}><Star size={17} /><strong>{state?.summary.points ?? 0} pts</strong><span>· {state?.summary.stars ?? 0} stars</span><ChevronRight size={15} /></button>
    </div>
    {notice && <p className="engagement-feedback" role="status">{notice}</p>}
    {error && <p className="engagement-error" role="alert">{error} <button type="button" disabled={busy} onClick={() => void load()}>Refresh</button></p>}
    {state && panel && <aside className="engagement-popup" role="region" aria-labelledby="engagement-prompt-title" onKeyDown={event => { if (event.key === "Escape") { event.stopPropagation(); dismiss(); } }}>
      <div className="engagement-row engagement-popup-heading"><p className="engagement-eyebrow">{panel === "mood" ? "A moment for you" : "Build your craft"}</p><button type="button" className="engagement-close" aria-label={panel === "mood" ? "Dismiss Temp Check" : "Dismiss daily creative question"} disabled={busy} onClick={dismiss}><X size={19} /></button></div>
      <h2 id="engagement-prompt-title">{panel === "mood" ? "Temp Check" : "Daily creative"}</h2>
      {panel === "mood" ? <>
        <p className="engagement-muted">{state.moodDue ? "How are you feeling right now?" : "You're checked in for now."}</p>
        {state.moodDue ? <div className="temp-check-moods">{MOODS.map(mood => <button type="button" key={mood.id} disabled={busy} onClick={() => recordMood(mood.id)} aria-label={`I'm feeling ${mood.label.toLowerCase()}`}><span aria-hidden="true">{mood.emoji}</span><strong>{mood.label}</strong></button>)}</div> : <div className="temp-check-saved">{latestMood ? <><span aria-hidden="true">{latestMood.emoji}</span><strong>{latestMood.label}</strong><small>{clock(state.lastMood!.createdAt)} Eastern</small></> : <strong>You skipped this check-in.</strong>}<p>Next Temp Check: {clock(state.nextMoodAt)} Eastern</p></div>}
        <p className="engagement-privacy">Only you and Smooth can see your check-ins. Every feeling is okay; moods don't affect your points.</p>
        <Button variant="outline" disabled={busy} onClick={dismiss}>{state.moodDue ? "Skip for now" : "Done"}</Button>
        {state.moodDue && <small className="engagement-muted engagement-caption">Next prompt in 3 hours while you're using the dashboard.</small>}
      </> : <>
        <div className="engagement-row creative-question-meta"><span>{state.question.category}</span><span>{dayLabel(state.day)} · +10 points</span></div>
        <h3 className="creative-question-title">{state.question.prompt}</h3>
        {state.attempt ? <><AnswerResult attempt={state.attempt} /><StarGoal summary={state.summary} /><p className="engagement-muted">A new question arrives tomorrow, Eastern time.</p><Button onClick={dismiss}>Done</Button></> : <form onSubmit={event => { event.preventDefault(); submitAnswer(); }}>
          <fieldset className="creative-choices" disabled={busy}><legend className="sr-only">Choose one answer</legend>{state.question.options.map(choice => <label key={choice.id} className={option === choice.id ? "selected" : ""}><input type="radio" name="daily-creative-answer" value={choice.id} checked={option === choice.id} onChange={() => setOption(choice.id)} /><span>{choice.text}</span></label>)}</fieldset>
          <p className="engagement-privacy">One scored answer per day. Correct answers earn 10 points; every 100 points earns a star. You and Smooth can review your results.</p>
          <div className="engagement-row"><Button type="button" variant="outline" onClick={dismiss} disabled={busy}>Later today</Button><Button type="submit" disabled={!option || busy}>{busy ? "Saving…" : "Submit answer"}<ChevronRight size={16} /></Button></div>
        </form>}
      </>}
      {error && <p className="engagement-error" role="alert">{error} <button disabled={busy} type="button" onClick={() => void load()}>Refresh</button></p>}
    </aside>}
    <Dialog open={progressOpen} onOpenChange={setProgressOpen}><DialogContent className="schedule-modal studio-stars-dialog"><DialogHeader><DialogTitle>My studio stars</DialogTitle><DialogDescription>10 points per correct daily answer. A star sticker for every 100 points. Your points keep accumulating.</DialogDescription></DialogHeader>
      {state && <><div className="studio-sticker-wall" aria-label={`${state.summary.stars} star stickers earned`}>{Array.from({ length: Math.min(10, Math.max(1, state.summary.stars)) }, (_, i) => <span className={`studio-star-sticker${state.summary.stars ? " earned" : ""}`} key={i}><Star size={40} aria-hidden="true" /></span>)}{state.summary.stars > 10 && <strong>+{state.summary.stars - 10} more</strong>}</div><StarGoal summary={state.summary} /><p className="engagement-muted">{state.summary.correct} correct · {state.summary.incorrect} incorrect · {state.summary.answered} answered</p><h3 className="creative-history-title">Recent answers</h3><AttemptHistory attempts={state.history} /></>}
    </DialogContent></Dialog>
  </section>;
}

export function TeamEngagementReview({ token }: { token: string }) {
  const [state, setState] = useState<TeamEngagement | null>(null);
  const [selected, setSelected] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const sequence = useRef(0);
  const load = useCallback(async () => {
    const request = ++sequence.current; setBusy(true);
    try { const result = await teamRequest<TeamEngagement>(token, "/engagement/team"); if (request === sequence.current) { setState(result); setError(""); } }
    catch { if (request === sequence.current) setError("Team check-ins couldn't load. Try refreshing."); }
    finally { if (request === sequence.current) setBusy(false); }
  }, [token]);
  useEffect(() => { void load(); return () => { sequence.current++; }; }, [load]);
  const member = state?.members.find(person => person.userId === selected);
  return <section className="panel team-engagement-review">
    <div className="panel-heading"><div><h2><Smile size={20} /> Temp Check & studio stars</h2><p>Employee check-ins and daily creative results. Visible to you; employees see only their own.</p></div><Button variant="outline" disabled={busy} onClick={() => void load()}><RefreshCw size={15} />{busy ? "Loading…" : "Refresh"}</Button></div>
    {error && <p className="engagement-error" role="alert">{error}</p>}
    {state && <><p className="engagement-muted engagement-review-note">10 points per correct answer · 100 points per star · Missed questions and moods never subtract points.</p><div className="team-checkin-grid">{state.members.map(person => {
      const mood = moodFor(person.moods[0]?.mood);
      return <button type="button" key={person.userId} className="team-checkin-card" onClick={() => setSelected(person.userId)}>
        <span className="engagement-row"><strong className="schedule-person"><i style={{ background: person.color }} />{person.name}</strong><ChevronRight size={16} /></span>
        <span className="team-checkin-mood">{mood ? <><span aria-hidden="true">{mood.emoji}</span>{mood.label}</> : "No check-in yet"}</span>
        <small>{person.moods[0] ? `${clock(person.moods[0].createdAt)} Eastern` : "Employees can skip a check-in."}</small>
        <span className="team-checkin-score"><Star size={16} />{person.summary.points} points · {person.summary.stars} stars</span>
        <small>Today's question: {person.today ? person.today.correct ? "Correct · +10 points" : "Incorrect · 0 points" : "Not answered"}</small>
      </button>;
    })}</div></>}
    <Dialog open={Boolean(member)} onOpenChange={open => { if (!open) setSelected(""); }}><DialogContent className="schedule-modal studio-stars-dialog"><DialogHeader><DialogTitle>{member?.name} · Check-ins & stars</DialogTitle><DialogDescription>Self-reported moods and recorded daily answers. All dates are Eastern.</DialogDescription></DialogHeader>
      {member && <><StarGoal summary={member.summary} /><p className="engagement-muted">{member.summary.correct} correct · {member.summary.incorrect} incorrect · {member.summary.answered} answered</p><h3 className="creative-history-title">Recent Temp Checks</h3><div className="team-mood-history">{member.moods.length ? member.moods.map(checkin => { const mood = moodFor(checkin.mood); return <div key={checkin.id}><strong><span aria-hidden="true">{mood?.emoji}</span> {mood?.label}</strong><span>{clock(checkin.createdAt)}</span></div>; }) : <p className="engagement-muted">No check-ins recorded yet.</p>}</div><h3 className="creative-history-title">Recent creative answers</h3><AttemptHistory attempts={member.history} /></>}
    </DialogContent></Dialog>
  </section>;
}
