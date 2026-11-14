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
