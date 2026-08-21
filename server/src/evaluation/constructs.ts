/**
 * Canonical construct vocabulary.
 *
 * Every language adapter emits names from this list (plus dynamic ones like
 * `METHOD:append` or `TAG:a`), so a question can say "requires FOR_LOOP" once
 * and have it mean the same thing in Python, JavaScript, Java, C and C++.
 * The labels are what students read in feedback messages.
 */

export const CONSTRUCT_LABELS: Record<string, string> = {
  // control flow
  LOOP: 'a loop',
  FOR_LOOP: 'a FOR loop',
  FOR_OF: 'a for...of loop',
  FOR_IN: 'a for...in loop',
  WHILE_LOOP: 'a WHILE loop',
  DO_WHILE_LOOP: 'a do...while loop',
  NESTED_LOOP: 'a nested loop',
  LOOP_ELSE: 'a loop else clause',
  ENHANCED_FOR: 'an enhanced for loop',
  RANGE_FOR: 'a range-based for loop',
  BREAK: 'break',
  CONTINUE: 'continue',
  PASS: 'pass',
  IF: 'an IF statement',
  IF_ELSE: 'an IF-ELSE statement',
  ELIF: 'an ELIF branch',
  NESTED_IF: 'a nested IF',
  TERNARY: 'a conditional expression',
  CONDITIONAL_EXPRESSION: 'a conditional expression',
  SWITCH: 'a switch statement',
  MATCH: 'a match statement',

  // data structures
  LIST_LITERAL: 'a list',
  ARRAY_LITERAL: 'an array literal',
  TUPLE_LITERAL: 'a tuple',
  DICT_LITERAL: 'a dictionary',
  OBJECT_LITERAL: 'an object literal',
  SET_LITERAL: 'a set',
  LIST_CONSTRUCTOR: 'list()',
  DICT_CONSTRUCTOR: 'dict()',
  SET_CONSTRUCTOR: 'set()',
  TUPLE_CONSTRUCTOR: 'tuple()',
  VECTOR: 'a vector',
  ARRAY: 'an array',
  ARRAY_DECLARATION: 'an array declaration',
  SUBSCRIPT: 'indexing',
  INDEXING: 'indexing',
  SLICING: 'slicing',
  SLICE: 'a slice',

  // comprehensions
  COMPREHENSION: 'a comprehension',
  LIST_COMPREHENSION: 'a list comprehension',
  DICT_COMPREHENSION: 'a dictionary comprehension',
  SET_COMPREHENSION: 'a set comprehension',
  GENERATOR_EXPRESSION: 'a generator expression',

  // functions
  FUNCTION_DEF: 'a function definition',
  FUNCTION_EXPRESSION: 'a function expression',
  ARROW_FUNCTION: 'an arrow function',
  LAMBDA: 'a lambda',
  RETURN: 'a return statement',
  PARAMETER: 'a parameter',
  DEFAULT_PARAMETER: 'a default parameter',
  ARGS: '*args',
  KWARGS: '**kwargs',
  KEYWORD_ARGUMENT: 'a keyword argument',
  STAR_ARGUMENT: 'argument unpacking',
  REST_PARAMETER: 'a rest parameter',
  NESTED_FUNCTION: 'a nested function',
  DECORATOR: 'a decorator',
  FUNCTION_CALL: 'a function call',
  YIELD: 'yield',
  AWAIT: 'await',

  // OOP
  CLASS_DEF: 'a class definition',
  METHOD_DEF: 'a method',
  CONSTRUCTOR: 'a constructor',
  SELF_PARAMETER: 'the self parameter',
  INHERITANCE: 'inheritance',
  NEW: 'object creation',

  // exceptions
  TRY_EXCEPT: 'a try/except block',
  EXCEPT: 'an except clause',
  FINALLY: 'a finally block',
  TRY_ELSE: 'a try/else block',
  RAISE: 'raise',
  THROW: 'throw',
  EXCEPTION_HANDLING: 'exception handling',
  ASSERT: 'assert',

  // statements & operators
  ASSIGNMENT: 'an assignment',
  MULTIPLE_ASSIGNMENT: 'a multiple assignment',
  AUG_ASSIGN: 'an augmented assignment',
  ANNOTATED_ASSIGNMENT: 'an annotated assignment',
  VARIABLE_DECLARATION: 'a variable declaration',
  UNPACKING: 'unpacking',
  SPREAD: 'the spread operator',
  STAR_EXPRESSION: 'a starred expression',
  DELETE: 'del',
  GLOBAL: 'global',
  NONLOCAL: 'nonlocal',
  WITH: 'a with statement',
  IMPORT: 'an import',
  COMPARISON: 'a comparison',
  BOOLEAN_OPERATOR: 'a boolean operator',
  UNARY_OPERATOR: 'a unary operator',
  ARITHMETIC: 'an arithmetic operator',
  INCREMENT: 'an increment/decrement operator',
  OP_ADD: 'the + operator',
  OP_SUB: 'the - operator',
  OP_MUL: 'the * operator',
  OP_DIV: 'the / operator',
  OP_FLOORDIV: 'the // operator',
  OP_MOD: 'the % operator',
  OP_POW: 'the ** operator',
  OP_EQ: 'the == operator',
  OP_NEQ: 'the != operator',
  OP_LT: 'the < operator',
  OP_LTE: 'the <= operator',
  OP_GT: 'the > operator',
  OP_GTE: 'the >= operator',
  OP_IN: 'the in operator',
  OP_NOT_IN: 'the not in operator',
  OP_IS: 'the is operator',
  OP_IS_NOT: 'the is not operator',
  OP_AND: 'the and operator',
  OP_OR: 'the or operator',
  OP_NOT: 'the not operator',

  // strings / io
  PRINT: 'print output',
  INPUT: 'input',
  RANGE: 'range()',
  FSTRING: 'an f-string',
  TEMPLATE_LITERAL: 'a template literal',
  STRING_FORMATTING: 'string formatting',
  STRING: 'a string',
  SCANF: 'scanf',

  // SQL
  SELECT: 'a SELECT clause',
  FROM: 'a FROM clause',
  WHERE: 'a WHERE clause',
  GROUP_BY: 'a GROUP BY clause',
  HAVING: 'a HAVING clause',
  ORDER_BY: 'an ORDER BY clause',
  LIMIT: 'a LIMIT clause',
  DISTINCT: 'DISTINCT',
  JOIN: 'a JOIN',
  INNER_JOIN: 'an INNER JOIN',
  LEFT_JOIN: 'a LEFT JOIN',
  RIGHT_JOIN: 'a RIGHT JOIN',
  FULL_JOIN: 'a FULL OUTER JOIN',
  CROSS_JOIN: 'a CROSS JOIN',
  SELF_JOIN: 'a SELF JOIN',
  MULTIPLE_JOINS: 'multiple JOINs',
  ON_CLAUSE: 'an ON condition',
  USING_CLAUSE: 'a USING clause',
  SUBQUERY: 'a subquery',
  UNION: 'a UNION',
  ALIAS: 'an alias',
  AGGREGATE: 'an aggregate function',
  COUNT: 'COUNT()',
  SUM: 'SUM()',
  AVG: 'AVG()',
  MIN: 'MIN()',
  MAX: 'MAX()',
  LIKE: 'LIKE',
  IN_OPERATOR: 'the IN operator',
  BETWEEN: 'BETWEEN',
  IS_NULL: 'an IS NULL check',
  DESC: 'descending order',
  ASC: 'ascending order',
  CASE: 'a CASE expression',

  // markup
  LIST: 'a list element',
  TABLE: 'a table',
  FORM: 'a form',
  HYPERLINK: 'a hyperlink',
  IMAGE: 'an image',
  HEADING: 'a heading',
  CLASS_SELECTOR: 'a class selector',
  ID_SELECTOR: 'an id selector',
  PSEUDO_SELECTOR: 'a pseudo-class selector',

  // misc
  POINTER: 'a pointer',
  STRUCT: 'a struct',
  GENERIC: 'a generic type',
  TEMPLATE: 'a template',
  AUTO: 'auto',
  BLOCK: 'a block',
  MEMBER_ACCESS: 'member access',
};

/** Turns a construct id into the phrase used in student-facing feedback. */
export function describeConstruct(construct: string): string {
  if (construct.startsWith('ANY:')) {
    return construct
      .slice(4)
      .split('|')
      .map((c) => describeConstruct(c.trim()))
      .join(' or ');
  }
  if (CONSTRUCT_LABELS[construct]) return CONSTRUCT_LABELS[construct];

  const [kind, ...rest] = construct.split(':');
  const value = rest.join(':');
  switch (kind) {
    case 'METHOD': return `the .${value}() method`;
    case 'CALL': return `the ${value}() function`;
    case 'DEF': return `a function named ${value}`;
    case 'CLASS': return `a class named ${value}`;
    case 'IMPORT': return `an import of ${value}`;
    case 'DECL': return `a ${value.toLowerCase()} declaration`;
    case 'TAG': return `a <${value}> element`;
    case 'ATTR': return `the ${value} attribute`;
    case 'PROPERTY': return `the ${value} property`;
    case 'SELECTOR': return `the ${value} selector`;
    case 'JOIN_COUNT': return `${value} JOIN${value === '1' ? '' : 's'}`;
    default: return construct.toLowerCase().replace(/_/g, ' ');
  }
}

/** Grouped list for the admin question builder's construct picker. */
export const CONSTRUCT_GROUPS: Array<{ group: string; constructs: string[] }> = [
  { group: 'Loops', constructs: ['FOR_LOOP', 'WHILE_LOOP', 'DO_WHILE_LOOP', 'NESTED_LOOP', 'LOOP', 'BREAK', 'CONTINUE', 'RANGE'] },
  { group: 'Conditions', constructs: ['IF', 'IF_ELSE', 'ELIF', 'NESTED_IF', 'TERNARY', 'SWITCH', 'COMPARISON', 'BOOLEAN_OPERATOR'] },
  { group: 'Collections', constructs: ['LIST_LITERAL', 'TUPLE_LITERAL', 'DICT_LITERAL', 'SET_LITERAL', 'SUBSCRIPT', 'SLICING', 'UNPACKING'] },
  { group: 'Comprehensions', constructs: ['LIST_COMPREHENSION', 'DICT_COMPREHENSION', 'SET_COMPREHENSION', 'GENERATOR_EXPRESSION'] },
  { group: 'Functions', constructs: ['FUNCTION_DEF', 'LAMBDA', 'RETURN', 'DEFAULT_PARAMETER', 'ARGS', 'KWARGS', 'DECORATOR'] },
  { group: 'OOP', constructs: ['CLASS_DEF', 'CONSTRUCTOR', 'METHOD_DEF', 'INHERITANCE', 'SELF_PARAMETER'] },
  { group: 'Exceptions', constructs: ['TRY_EXCEPT', 'EXCEPT', 'FINALLY', 'RAISE', 'EXCEPTION_HANDLING'] },
  { group: 'Strings & output', constructs: ['PRINT', 'FSTRING', 'STRING_FORMATTING', 'TEMPLATE_LITERAL', 'INPUT'] },
  { group: 'SQL clauses', constructs: ['SELECT', 'WHERE', 'GROUP_BY', 'HAVING', 'ORDER_BY', 'LIMIT', 'DISTINCT', 'SUBQUERY'] },
  { group: 'SQL joins', constructs: ['JOIN', 'INNER_JOIN', 'LEFT_JOIN', 'RIGHT_JOIN', 'FULL_JOIN', 'CROSS_JOIN', 'SELF_JOIN', 'MULTIPLE_JOINS', 'ON_CLAUSE'] },
  { group: 'SQL functions', constructs: ['AGGREGATE', 'COUNT', 'SUM', 'AVG', 'MIN', 'MAX', 'LIKE', 'IN_OPERATOR', 'BETWEEN', 'IS_NULL', 'CASE'] },
  { group: 'Markup', constructs: ['HYPERLINK', 'IMAGE', 'HEADING', 'LIST', 'TABLE', 'FORM', 'CLASS_SELECTOR', 'ID_SELECTOR', 'PSEUDO_SELECTOR'] },
];
