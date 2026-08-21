import { describe, expect, it } from 'vitest';
import { evaluate } from '../src/evaluation/engine.js';
import { assemble, indentFragment, splitTemplate, TemplateError } from '../src/evaluation/assembler.js';
import { question } from './helpers.js';

/**
 * §32 — automated coverage for the evaluation architecture:
 * correct fragments, syntax errors, correct-output-wrong-construct, hidden
 * tests, runtime errors, infinite loops, restricted keywords and multiple
 * valid solutions.
 */

describe('template assembly', () => {
  it('splits a template on the student marker', () => {
    const { prefix, suffix, indent } = splitTemplate('a = 1\n{{STUDENT_CODE}}\nprint(a)');
    expect(prefix).toBe('a = 1\n');
    expect(suffix).toBe('\nprint(a)');
    expect(indent).toBe('');
  });

  it('rejects a template without the marker', () => {
    expect(() => splitTemplate('print(1)')).toThrow(TemplateError);
  });

  it('re-indents a multi-line fragment to the marker column', () => {
    expect(indentFragment('for n in xs:\n    print(n)', '    '))
      .toBe('for n in xs:\n        print(n)');
  });

  it('places the fragment inside an indented block', () => {
    const assembled = assemble(
      { starterCode: 'if True:\n    {{STUDENT_CODE}}', hiddenPrefix: null, hiddenSuffix: null, indentFragment: true },
      'for n in [1]:\n    print(n)',
    );
    expect(assembled.program).toBe('if True:\n    for n in [1]:\n        print(n)');
  });

  it('wraps the visible template in hidden prefix/suffix', () => {
    const assembled = assemble(
      { starterCode: '{{STUDENT_CODE}}', hiddenPrefix: 'secret = 1', hiddenSuffix: 'print(secret)', indentFragment: true },
      'x = 2',
    );
    expect(assembled.program).toBe('secret = 1\nx = 2\nprint(secret)');
    expect(assembled.fragmentStartLine).toBe(2);
  });

  it('substitutes per-test setup code', () => {
    const assembled = assemble(
      { starterCode: '{{SETUP_CODE}}\n{{STUDENT_CODE}}', hiddenPrefix: null, hiddenSuffix: null, indentFragment: true },
      'print(n)',
      { visibility: 'hidden', matcher: 'trimmed', weight: 1, setupCode: 'n = 7' },
    );
    expect(assembled.program).toBe('n = 7\nprint(n)');
  });
});

describe('python evaluation', () => {
  it('accepts a correct fragment', async () => {
    const result = await evaluate({
      question: question({ requiredConstructs: ['FOR_LOOP'] }),
      fragment: 'for n in numbers:\n    print(n)',
      mode: 'submit',
    });
    expect(result.verdict).toBe('CORRECT');
    expect(result.isCorrect).toBe(true);
    expect(result.score).toBe(100);
  });

  it('rejects correct output produced with the wrong construct', async () => {
    const result = await evaluate({
      question: question({ requiredConstructs: ['FOR_LOOP'] }),
      fragment: 'print(*numbers, sep="\\n")',
      mode: 'submit',
    });
    expect(result.verdict).toBe('WRONG_CONSTRUCT');
    expect(result.score).toBe(0);
    expect(result.feedback).toMatch(/Output is correct, but/i);
    expect(result.missingConstructs).toContain('FOR_LOOP');
  });

  it('reports a syntax error with the line and message', async () => {
    const result = await evaluate({
      question: question(),
      fragment: 'for n in numbers\n    print(n)',
      mode: 'submit',
    });
    expect(result.verdict).toBe('SYNTAX_ERROR');
    expect(result.errorType).toBe('syntax');
    expect(result.errorMessage).toMatch(/expected ':'/);
  });

  it('reports a runtime error', async () => {
    const result = await evaluate({
      question: question({ testCases: [{ visibility: 'public', matcher: 'trimmed', weight: 1, expectedOutput: 'x' }] }),
      fragment: 'print(1 / 0)',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RUNTIME_ERROR');
    expect(result.errorMessage).toMatch(/ZeroDivisionError/);
  });

  it('stops an infinite loop at the time limit', async () => {
    const result = await evaluate({
      question: question({ timeLimitMs: 1500, requiredConstructs: [] }),
      fragment: 'while True:\n    pass',
      mode: 'submit',
    });
    expect(result.verdict).toBe('TIMEOUT');
    expect(result.errorType).toBe('timeout');
    expect(result.feedback).toMatch(/did not finish/i);
  }, 20000);

  it('blocks restricted system calls', async () => {
    const result = await evaluate({
      question: question(),
      fragment: 'import os\nos.system("ls")',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RESTRICTED');
    expect(result.score).toBe(0);
  });

  it('blocks question-level forbidden keywords', async () => {
    const result = await evaluate({
      question: question({ forbiddenKeywords: ['sum'] }),
      fragment: 'print(sum(numbers))',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RESTRICTED');
    expect(result.feedback).toMatch(/does not allow/i);
  });

  it('requires question-level keywords', async () => {
    const result = await evaluate({
      question: question({ requiredKeywords: ['enumerate'] }),
      fragment: 'for n in numbers:\n    print(n)',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RESTRICTED');
    expect(result.feedback).toMatch(/must use/i);
  });

  it('rejects an empty submission', async () => {
    const result = await evaluate({ question: question(), fragment: '   ', mode: 'submit' });
    expect(result.verdict).toBe('EMPTY');
  });

  it('enforces the maximum code length', async () => {
    const result = await evaluate({
      question: question({ maxCodeLength: 10 }),
      fragment: 'for n in numbers:\n    print(n)',
      mode: 'submit',
    });
    expect(result.verdict).toBe('RESTRICTED');
    expect(result.feedback).toMatch(/limit for this question/i);
  });
});

describe('hidden test cases', () => {
  const withHidden = question({
    starterCode: '{{SETUP_CODE}}\n\n{{STUDENT_CODE}}',
    requiredConstructs: [],
    testCases: [
      { visibility: 'public', matcher: 'trimmed', weight: 1, setupCode: 'numbers = [1, 2, 3]', expectedOutput: '1\n2\n3' },
      { visibility: 'hidden', matcher: 'trimmed', weight: 1, setupCode: 'numbers = [9]', expectedOutput: '9' },
      { visibility: 'hidden', matcher: 'trimmed', weight: 1, setupCode: 'numbers = []', expectedOutput: '' },
    ],
  });

  it('runs only the public tests on "run"', async () => {
    const result = await evaluate({ question: withHidden, fragment: 'for n in numbers:\n    print(n)', mode: 'run' });
    expect(result.tests).toHaveLength(1);
    expect(result.tests[0].visibility).toBe('public');
  });

  it('runs every test on "submit"', async () => {
    const result = await evaluate({ question: withHidden, fragment: 'for n in numbers:\n    print(n)', mode: 'submit' });
    expect(result.tests).toHaveLength(3);
    expect(result.isCorrect).toBe(true);
  });

  it('catches a hardcoded answer with a hidden test', async () => {
    const result = await evaluate({ question: withHidden, fragment: 'print("1\\n2\\n3")', mode: 'submit' });
    expect(result.isCorrect).toBe(false);
    expect(result.testsFailed).toBeGreaterThan(0);
    expect(result.feedback).toMatch(/hidden test/i);
  });

  it('gives no partial credit for passing only the visible example', async () => {
    const result = await evaluate({ question: withHidden, fragment: 'print("1\\n2\\n3")', mode: 'submit' });
    expect(result.verdict).toBe('WRONG_OUTPUT');
    expect(result.score).toBe(0);
  });

  it('gives partial credit when a hidden test also passes', async () => {
    const partial = question({
      starterCode: '{{SETUP_CODE}}\n\n{{STUDENT_CODE}}',
      testCases: [
        { visibility: 'public', matcher: 'trimmed', weight: 1, setupCode: 'numbers = [1]', expectedOutput: '1' },
        { visibility: 'hidden', matcher: 'trimmed', weight: 1, setupCode: 'numbers = [2]', expectedOutput: '2' },
        { visibility: 'hidden', matcher: 'trimmed', weight: 1, setupCode: 'numbers = [3, 4]', expectedOutput: '3\n4' },
      ],
    });
    // Prints only the first item: passes the two single-item tests, fails the third.
    const result = await evaluate({ question: partial, fragment: 'print(numbers[0])', mode: 'submit' });
    expect(result.verdict).toBe('PARTIAL');
    expect(result.score).toBeGreaterThan(0);
  });

  it('never leaks hidden expectations in the failing test payload', async () => {
    const result = await evaluate({ question: withHidden, fragment: 'print("1\\n2\\n3")', mode: 'submit' });
    const hidden = result.tests.filter((t) => t.visibility === 'hidden');
    expect(hidden.length).toBeGreaterThan(0);
    for (const test of hidden) {
      expect(test.expected).toBeUndefined();
      expect(test.actual).toBeUndefined();
    }
  });
});

describe('syntax-equivalence evaluation', () => {
  const listQuestion = question({
    evaluationType: 'SYNTAX',
    starterCode: 'numbers = {{STUDENT_CODE}}\n\nprint(numbers)',
    requiredConstructs: ['LIST_LITERAL'],
    acceptedSolutions: ['[5, 10, 15]'],
    testCases: [],
  });

  it('ignores formatting differences', async () => {
    for (const fragment of ['[5, 10, 15]', '[5,10,15]', '[ 5 , 10 , 15 ]']) {
      const result = await evaluate({ question: listQuestion, fragment, mode: 'submit' });
      expect(result.verdict, fragment).toBe('CORRECT');
    }
  });

  it('rejects a structurally different list', async () => {
    const result = await evaluate({ question: listQuestion, fragment: '[5, 10]', mode: 'submit' });
    expect(result.isCorrect).toBe(false);
  });

  it('accepts any of several valid solutions', async () => {
    const multi = question({
      evaluationType: 'SYNTAX',
      starterCode: 'value = {{STUDENT_CODE}}\nprint(value)',
      acceptedSolutions: ['len(numbers) == 0', 'not numbers', 'numbers == []'],
      testCases: [],
    });
    for (const fragment of ['len(numbers) == 0', 'not numbers', 'numbers == []']) {
      const result = await evaluate({ question: multi, fragment, mode: 'submit' });
      expect(result.verdict, fragment).toBe('CORRECT');
    }
  });
});

describe('multiple valid solutions (output-graded)', () => {
  it('accepts any implementation that satisfies the construct rule', async () => {
    const q = question({
      requiredConstructs: ['ANY:FOR_LOOP|WHILE_LOOP'],
      testCases: [{ visibility: 'public', matcher: 'trimmed', weight: 1, expectedOutput: '1\n2\n3' }],
    });
    const forLoop = await evaluate({ question: q, fragment: 'for n in numbers:\n    print(n)', mode: 'submit' });
    const whileLoop = await evaluate({
      question: q,
      fragment: 'i = 0\nwhile i < len(numbers):\n    print(numbers[i])\n    i += 1',
      mode: 'submit',
    });
    expect(forLoop.verdict).toBe('CORRECT');
    expect(whileLoop.verdict).toBe('CORRECT');
  });
});

describe('AST-only evaluation', () => {
  it('passes when the construct is present, without executing anything', async () => {
    const q = question({
      evaluationType: 'AST',
      starterCode: '{{STUDENT_CODE}}',
      requiredConstructs: ['LIST_COMPREHENSION'],
      testCases: [],
    });
    const ok = await evaluate({ question: q, fragment: '[n * n for n in range(3)]', mode: 'submit' });
    const bad = await evaluate({ question: q, fragment: 'list(map(lambda n: n * n, range(3)))', mode: 'submit' });
    expect(ok.verdict).toBe('CORRECT');
    expect(bad.verdict).toBe('WRONG_CONSTRUCT');
  });
});

describe('scoring', () => {
  it('reduces the score for each hint used', async () => {
    const q = question({ requiredConstructs: ['FOR_LOOP'] });
    const fragment = 'for n in numbers:\n    print(n)';
    const noHints = await evaluate({ question: q, fragment, mode: 'submit', hintsUsed: 0 });
    const twoHints = await evaluate({ question: q, fragment, mode: 'submit', hintsUsed: 2 });
    expect(noHints.score).toBe(100);
    expect(twoHints.score).toBe(70);
  });

  it('scores zero once the solution has been revealed', async () => {
    const result = await evaluate({
      question: question(),
      fragment: 'for n in numbers:\n    print(n)',
      mode: 'submit',
      solutionRevealed: true,
    });
    expect(result.isCorrect).toBe(true);
    expect(result.score).toBe(0);
  });
});
