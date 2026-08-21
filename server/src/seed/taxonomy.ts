/**
 * §6 + §7 — languages, topic tree and subtopics.
 *
 * The topic tree is data, not code: adding a topic here (or through the admin
 * API) makes it available to the question builder immediately.
 */

export interface LanguageSeed {
  slug: string;
  name: string;
  runtime: string;
  monacoId: string;
  fileExtension: string;
  icon: string;
  accent: string;
  description: string;
  topics: Array<{ slug: string; name: string; description?: string; subtopics: Array<[string, string]> }>;
}

export const LANGUAGES: LanguageSeed[] = [
  {
    slug: 'python',
    name: 'Python',
    runtime: 'python',
    monacoId: 'python',
    fileExtension: 'py',
    icon: '🐍',
    accent: '#3b82f6',
    description: 'Practise Python syntax one construct at a time.',
    topics: [
      {
        slug: 'basics', name: 'Basics', description: 'Variables, types and operators',
        subtopics: [
          ['variables', 'Variables'],
          ['data-types', 'Data types'],
          ['type-conversion', 'Type conversion'],
          ['input-output', 'Input / output'],
          ['operators', 'Operators'],
        ],
      },
      {
        slug: 'strings', name: 'Strings', description: 'Creating, slicing and formatting text',
        subtopics: [
          ['string-creation', 'String creation'],
          ['indexing', 'Indexing'],
          ['slicing', 'Slicing'],
          ['string-methods', 'String methods'],
          ['formatting', 'Formatting'],
          ['f-strings', 'f-strings'],
        ],
      },
      {
        slug: 'lists', name: 'Lists', description: 'Building and mutating lists',
        subtopics: [
          ['list-creation', 'List creation'],
          ['indexing', 'Indexing'],
          ['slicing', 'Slicing'],
          ['append', 'append()'],
          ['extend', 'extend()'],
          ['insert', 'insert()'],
          ['remove', 'remove()'],
          ['pop', 'pop()'],
          ['sort', 'sort()'],
          ['reverse', 'reverse()'],
          ['list-comprehension', 'List comprehension'],
        ],
      },
      {
        slug: 'tuples', name: 'Tuples', description: 'Immutable sequences',
        subtopics: [
          ['tuple-creation', 'Tuple creation'],
          ['accessing-elements', 'Accessing elements'],
          ['unpacking', 'Unpacking'],
        ],
      },
      {
        slug: 'dictionaries', name: 'Dictionaries', description: 'Key/value collections',
        subtopics: [
          ['dictionary-creation', 'Dictionary creation'],
          ['accessing-values', 'Accessing values'],
          ['adding-values', 'Adding values'],
          ['updating-values', 'Updating values'],
          ['dictionary-methods', 'Dictionary methods'],
          ['dictionary-comprehension', 'Dictionary comprehension'],
        ],
      },
      {
        slug: 'sets', name: 'Sets', description: 'Unique collections and set algebra',
        subtopics: [
          ['set-creation', 'Set creation'],
          ['add', 'add()'],
          ['remove', 'remove()'],
          ['union', 'Union'],
          ['intersection', 'Intersection'],
          ['difference', 'Difference'],
        ],
      },
      {
        slug: 'conditions', name: 'Conditions', description: 'Branching logic',
        subtopics: [
          ['if', 'if'],
          ['if-else', 'if-else'],
          ['elif', 'elif'],
          ['nested-conditions', 'Nested conditions'],
          ['conditional-expressions', 'Conditional expressions'],
        ],
      },
      {
        slug: 'loops', name: 'Loops', description: 'Repetition constructs',
        subtopics: [
          ['for', 'for'],
          ['while', 'while'],
          ['range', 'range()'],
          ['break', 'break'],
          ['continue', 'continue'],
          ['nested-loops', 'Nested loops'],
        ],
      },
      {
        slug: 'functions', name: 'Functions', description: 'Defining and calling functions',
        subtopics: [
          ['function-definition', 'Function definition'],
          ['parameters', 'Parameters'],
          ['default-parameters', 'Default parameters'],
          ['return', 'Return'],
          ['lambda', 'Lambda'],
          ['args', '*args'],
          ['kwargs', '**kwargs'],
        ],
      },
      {
        slug: 'oop', name: 'OOP', description: 'Classes and objects',
        subtopics: [
          ['class-creation', 'Class creation'],
          ['constructor', 'Constructor'],
          ['object-creation', 'Object creation'],
          ['methods', 'Methods'],
          ['inheritance', 'Inheritance'],
          ['encapsulation', 'Encapsulation'],
          ['polymorphism', 'Polymorphism'],
        ],
      },
      {
        slug: 'exceptions', name: 'Exception handling', description: 'Handling and raising errors',
        subtopics: [
          ['try', 'try'],
          ['except', 'except'],
          ['finally', 'finally'],
          ['raise', 'raise'],
        ],
      },
    ],
  },
  {
    slug: 'mysql',
    name: 'SQL / MySQL',
    runtime: 'sql',
    monacoId: 'sql',
    fileExtension: 'sql',
    icon: '🗄️',
    accent: '#f59e0b',
    description: 'Write one clause at a time against a live sandbox database.',
    topics: [
      { slug: 'select', name: 'SELECT', description: 'Choosing columns', subtopics: [['columns', 'Columns'], ['expressions', 'Expressions'], ['distinct', 'DISTINCT'], ['alias', 'Aliases']] },
      { slug: 'where', name: 'WHERE', description: 'Filtering rows', subtopics: [['comparison', 'Comparison'], ['logical', 'AND / OR'], ['like', 'LIKE'], ['in', 'IN'], ['between', 'BETWEEN'], ['null', 'NULL checks']] },
      { slug: 'order-by', name: 'ORDER BY', description: 'Sorting results', subtopics: [['single-column', 'Single column'], ['multiple-columns', 'Multiple columns'], ['desc', 'DESC']] },
      { slug: 'group-by', name: 'GROUP BY', description: 'Aggregating rows', subtopics: [['single-column', 'Single column'], ['aggregates', 'Aggregate functions'], ['multiple-columns', 'Multiple columns']] },
      { slug: 'having', name: 'HAVING', description: 'Filtering groups', subtopics: [['count', 'COUNT'], ['sum', 'SUM'], ['avg', 'AVG']] },
      { slug: 'inner-join', name: 'INNER JOIN', description: 'Matching rows across tables', subtopics: [['two-tables', 'Two tables'], ['with-where', 'With WHERE'], ['with-group-by', 'With GROUP BY']] },
      { slug: 'left-join', name: 'LEFT JOIN', description: 'Keeping unmatched rows', subtopics: [['two-tables', 'Two tables'], ['null-check', 'Finding unmatched rows']] },
      { slug: 'multiple-joins', name: 'Multiple JOINs', description: 'Three tables and more', subtopics: [['three-tables', 'Three tables'], ['self-join', 'Self join'], ['subquery-join', 'JOIN with subquery']] },
    ],
  },
  {
    slug: 'java',
    name: 'Java',
    runtime: 'java',
    monacoId: 'java',
    fileExtension: 'java',
    icon: '☕',
    accent: '#ef4444',
    description: 'Statement-level Java practice without the boilerplate.',
    topics: [
      { slug: 'basics', name: 'Basics', subtopics: [['variables', 'Variables'], ['operators', 'Operators'], ['output', 'Output']] },
      { slug: 'conditions', name: 'Conditions', subtopics: [['if', 'if'], ['if-else', 'if-else'], ['ternary', 'Ternary']] },
      { slug: 'loops', name: 'Loops', subtopics: [['for', 'for'], ['while', 'while'], ['enhanced-for', 'Enhanced for']] },
      { slug: 'arrays', name: 'Arrays', subtopics: [['declaration', 'Declaration'], ['iteration', 'Iteration']] },
      { slug: 'methods', name: 'Methods', subtopics: [['definition', 'Definition'], ['return', 'Return']] },
    ],
  },
  {
    slug: 'c',
    name: 'C',
    runtime: 'c',
    monacoId: 'c',
    fileExtension: 'c',
    icon: '🔧',
    accent: '#64748b',
    description: 'Conditions, loops and declarations in C.',
    topics: [
      { slug: 'basics', name: 'Basics', subtopics: [['variables', 'Variables'], ['printf', 'printf']] },
      { slug: 'conditions', name: 'Conditions', subtopics: [['if', 'if'], ['condition-expression', 'Condition expressions']] },
      { slug: 'loops', name: 'Loops', subtopics: [['for', 'for'], ['while', 'while']] },
    ],
  },
  {
    slug: 'cpp',
    name: 'C++',
    runtime: 'cpp',
    monacoId: 'cpp',
    fileExtension: 'cpp',
    icon: '⚙️',
    accent: '#8b5cf6',
    description: 'Vectors, loops and declarations in modern C++.',
    topics: [
      { slug: 'basics', name: 'Basics', subtopics: [['variables', 'Variables'], ['cout', 'cout']] },
      { slug: 'containers', name: 'Containers', subtopics: [['vector', 'vector'], ['map', 'map']] },
      { slug: 'loops', name: 'Loops', subtopics: [['for', 'for'], ['range-for', 'Range-based for']] },
      { slug: 'functions', name: 'Functions', subtopics: [['definition', 'Definition']] },
    ],
  },
  {
    slug: 'javascript',
    name: 'JavaScript',
    runtime: 'node',
    monacoId: 'javascript',
    fileExtension: 'js',
    icon: '🟨',
    accent: '#eab308',
    description: 'Expressions, functions and array methods.',
    topics: [
      { slug: 'basics', name: 'Basics', subtopics: [['variables', 'Variables'], ['template-literals', 'Template literals']] },
      { slug: 'functions', name: 'Functions', subtopics: [['declaration', 'Declaration'], ['arrow', 'Arrow functions'], ['return', 'Return']] },
      { slug: 'arrays', name: 'Arrays', subtopics: [['creation', 'Creation'], ['map', 'map()'], ['filter', 'filter()'], ['reduce', 'reduce()']] },
      { slug: 'conditions', name: 'Conditions', subtopics: [['if', 'if'], ['ternary', 'Ternary']] },
      { slug: 'loops', name: 'Loops', subtopics: [['for', 'for'], ['for-of', 'for...of']] },
    ],
  },
  {
    slug: 'html',
    name: 'HTML',
    runtime: 'static',
    monacoId: 'html',
    fileExtension: 'html',
    icon: '🌐',
    accent: '#f97316',
    description: 'Write the exact element the requirement asks for.',
    topics: [
      { slug: 'elements', name: 'Elements', subtopics: [['links', 'Links'], ['images', 'Images'], ['headings', 'Headings'], ['lists', 'Lists']] },
      { slug: 'forms', name: 'Forms', subtopics: [['input', 'Input'], ['button', 'Button']] },
      { slug: 'tables', name: 'Tables', subtopics: [['structure', 'Structure']] },
    ],
  },
  {
    slug: 'css',
    name: 'CSS',
    runtime: 'static',
    monacoId: 'css',
    fileExtension: 'css',
    icon: '🎨',
    accent: '#06b6d4',
    description: 'Declarations and selectors, one rule at a time.',
    topics: [
      { slug: 'text', name: 'Text', subtopics: [['font', 'Font'], ['color', 'Colour'], ['alignment', 'Alignment']] },
      { slug: 'box-model', name: 'Box model', subtopics: [['padding', 'Padding'], ['margin', 'Margin'], ['border', 'Border']] },
      { slug: 'selectors', name: 'Selectors', subtopics: [['class', 'Class'], ['id', 'Id'], ['pseudo', 'Pseudo-class']] },
      { slug: 'layout', name: 'Layout', subtopics: [['flexbox', 'Flexbox'], ['display', 'Display']] },
    ],
  },
];

/** §18 — the Python learning path from the spec, plus a SQL path. */
export interface PathSeed {
  slug: string;
  language: string;
  name: string;
  description: string;
  nodes: Array<{
    title: string;
    topic?: string;
    subtopic?: string;
    unlockSolved?: number;
    unlockAccuracy?: number;
    children?: Array<{ title: string; topic?: string; subtopic?: string; unlockSolved?: number; unlockAccuracy?: number }>;
  }>;
}

export const LEARNING_PATHS: PathSeed[] = [
  {
    slug: 'python-foundations',
    language: 'python',
    name: 'Python foundations',
    description: 'From variables to functions, one construct at a time.',
    nodes: [
      {
        title: 'Basics',
        topic: 'basics',
        unlockSolved: 3,
        unlockAccuracy: 50,
        children: [
          { title: 'Variables', topic: 'basics', subtopic: 'variables' },
          { title: 'Data types', topic: 'basics', subtopic: 'data-types' },
          { title: 'Operators', topic: 'basics', subtopic: 'operators' },
        ],
      },
      {
        title: 'Conditions',
        topic: 'conditions',
        unlockSolved: 3,
        unlockAccuracy: 50,
        children: [
          { title: 'if', topic: 'conditions', subtopic: 'if' },
          { title: 'elif', topic: 'conditions', subtopic: 'elif' },
          { title: 'Nested if', topic: 'conditions', subtopic: 'nested-conditions' },
        ],
      },
      {
        title: 'Loops',
        topic: 'loops',
        unlockSolved: 4,
        unlockAccuracy: 50,
        children: [
          { title: 'for', topic: 'loops', subtopic: 'for' },
          { title: 'while', topic: 'loops', subtopic: 'while' },
          { title: 'Nested loops', topic: 'loops', subtopic: 'nested-loops' },
        ],
      },
      {
        title: 'Collections',
        unlockSolved: 4,
        unlockAccuracy: 50,
        children: [
          { title: 'List', topic: 'lists' },
          { title: 'Tuple', topic: 'tuples' },
          { title: 'Set', topic: 'sets' },
          { title: 'Dictionary', topic: 'dictionaries' },
        ],
      },
      {
        title: 'Functions',
        topic: 'functions',
        children: [
          { title: 'Definition', topic: 'functions', subtopic: 'function-definition' },
          { title: 'Parameters', topic: 'functions', subtopic: 'parameters' },
          { title: 'Return', topic: 'functions', subtopic: 'return' },
        ],
      },
    ],
  },
  {
    slug: 'sql-query-builder',
    language: 'mysql',
    name: 'SQL query builder',
    description: 'Build up a full query clause by clause, from SELECT to multi-table JOINs.',
    nodes: [
      { title: 'SELECT', topic: 'select', unlockSolved: 2, unlockAccuracy: 50 },
      { title: 'WHERE', topic: 'where', unlockSolved: 2, unlockAccuracy: 50 },
      { title: 'ORDER BY', topic: 'order-by', unlockSolved: 2, unlockAccuracy: 50 },
      { title: 'GROUP BY', topic: 'group-by', unlockSolved: 2, unlockAccuracy: 50 },
      { title: 'HAVING', topic: 'having', unlockSolved: 2, unlockAccuracy: 50 },
      { title: 'INNER JOIN', topic: 'inner-join', unlockSolved: 2, unlockAccuracy: 50 },
      { title: 'LEFT JOIN', topic: 'left-join', unlockSolved: 2, unlockAccuracy: 50 },
      { title: 'Multiple JOINs', topic: 'multiple-joins' },
    ],
  },
];

/** §27 — badge catalogue. */
export const BADGES = [
  { slug: 'first-steps', name: 'First Steps', description: 'Solve your first question', icon: '🌱', criteriaType: 'solved_total', criteriaValue: 1, xpReward: 25 },
  { slug: 'ten-solved', name: 'Getting Warm', description: 'Solve 10 questions', icon: '🔟', criteriaType: 'solved_total', criteriaValue: 10, xpReward: 50 },
  { slug: 'syntax-100', name: '100 Syntax Questions Solved', description: 'Solve 100 questions', icon: '⚡', criteriaType: 'solved_total', criteriaValue: 100, xpReward: 250 },
  { slug: 'streak-7', name: '7 Day Streak', description: 'Practise 7 days in a row', icon: '🔥', criteriaType: 'streak', criteriaValue: 7, xpReward: 100 },
  { slug: 'streak-30', name: '30 Day Streak', description: 'Practise 30 days in a row', icon: '🌟', criteriaType: 'streak', criteriaValue: 30, xpReward: 400 },
  { slug: 'python-basics-master', name: 'Python Basics Master', description: 'Solve 8 Python basics questions', icon: '🐍', criteriaType: 'topic_solved', criteriaValue: 8, scopeLanguage: 'python', scopeTopic: 'basics', xpReward: 100 },
  { slug: 'loop-master', name: 'Loop Master', description: 'Solve 12 Python loop questions', icon: '🔁', criteriaType: 'topic_solved', criteriaValue: 12, scopeLanguage: 'python', scopeTopic: 'loops', xpReward: 120 },
  { slug: 'list-master', name: 'List Master', description: 'Solve 8 Python list questions', icon: '📋', criteriaType: 'topic_solved', criteriaValue: 8, scopeLanguage: 'python', scopeTopic: 'lists', xpReward: 100 },
  { slug: 'sql-join-master', name: 'SQL JOIN Master', description: 'Solve 5 INNER JOIN questions', icon: '🗄️', criteriaType: 'topic_solved', criteriaValue: 5, scopeLanguage: 'mysql', scopeTopic: 'inner-join', xpReward: 120 },
  { slug: 'sql-explorer', name: 'SQL Explorer', description: 'Solve 20 SQL questions', icon: '🔍', criteriaType: 'language_solved', criteriaValue: 20, scopeLanguage: 'mysql', xpReward: 150 },
  { slug: 'python-sharpshooter', name: 'Python Sharpshooter', description: 'Reach 80% accuracy in Python (min 5 attempted)', icon: '🎯', criteriaType: 'language_accuracy', criteriaValue: 80, scopeLanguage: 'python', xpReward: 150 },
  { slug: 'first-try-10', name: 'One and Done', description: 'Solve 10 questions on the first attempt', icon: '✨', criteriaType: 'first_try', criteriaValue: 10, xpReward: 150 },
  { slug: 'level-5', name: 'Level 5', description: 'Reach 1000 XP', icon: '🏆', criteriaType: 'xp', criteriaValue: 1000, xpReward: 0 },
];
