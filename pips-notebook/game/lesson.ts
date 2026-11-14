export type Strategy = 'Example' | 'Analogy' | 'Socratic Question' | 'Counterexample';
export const cards: Record<Strategy, { cost: number; icon: string; detail: string }> = {
    Example: { cost: 1, icon: 'example', detail: 'Teach a concrete case. Pip may remember only its shape.' },
    Analogy: { cost: 2, icon: 'analogy', detail: 'Connect ideas quickly. Pip may take the comparison literally.' },
    'Socratic Question': { cost: 2, icon: 'question', detail: 'Build reasoning that holds up in an unfamiliar room.' },
    Counterexample: { cost: 1, icon: 'counter', detail: 'Challenge a false belief that Pip has already recorded.' }
};
export type FileInfo = { name: string; size: number; type: string };
export type Skill = 'basic' | 'reason' | 'transfer';
export type Question = { prompt: string; correct: string; wrong: string; needs: number[]; skill: Skill; weight: number };
export type Concept = { title: string; monster: string; intro: string; misconception: string; questions: Question[] };
export type Lesson = { concepts: Concept[]; boss: Question[] };
export type Note = { strategy: Strategy; words: string; change: string };
export type Entry = { title: string; understanding: number; reasoning: number; belief: string; notes: Note[] };
export type Notebook = Record<number, Entry>;
export type Answer = { question: Question; words: string; correct: boolean; damage: number; cause: string; boss: boolean };
export type LessonPlanner = (files: FileInfo[]) => Lesson | Promise<Lesson>;
export type StudentTeacher = (entry: Entry, concept: Concept, card: Strategy, words: string) => { entry: Entry; dialogue: string };
export type StudentAnswerer = (book: Notebook, question: Question, boss: boolean) => Answer;
function question(prompt: string, correct: string, wrong: string, needs: number[], skill: Skill = 'basic', weight = 10): Question {
    return { prompt, correct, wrong, needs, skill, weight };
}
export const MockLessonPlanner: LessonPlanner = () => ({
    concepts: [
        { title: 'Paths of light', monster: 'Lantern Wisp', intro: 'How does light travel from a lantern to my eyes?', misconception: 'Light can bend around a corner on its own.', questions: [
            question('In clear air, what path does a beam follow?', 'A straight line.', 'It curves toward my eyes.', [0]),
            question('Why can you see a lantern through aligned holes?', 'The holes leave one straight path for the light.', 'The light finds its way through any holes.', [0], 'reason', 12),
            question('What carries light to your eyes in a dark hall?', 'Light travels from a source into my eyes.', 'My eyes send out a search beam.', [0]),
            question('Can you see a candle through a straight, open tube?', 'Yes, if the candle and my eye line up.', 'Only if the tube glows.', [0])
        ] },
        { title: 'Casting shadows', monster: 'Umbral Slime', intro: 'What makes a shadow appear on the library wall?', misconception: 'A shadow always falls to the left.', questions: [
            question('What makes a book cast a shadow?', 'It blocks light from reaching the wall.', 'It sends darkness out of its cover.', [1]),
            question('Why does the shadow switch sides when the lamp moves?', 'The blocked region follows the direction of the light.', 'A shadow always stays on the left.', [1], 'reason', 12),
            question('Where is the shadow of an opaque shield?', 'Behind the shield, away from the lamp.', 'Between the lamp and the shield.', [1]),
            question('Which makes a darker shadow: clear glass or stone?', 'Stone blocks more of the light.', 'Clear glass stores more darkness.', [1])
        ] },
        { title: 'Mirror signals', monster: 'Prism Eye', intro: 'How can I send a beam around a corner with a mirror?', misconception: 'A mirror always sends light straight back to its source.', questions: [
            question('What happens when light reflects?', 'It changes direction at a surface.', 'It stops existing.', [2]),
            question('Why does turning a mirror move the bright spot?', 'The angle of reflection changes with the mirror.', 'The beam always goes back to the source.', [2], 'reason', 12),
            question('Which surface gives a clear reflection?', 'A smooth polished mirror.', 'Rough dark cloth.', [2]),
            question('Does a mirror make its own light?', 'No. It redirects incoming light.', 'Yes. It shines by itself.', [2])
        ] }
    ],
    boss: [
        question('A lamp points away from a moth. Can its direct beam reach her?', 'Only if she lies in the beam’s straight path.', 'Light turns to follow the moth.', [0], 'reason', 12),
        question('A reflected beam reaches the moth from the right. Where do you put a shield?', 'On her right, between her and the reflected beam.', 'On her left, where shadows always go.', [0,1,2], 'transfer', 16),
        question('What does a mirror do to the ray at the corner?', 'It redirects the ray along a new straight path.', 'It consumes the ray.', [2]),
        question('A book blocks the beam before it reaches the mirror. What happens?', 'The moth is in shadow because no beam reaches the mirror.', 'The mirror keeps making light.', [1,2], 'transfer', 14),
        question('Which side of the shield is in shadow?', 'The side away from the incoming light.', 'The side facing the beam.', [1])
    ]
});
export function newEntry(title: string): Entry { return { title, understanding: 0, reasoning: 0, belief: '', notes: [] }; }
export const MockStudent: StudentTeacher = (previous, concept, strategy, words) => {
    const entry = structuredClone(previous);
    let dialogue = '', change = '';
    if (strategy === 'Counterexample') {
        change = entry.belief ? 'Corrected: ' + entry.belief : 'No false belief to correct.';
        dialogue = entry.belief ? 'Oh! That rule breaks here. I’ll cross it out.' : 'Which rule should I challenge? My page is still clear.';
        if (entry.belief) { entry.understanding++; entry.reasoning++; }
        entry.belief = '';
    } else {
        entry.understanding += strategy === 'Example' ? 1 : 2;
        if (strategy === 'Socratic Question') {
            entry.reasoning += 2;
            dialogue = 'Let me work through why that happens. Could I use the same reasoning in another room?';
            change = 'Practiced reasoning.';
        } else {
            if (!entry.reasoning) entry.belief = concept.misconception;
            dialogue = entry.belief ? 'So is this always true? “' + entry.belief + '”' : 'I can fit this case into the rule we worked out!';
            change = entry.belief ? 'Inferred: ' + entry.belief : 'Connected an example to prior reasoning.';
        }
    }
    entry.notes.push({ strategy, words, change });
    return { entry, dialogue };
};
export const MockAnswer: StudentAnswerer = (book, q, boss) => {
    const entries = q.needs.map(i => book[i]);
    const belief = q.skill !== 'basic' && entries.find(e => e?.belief)?.belief;
    const learned = entries.every(e => e && e.understanding > 0 && (q.skill === 'basic' || e.reasoning > 0));
    const correct = learned && !belief;
    return { question: q, words: correct ? q.correct : belief || (entries.some(e => !e?.understanding) ? 'I don’t have a note about that yet.' : q.wrong),
        correct, damage: q.weight, cause: belief || '', boss };
};
