import assert from 'node:assert/strict';
import test from 'node:test';
import { guidelineQuizBank } from '../team-api/guideline-quiz.mjs';
import { GUIDELINE_QUESTIONS } from '../lib/studio-guideline-questions.mjs';
import { employeeQuestionCandidates, publicQuestion, quizTopic } from '../team-api/creative-questions.mjs';
const template=GUIDELINE_QUESTIONS.find(q=>q.id==='arrival-time');
const approved={id:'question-arrival-time', title:template.title, category:template.category, body:template.choices[1].body};
test('only saved guidelines supply answers, with private details excluded',()=>{
 assert.deepEqual(guidelineQuizBank(undefined),[]);
 const bank=guidelineQuizBank({entries:[approved,{...approved,id:'private',body:'Door code 123456'},{...approved,id:'hidden',visibility:'owner'}]});
 assert.equal(bank.length,1);assert.equal(bank[0].correct,approved.body);assert.equal(bank[0].prompt,template.prompt);
 assert.equal(bank[0].choices.length,3);
 const question=employeeQuestionCandidates('2026-11-10','easy','jordyn',bank)[0];
 assert.match(quizTopic(question.category),/^Studio guidelines/);assert.equal(publicQuestion(question).correctOptionId,undefined);
 assert.equal(publicQuestion(question).explanation,undefined);
 assert.equal(question.options.find(o=>o.id===question.correctOptionId).text,approved.body);
});
test('unreviewed custom and unfinished guidelines cannot produce misleading quiz answers',()=>{
 const entries=['A','B','C'].map((title,i)=>({id:title,title,body:`Approved synthetic instruction ${i}.`}));
 assert.deepEqual(guidelineQuizBank({entries}),[]);
 for(const body of ['Answer later.', 'TBD', 'Not provided', 'Pending']) assert.deepEqual(guidelineQuizBank({entries:[{...approved,body}]}),[]);
});
test('the next question favors a different topic and avoids recent prompts',()=>{
 for(const tier of ['easy','medium','hard']){
  const first=employeeQuestionCandidates('2026-11-10',tier,'jordyn')[0];
  const second=employeeQuestionCandidates('2026-11-10',tier,'jordyn',[],[first])[0];
  assert.notEqual(quizTopic(second.category),quizTopic(first.category));assert.notEqual(second.prompt,first.prompt);
  assert.ok(employeeQuestionCandidates('2026-11-10',tier,'jordyn').some(q=>q.category==='File organization'));
 }
});

test('published guidelines power every tier and rotate studio categories',()=>{
 const entries=GUIDELINE_QUESTIONS.slice(0,25).map(q=>({id:`question-${q.id}`,title:q.title,category:q.category,body:q.choices[0].body}));
 const bank=guidelineQuizBank({entries});assert.ok(bank.length>15);
 for(const tier of ['easy','medium','hard']){
  const candidates=employeeQuestionCandidates('2026-11-10',tier,'jordyn',bank);
  assert.equal(candidates.length,bank.length);
  assert.ok(candidates.every(q=>q.id.includes(':guideline-v2-')&&q.category.startsWith('Studio guidelines')));
  const next=employeeQuestionCandidates('2026-11-10',tier,'jordyn',bank,[candidates[0]])[0];
  assert.notEqual(quizTopic(next.category),quizTopic(candidates[0].category));
  assert.notEqual(next.prompt,candidates[0].prompt);
 }
});
