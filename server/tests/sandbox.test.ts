import { describe, expect, it } from 'vitest';
import { analyzePython, execute } from '../src/sandbox/index.js';
import { analyzeJavaScript } from '../src/evaluation/languages/javascript.js';
import { analyzeCss, analyzeHtml, normalizeHtml } from '../src/evaluation/languages/markup.js';
import { checkBalanced, stripCLikeNoise } from '../src/evaluation/languages/clike.js';

/** §14 — the sandbox must contain student code, whatever it tries. */

describe('python sandbox', () => {
  it('runs a normal program', async () => {
    const result = await execute({ runtime: 'python', source: 'print("hi")', timeoutMs: 4000, memoryMb: 128 });
    expect(result.status).toBe('ok');
    expect(result.stdout.trim()).toBe('hi');
  });

  it('passes stdin through', async () => {
    const result = await execute({
      runtime: 'python',
      source: 'print(input().upper())',
      stdin: 'hello\n',
      timeoutMs: 4000,
      memoryMb: 128,
    });
    expect(result.stdout.trim()).toBe('HELLO');
  });

  it('blocks os.system', async () => {
    const result = await execute({ runtime: 'python', source: 'import os\nos.system("ls")', timeoutMs: 4000, memoryMb: 128 });
    expect(result.status).toBe('restricted');
  });

  it('blocks the subprocess module', async () => {
    const result = await execute({ runtime: 'python', source: 'import subprocess', timeoutMs: 4000, memoryMb: 128 });
    expect(result.status).toBe('restricted');
  });

  it('blocks socket/network access', async () => {
    const result = await execute({ runtime: 'python', source: 'import socket', timeoutMs: 4000, memoryMb: 128 });
    expect(result.status).toBe('restricted');
  });

  it('blocks file access', async () => {
    const result = await execute({ runtime: 'python', source: 'open("/etc/passwd")', timeoutMs: 4000, memoryMb: 128 });
    expect(result.status).toBe('restricted');
  });

  it('kills an infinite loop', async () => {
    const result = await execute({ runtime: 'python', source: 'while True: pass', timeoutMs: 1500, memoryMb: 128 });
    expect(result.status).toBe('timeout');
  }, 20000);

  it('kills a sleeping program', async () => {
    const result = await execute({ runtime: 'python', source: 'import time\ntime.sleep(30)', timeoutMs: 1200, memoryMb: 128 });
    expect(result.status).toBe('timeout');
  }, 20000);

  it('enforces the memory limit', async () => {
    const result = await execute({ runtime: 'python', source: 'x = [0] * 100000000', timeoutMs: 4000, memoryMb: 64 });
    expect(['memory_exceeded', 'runtime_error', 'timeout']).toContain(result.status);
  }, 20000);

  it('still allows harmless standard-library imports', async () => {
    const result = await execute({ runtime: 'python', source: 'import math\nprint(math.floor(2.7))', timeoutMs: 4000, memoryMb: 128 });
    expect(result.status).toBe('ok');
    expect(result.stdout.trim()).toBe('2');
  });

  it('reports the failing line of a runtime error', async () => {
    const result = await execute({ runtime: 'python', source: 'a = 1\nb = a / 0', timeoutMs: 4000, memoryMb: 128 });
    expect(result.status).toBe('runtime_error');
    expect((result.detail as { line?: number })?.line).toBe(2);
  });
});

describe('python static analysis', () => {
  it('detects a for loop', async () => {
    const analysis = await analyzePython('for n in xs:\n    print(n)');
    expect(analysis.constructs).toContain('FOR_LOOP');
  });

  it('does not mistake unpacking for a loop', async () => {
    const analysis = await analyzePython('print(*xs, sep="\\n")');
    expect(analysis.constructs).not.toContain('FOR_LOOP');
    expect(analysis.constructs).toContain('UNPACKING');
  });

  it('distinguishes elif from else', async () => {
    const withElif = await analyzePython('if a:\n    pass\nelif b:\n    pass');
    const withElse = await analyzePython('if a:\n    pass\nelse:\n    pass');
    expect(withElif.constructs).toContain('ELIF');
    expect(withElse.constructs).toContain('IF_ELSE');
  });

  it('detects nested loops', async () => {
    const analysis = await analyzePython('for i in a:\n    for j in b:\n        print(i, j)');
    expect(analysis.constructs).toContain('NESTED_LOOP');
  });

  it('compares expressions structurally', async () => {
    const result = await analyzePython('[5,10,15]', { mode: 'compare', candidates: ['[5, 10, 15]'] });
    expect(result.equivalent).toBe(true);
  });

  it('reports a useful syntax error', async () => {
    const analysis = await analyzePython('for n in xs\n    print(n)');
    expect(analysis.ok).toBe(false);
    expect(analysis.error.message).toMatch(/expected ':'/);
  });
});

describe('javascript sandbox and analysis', () => {
  it('runs a JavaScript program', async () => {
    const result = await execute({
      runtime: 'node',
      source: 'const square = (n) => n * n;\nconsole.log(square(5));',
      timeoutMs: 4000,
      memoryMb: 128,
    });
    expect(result.status).toBe('ok');
    expect(result.stdout.trim()).toBe('25');
  });

  it('blocks filesystem writes', async () => {
    const result = await execute({
      runtime: 'node',
      source: 'const fs = await import("node:fs"); fs.writeFileSync("/tmp/pwned", "1");',
      timeoutMs: 4000,
      memoryMb: 128,
    });
    expect(result.status).toBe('runtime_error');
    expect(result.stderr).toMatch(/Access to this API has been restricted/i);
  });

  it('detects arrow functions and array methods', () => {
    const analysis = analyzeJavaScript('numbers.map((n) => n * 2)');
    expect(analysis.constructs).toContain('METHOD:map');
    expect(analysis.constructs).toContain('ARROW_FUNCTION');
  });

  it('reports a JavaScript syntax error', () => {
    const analysis = analyzeJavaScript('const x = ;');
    expect(analysis.ok).toBe(false);
  });
});

describe('markup analysis', () => {
  it('detects an anchor element', () => {
    const analysis = analyzeHtml('<a href="https://example.com">Link</a>');
    expect(analysis.ok).toBe(true);
    expect(analysis.constructs).toContain('TAG:a');
    expect(analysis.constructs).toContain('HYPERLINK');
  });

  it('catches an unclosed tag', () => {
    const analysis = analyzeHtml('<div><p>text</div>');
    expect(analysis.ok).toBe(false);
  });

  it('ignores quote style and attribute order', () => {
    expect(normalizeHtml(`<a href='https://x.dev' id="a">Go</a>`))
      .toBe(normalizeHtml('<a id="a" href="https://x.dev">Go</a>'));
  });

  it('parses a bare CSS declaration list', () => {
    const analysis = analyzeCss('font-weight: bold;');
    expect(analysis.ok).toBe(true);
    expect(analysis.constructs).toContain('PROPERTY:font-weight');
  });

  it('reports invalid CSS', () => {
    const analysis = analyzeCss('color: ;;{');
    expect(analysis.ok).toBe(false);
  });
});

describe('c-like helpers', () => {
  it('strips comments and strings before token detection', () => {
    expect(stripCLikeNoise('// for (int i=0;;)\nint x = 1;')).not.toMatch(/for/);
  });

  it('flags unbalanced brackets', () => {
    expect(checkBalanced('for (int i = 0; i < 10; i++ {')).toMatch(/never closed/i);
    expect(checkBalanced('for (int i = 0; i < 10; i++)')).toBeNull();
  });
});

describe('compiled languages', () => {
  it('runs C', async () => {
    const result = await execute({
      runtime: 'c',
      source: '#include <stdio.h>\nint main(){ printf("Even\\n"); return 0; }',
      timeoutMs: 4000,
      memoryMb: 64,
    });
    expect(result.status).toBe('ok');
    expect(result.stdout.trim()).toBe('Even');
  }, 30000);

  it('reports a C compile error', async () => {
    const result = await execute({
      runtime: 'c',
      source: '#include <stdio.h>\nint main(){ printf("x") return 0; }',
      timeoutMs: 4000,
      memoryMb: 64,
    });
    expect(result.status).toBe('compile_error');
  }, 30000);

  it('runs C++', async () => {
    const result = await execute({
      runtime: 'cpp',
      source: '#include <iostream>\n#include <vector>\nint main(){ std::vector<int> v={1,2}; for (int x : v) std::cout << x << "\\n"; }',
      timeoutMs: 4000,
      memoryMb: 128,
    });
    expect(result.status).toBe('ok');
    expect(result.stdout.trim().split('\n')).toEqual(['1', '2']);
  }, 30000);

  it('runs Java', async () => {
    const result = await execute({
      runtime: 'java',
      source: 'public class Main { public static void main(String[] a){ System.out.println("ok"); } }',
      timeoutMs: 6000,
      memoryMb: 256,
    });
    expect(result.status).toBe('ok');
    expect(result.stdout.trim()).toBe('ok');
  }, 60000);
});
