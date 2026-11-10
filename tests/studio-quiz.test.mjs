import test from 'node:test';
import assert from 'node:assert/strict';
import { fixture } from './helpers/notification-fixture.mjs';
import { GUIDELINE_QUESTIONS } from '../lib/studio-guideline-questions.mjs';
import { GUIDELINE_SCENARIOS } from '../team-api/guideline-scenarios.mjs';
import { guidelineQuizBank, guidelineFingerprint } from '../team-api/guideline-quiz.mjs';
import { QUIZ_INTERVAL_MS } from '../lib/team-engagement.mjs';

const rules=()=>({updatedAt:new Date().toISOString(),entries:GUIDELINE_QUESTIONS.slice(0,40).map(q=>({id:`question-${q.id}`,category:q.category,title:q.title,body:q.choices[0].body}))});
async function setup(t){const f=await fixture();delete f.env.VAPID_JWK;t.after(()=>f.close());return f;}

test('scenario definitions have distinct practical prompts, two alternatives, and no embedded answers',()=>{
 assert.ok(GUIDELINE_SCENARIOS.length>=30);
 assert.equal(new Set(GUIDELINE_SCENARIOS.map(s=>s.entryId)).size,GUIDELINE_SCENARIOS.length);
 assert.equal(new Set(GUIDELINE_SCENARIOS.map(s=>s.prompt)).size,GUIDELINE_SCENARIOS.length);
 for(const scenario of GUIDELINE_SCENARIOS){
  assert.equal(scenario.alternatives.length,2);
  assert.equal(new Set(scenario.alternatives).size,2);
  assert.equal(scenario.correct,undefined);
  assert.match(scenario.fingerprint,/^[a-f0-9]+$/);
  assert.doesNotMatch(scenario.prompt,/Which instruction is saved/);
 }
});
test('a changed custom policy cannot inherit its old scenario or an unrelated rule as a distractor',()=>{
 const scenario=GUIDELINE_SCENARIOS[0];
 const entry={id:scenario.entryId,title:'Updated policy',body:'A newly published synthetic policy that requires review.',category:'Team'};
 assert.notEqual(guidelineFingerprint(entry.body),scenario.fingerprint);
 assert.deepEqual(guidelineQuizBank({entries:[entry,...rules().entries.filter(e=>e.id!==entry.id)]}).filter(q=>q.prompt===scenario.prompt),[]);
});
test('unanswered legacy trivia is replaced once without resetting points, completed answers, or pacing',async t=>{
 const f=await setup(t);
 const old=(await f.call('jordyn')).data;
 assert.ok(!old.currentQuestionId.includes(':guideline-v2-'));
 const synced=await f.call('sync','/sync/quiz-guidelines',rules());assert.equal(synced.status,200);
 const next=(await f.call('jordyn')).data;
 assert.ok(next.currentQuestionId.includes(':guideline-v2-'));
 assert.notEqual(next.currentQuestionId,old.currentQuestionId);
 assert.equal(next.quiz[0].question.tier,old.quiz[0].question.tier);
 assert.equal(next.summary.points,old.summary.points);
 assert.equal(next.answeredToday,0);
 assert.equal((await f.call('jordyn')).data.currentQuestionId,next.currentQuestionId);
 const oldQuestion=old.quiz[0].question;
 assert.equal((await f.call('jordyn','/engagement/answer',{day:old.day,tier:oldQuestion.tier,questionId:oldQuestion.id,optionId:oldQuestion.options[0].id})).status,409);
 const saved=JSON.parse(f.DB.sqlite.prepare('SELECT data FROM team_quiz_offers WHERE user_id=?').get('jordyn').data);
 const answer=await f.call('jordyn','/engagement/answer',{day:next.day,tier:saved.tier,questionId:saved.id,optionId:saved.correctOptionId});
 assert.equal(answer.status,200);
 assert.equal(answer.data.answeredToday,1);
 assert.equal(answer.data.available,false);
 assert.ok(answer.data.nextQuestionAt>Date.now()+QUIZ_INTERVAL_MS-5000);
 const state=(await f.call('jordyn')).data;
 assert.equal(state.answeredToday,1);assert.equal(state.summary.points,answer.data.summary.points);
});
test('concurrent employees and devices reserve different guideline prompts',async t=>{
 const f=await setup(t);
 assert.equal((await f.call('sync','/sync/quiz-guidelines',rules())).status,200);
 const people=['jordyn','rayne','akiva','dacari','sorayia','amia','terrill','carlos','armani'];
 const results=await Promise.all(people.flatMap(person=>[f.call(person),f.call(person)]));
 assert.ok(results.every(r=>r.status===200),JSON.stringify(results.map(r=>r.status)));
 const offers=f.DB.sqlite.prepare('SELECT user_id,data FROM team_quiz_offers').all();
 assert.equal(offers.length,people.length);
 const questions=offers.map(o=>JSON.parse(o.data));
 assert.equal(new Set(questions.map(q=>q.prompt)).size,people.length);
 assert.ok(questions.every(q=>q.id.includes(':guideline-v2-')));
});
