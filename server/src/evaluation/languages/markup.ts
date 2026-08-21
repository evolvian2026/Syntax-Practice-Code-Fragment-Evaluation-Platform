import { parse as parseHtml } from 'node-html-parser';
import postcss from 'postcss';
import type {
  AnalysisResult, EvaluableQuestion, LanguageAdapter, StaticEvaluation,
} from '../types.js';

/**
 * HTML and CSS adapters (§9).
 *
 * Neither language is executed: fragments are parsed and inspected structurally,
 * so `<a href='https://google.com'>Google</a>` and
 * `<a href="https://google.com">Google</a>` grade identically.
 */

// ------------------------------------------------------------------- HTML

export function analyzeHtml(fragment: string): AnalysisResult {
  const trimmed = fragment.trim();
  if (!trimmed) {
    return { ok: false, constructs: [], error: { type: 'EmptyFragment', message: 'Write some HTML first.' } };
  }
  // node-html-parser is forgiving, so unbalanced tags are detected separately.
  const unbalanced = findUnbalancedTag(trimmed);
  if (unbalanced) {
    return { ok: false, constructs: [], error: { type: 'SyntaxError', message: unbalanced } };
  }

  const root = parseHtml(trimmed, { comment: false, voidTag: { closingSlash: true } });
  const constructs = new Set<string>();
  const tags: string[] = [];

  const visit = (node: any) => {
    if (node.nodeType === 1) {
      const tag = String(node.rawTagName ?? '').toLowerCase();
      if (tag) {
        tags.push(tag);
        constructs.add(`TAG:${tag}`);
        for (const attr of Object.keys(node.attributes ?? {})) {
          constructs.add(`ATTR:${tag}.${attr.toLowerCase()}`);
          constructs.add(`ATTR:${attr.toLowerCase()}`);
        }
      }
    }
    for (const child of node.childNodes ?? []) visit(child);
  };
  visit(root);

  if (tags.some((t) => ['ul', 'ol', 'li'].includes(t))) constructs.add('LIST');
  if (tags.includes('table')) constructs.add('TABLE');
  if (tags.includes('form')) constructs.add('FORM');
  if (tags.includes('a')) constructs.add('HYPERLINK');
  if (tags.includes('img')) constructs.add('IMAGE');
  if (tags.some((t) => /^h[1-6]$/.test(t))) constructs.add('HEADING');

  return {
    ok: true,
    constructs: [...constructs].sort(),
    dump: normalizeHtml(trimmed),
    details: { tags: [...new Set(tags)].sort(), elementCount: tags.length },
  };
}

const VOID_TAGS = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);

function findUnbalancedTag(html: string): string | null {
  const stack: string[] = [];
  const tagRe = /<\s*(\/?)\s*([a-zA-Z][\w-]*)([^>]*?)(\/?)\s*>/g;
  let match: RegExpExecArray | null;
  while ((match = tagRe.exec(html)) !== null) {
    const [, closing, rawName, , selfClose] = match;
    const name = rawName.toLowerCase();
    if (VOID_TAGS.has(name) || selfClose === '/') continue;
    if (closing) {
      const open = stack.pop();
      if (open !== name) {
        return open
          ? `Closing tag </${name}> does not match the open tag <${open}>.`
          : `Closing tag </${name}> has no matching opening tag.`;
      }
    } else {
      stack.push(name);
    }
  }
  if (stack.length > 0) return `Tag <${stack[stack.length - 1]}> is never closed.`;
  if (/<[^>]*$/.test(html)) return 'A tag is missing its closing ">".';
  return null;
}

/** Attribute-order and quote-style insensitive fingerprint. */
export function normalizeHtml(html: string): string {
  const root = parseHtml(html.trim(), { comment: false });
  const render = (node: any): string => {
    if (node.nodeType === 3) return node.rawText.replace(/\s+/g, ' ').trim();
    const tag = String(node.rawTagName ?? '').toLowerCase();
    if (!tag) return (node.childNodes ?? []).map(render).join('');
    const attrs = Object.entries(node.attributes ?? {})
      .map(([k, v]) => `${k.toLowerCase()}="${String(v).trim()}"`)
      .sort()
      .join(' ');
    const inner = (node.childNodes ?? []).map(render).join('');
    return `<${tag}${attrs ? ` ${attrs}` : ''}>${inner}</${tag}>`;
  };
  return (root.childNodes ?? []).map(render).join('').trim();
}

function evaluateHtmlRules(fragment: string, question: EvaluableQuestion): StaticEvaluation {
  const spec = question.config.html ?? {};
  const analysis = analyzeHtml(fragment);
  if (!analysis.ok) {
    return { passed: false, message: analysis.error?.message ?? 'Invalid HTML.', constructs: [] };
  }
  const root = parseHtml(fragment.trim(), { comment: false });
  const problems: string[] = [];

  const selector = spec.selector ?? spec.tag;
  const matches = selector ? root.querySelectorAll(selector) : [];

  if (selector) {
    const min = spec.minCount ?? 1;
    if (matches.length < min) {
      problems.push(`Expected at least ${min} \`${selector}\` element${min === 1 ? '' : 's'}, found ${matches.length}.`);
    }
  }

  const target = matches[0];
  if (target) {
    for (const [attr, expected] of Object.entries(spec.attributes ?? {})) {
      const actual = target.getAttribute(attr);
      if (actual === undefined || actual === null) {
        problems.push(`Missing the \`${attr}\` attribute.`);
      } else if (String(actual).trim() !== String(expected).trim()) {
        problems.push(`\`${attr}\` should be \`${expected}\` but is \`${actual}\`.`);
      }
    }
    const text = target.text.replace(/\s+/g, ' ').trim();
    if (spec.textEquals !== undefined && text !== spec.textEquals.trim()) {
      problems.push(`The element text should be \`${spec.textEquals}\` but is \`${text}\`.`);
    }
    if (spec.textContains !== undefined && !text.toLowerCase().includes(spec.textContains.toLowerCase())) {
      problems.push(`The element text should contain \`${spec.textContains}\`.`);
    }
  } else if (selector && (spec.attributes || spec.textEquals || spec.textContains)) {
    problems.push(`No \`${selector}\` element to check.`);
  }

  return {
    passed: problems.length === 0,
    message: problems.length === 0 ? 'Your markup matches the requirement.' : problems.join(' '),
    constructs: analysis.constructs,
    details: { problems },
  };
}

export const htmlAdapter: LanguageAdapter = {
  slug: 'html',
  runtime: 'static',
  monacoId: 'html',
  displayName: 'HTML',
  executable: false,

  async analyzeFragment(fragment: string): Promise<AnalysisResult> {
    return analyzeHtml(fragment);
  },

  async isEquivalent(fragment: string, candidates: string[]): Promise<boolean> {
    const mine = normalizeHtml(fragment);
    return candidates.some((c) => normalizeHtml(c) === mine);
  },

  async staticEvaluate(fragment: string, question: EvaluableQuestion): Promise<StaticEvaluation> {
    return evaluateHtmlRules(fragment, question);
  },
};

// -------------------------------------------------------------------- CSS

/** Parses either a declaration list (`font-weight: bold;`) or full rules. */
function parseCss(fragment: string): { root: postcss.Root; wrapped: boolean } {
  const trimmed = fragment.trim();
  const looksLikeRule = /\{/.test(trimmed);
  const source = looksLikeRule ? trimmed : `__fragment__ { ${trimmed} }`;
  return { root: postcss.parse(source), wrapped: !looksLikeRule };
}

export function analyzeCss(fragment: string): AnalysisResult {
  try {
    const { root, wrapped } = parseCss(fragment);
    const constructs = new Set<string>();
    const declarations: Record<string, string> = {};
    const selectors: string[] = [];

    root.walkRules((rule) => {
      if (wrapped) return;
      selectors.push(rule.selector);
      constructs.add(`SELECTOR:${rule.selector.trim()}`);
      if (rule.selector.includes(':')) constructs.add('PSEUDO_SELECTOR');
      if (rule.selector.startsWith('.')) constructs.add('CLASS_SELECTOR');
      if (rule.selector.startsWith('#')) constructs.add('ID_SELECTOR');
    });
    root.walkDecls((decl) => {
      const prop = decl.prop.toLowerCase().trim();
      declarations[prop] = decl.value.trim();
      constructs.add(`PROPERTY:${prop}`);
      constructs.add(`DECL:${prop}:${decl.value.trim().toLowerCase()}`);
    });
    root.walkAtRules((at) => {
      constructs.add(`AT_RULE:${at.name}`);
    });

    return {
      ok: true,
      constructs: [...constructs].sort(),
      dump: normalizeCss(fragment),
      details: { declarations, selectors },
    };
  } catch (err) {
    const e = err as { reason?: string; message: string; line?: number };
    return {
      ok: false,
      constructs: [],
      error: { type: 'SyntaxError', message: e.reason ?? e.message, line: e.line ?? null },
    };
  }
}

export function normalizeCss(fragment: string): string {
  try {
    const { root } = parseCss(fragment);
    const parts: string[] = [];
    root.walkDecls((decl) => {
      parts.push(`${decl.prop.toLowerCase().trim()}:${decl.value.replace(/\s+/g, ' ').trim().toLowerCase()}`);
    });
    return parts.sort().join(';');
  } catch {
    return fragment.replace(/\s+/g, ' ').trim().toLowerCase();
  }
}

export const cssAdapter: LanguageAdapter = {
  slug: 'css',
  runtime: 'static',
  monacoId: 'css',
  displayName: 'CSS',
  executable: false,

  async analyzeFragment(fragment: string): Promise<AnalysisResult> {
    return analyzeCss(fragment);
  },

  async isEquivalent(fragment: string, candidates: string[]): Promise<boolean> {
    const mine = normalizeCss(fragment);
    return candidates.some((c) => normalizeCss(c) === mine);
  },

  async staticEvaluate(fragment: string, question: EvaluableQuestion): Promise<StaticEvaluation> {
    const analysis = analyzeCss(fragment);
    if (!analysis.ok) {
      return { passed: false, message: analysis.error?.message ?? 'Invalid CSS.', constructs: [] };
    }
    const spec = question.config.css ?? {};
    const declared = (analysis.details?.declarations ?? {}) as Record<string, string>;
    const problems: string[] = [];

    for (const prop of spec.requireProperties ?? []) {
      if (!(prop.toLowerCase() in declared)) problems.push(`Missing the \`${prop}\` property.`);
    }
    for (const [prop, expected] of Object.entries(spec.declarations ?? {})) {
      const actual = declared[prop.toLowerCase()];
      if (actual === undefined) {
        problems.push(`Missing the \`${prop}\` property.`);
      } else if (actual.replace(/\s+/g, ' ').toLowerCase() !== String(expected).replace(/\s+/g, ' ').toLowerCase()) {
        problems.push(`\`${prop}\` should be \`${expected}\` but is \`${actual}\`.`);
      }
    }
    if (spec.selector) {
      const selectors = (analysis.details?.selectors ?? []) as string[];
      const wanted = spec.selector.replace(/\s+/g, ' ').trim();
      if (!selectors.some((s) => s.replace(/\s+/g, ' ').trim() === wanted)) {
        problems.push(`Expected a rule for the selector \`${spec.selector}\`.`);
      }
    }

    return {
      passed: problems.length === 0,
      message: problems.length === 0 ? 'Your styles match the requirement.' : problems.join(' '),
      constructs: analysis.constructs,
      details: { problems },
    };
  },
};
