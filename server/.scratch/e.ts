import { evaluate } from '../src/evaluation/engine.js';
import type { EvaluableQuestion } from '../src/evaluation/types.js';

const q: EvaluableQuestion = {
  id: 1, qid: 'PY-LOOP-0001', languageSlug: 'python', runtime: 'python',
  difficulty: 'Easy', questionType: 'COMPLETE_LOOP', evaluationType: 'OUTPUT',
  title: 'Print every number', statement: 'Print every number in the list using a for loop.',
  starterCode: 'numbers = [1, 2, 3, 4, 5]\n\n{{STUDENT_CODE}}\n\nprint("Done")',
  indentFragment: true,
  requiredConstructs: ['FOR_LOOP'], forbiddenConstructs: [], requiredKeywords: [], forbiddenKeywords: [],
  maxCodeLength: 500, timeLimitMs: 4000, memoryLimitMb: 128, maxScore: 100,
  testCases: [{ visibility: 'public', matcher: 'trimmed', weight: 1, expectedOutput: '1\n2\n3\n4\n5\nDone' }],
  acceptedSolutions: ['for n in numbers:\n    print(n)'], config: {},
};

const cases: Array<[string, string]> = [
  ['correct for loop', 'for n in numbers:\n    print(n)'],
  ['right output wrong construct', 'print(*numbers, sep="\\n")'],
  ['syntax error', 'for n in numbers\n    print(n)'],
  ['wrong output', 'for n in numbers:\n    print(n * 2)'],
  ['infinite loop', 'while True:\n    pass'],
  ['restricted', 'import os\nos.system("ls")'],
  ['empty', '   '],
];
for (const [label, frag] of cases) {
  const r = await evaluate({ question: q, fragment: frag, mode: 'submit' });
  console.log(`${label.padEnd(28)} -> ${r.verdict.padEnd(16)} score=${String(r.score).padStart(3)}  ${r.feedback}`);
}

// indentation inside a block
const q2: EvaluableQuestion = { ...q, id: 2,
  starterCode: 'numbers = [1, 2, 3]\nif len(numbers) > 0:\n    {{STUDENT_CODE}}',
  requiredConstructs: ['FOR_LOOP'],
  testCases: [{ visibility: 'public', matcher: 'trimmed', weight: 1, expectedOutput: '1\n2\n3' }] };
const r2 = await evaluate({ question: q2, fragment: 'for n in numbers:\n    print(n)', mode: 'submit' });
console.log('indented block             ->', r2.verdict, JSON.stringify(r2.generatedCode));
