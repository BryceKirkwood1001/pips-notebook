export const QUESTION_QUALITY_RULES = [
  'Learning-material alignment: assess only concepts explicitly taught in the supplied uploaded material. Every required fact, relationship, formula and answer must be supported by the cited passages; do not fill gaps from general knowledge.',
  'Test understanding of a learning objective: explain a mechanism, apply a stated rule, compare supported alternatives, predict an outcome, or solve a representative exercise. Essential definitions are valid, but do not manufacture trivia from incidental wording, diagram labels or decorative numbers.',
  'Ask about the subject, not the presentation. Do not ask which question a slide raises, what the lecturer asks next, what a heading says, or what appears on a particular slide. Rhetorical hooks and agenda questions are not answer keys.',
  'Ignore announcements, due dates, instructor names, greetings, course logistics and unrelated previous-lesson review. Prefer the current lesson objectives; repeated reveal/animation slides are one idea, not new objectives.',
  'Questions must be self-contained: include necessary code, data and assumptions. Do not refer to an unseen diagram, the example, or the above unless the required information is reproduced in the question.',
  'Preserve bounds and assumptions: 100+ is not exactly 100. Use numbers to test a taught relationship, not arbitrary arithmetic on illustration labels. Adapted numbers must be explicitly given in the new question and must not change the underlying taught rule.',
  'Written-answer rubrics specify the required ideas and accept equivalent wording, abbreviations and valid explanations. They must not require copying the source sentence verbatim. A correct answer must not be penalized solely for a different phrasing.',
  'If the excerpts do not support a meaningful, unambiguous question, omit that candidate. Never invent a question merely to fill a requested count.',
].join('\n');

/** The flat question format shared by convertItems, adaptQuestions and generateQuestions. */
export const FLAT_QUESTION_SPEC = [
  'Each question is ONE flat JSON object with a "type" and only the fields that type uses (leave the others out or null):',
  '- mcq: "options": [{ "text", "isCorrect", "misconceptionId" }] with exactly one isCorrect=true. Put the misconception id a student would hold when picking a wrong option (from the lists given), else "" for that option. The correct option has "".',
  '- multi_select: "options" as for mcq, with one or more isCorrect=true.',
  '- true_false: "statement" (the claim), "correctValue" (true or false), "wrongMisconceptionId" (misconception behind the wrong value, else "").',
  '- numeric: "answer" (a number), "toleranceKind" ("abs" or "rel"), "toleranceValue", "unit" (or ""), "wrongAnswers": [{ "value", "misconceptionId" }] for results a student with a given misconception would get.',
  '- short_text: "acceptedAnswers" (all correct short forms), "rubric" (how to judge other answers), "wrongAnswers": [{ "pattern", "misconceptionId" }] where pattern is a short substring a wrong answer would contain.',
  '- ordering: "itemsInCorrectOrder" (the items listed in the CORRECT order; they will be shuffled later), optional "wrongOrders": [{ "itemsInOrder": [...same items, wrong order], "misconceptionId" }].',
  '- free_response: "rubric", "modelAnswer".',
  'Every question also has: "prompt" (the question text; for true_false a lead-in such as "True or false?"), "conceptIds", "keyPointIds" (only ids from the lists given), "finalAnswer" (human-readable final answer), "explanation" (2 to 3 sentences shown after answering), and evidence: "evidenceQuote" (one sentence copied exactly from the material), "evidenceFileId", "evidencePage".',
  'Prompts and options must not give away the answer. Use misconception ids only from the lists given; use "" when none fits.',
].join('\n');
