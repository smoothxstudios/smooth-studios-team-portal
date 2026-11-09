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
 assert.equal(quizTopic(question.category),'Studio guidelines');assert.equal(publicQuestion(question).correctOptionId,undefined);
 assert.equal(publicQuestion(question).explanation,undefined);
 assert.equal(question.options.find(o=>o.id===question.correctOptionId).text,approved.body);
});
test('custom guidelines use published instructions and exclude removed entries',()=>{
 const entries=['A','B','C'].map((title,i)=>({id:title,title,body:`Approved synthetic instruction ${i}.`}));
 const bank=guidelineQuizBank({entries});assert.equal(bank.length,3);
 for(const q of bank)assert.ok(entries.some(e=>e.body===q.correct));
 assert.equal(guidelineQuizBank({entries:entries.slice(1)}).length,0); // Need enough distinct choices.
});
test('the next question favors a different topic and avoids recent prompts',()=>{
 for(const tier of ['easy','medium','hard']){
  const first=employeeQuestionCandidates('2026-11-10',tier,'jordyn')[0];
  const second=employeeQuestionCandidates('2026-11-10',tier,'jordyn',[],[first])[0];
  assert.notEqual(quizTopic(second.category),quizTopic(first.category));assert.notEqual(second.prompt,first.prompt);
  assert.ok(employeeQuestionCandidates('2026-11-10',tier,'jordyn').some(q=>q.category==='File organization'));
 }
});
