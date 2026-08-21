import { OTHER_LANGUAGES } from './other-languages.js';
import { PYTHON_BASICS } from './python-basics.js';
import { PYTHON_CONDITIONS } from './python-conditions.js';
import { PYTHON_FUNCTIONS } from './python-functions.js';
import { PYTHON_LISTS } from './python-lists.js';
import { PYTHON_LOOPS } from './python-loops.js';
import { QUESTION_TYPES } from './question-types.js';
import { SQL_BASICS } from './sql-basics.js';
import { SQL_JOINS } from './sql-joins.js';
import type { SeedQuestion } from './types.js';

/** §31 — the seeded question bank. */
export const ALL_QUESTIONS: SeedQuestion[] = [
  ...PYTHON_BASICS,      // variables (10) + basic syntax (5)
  ...PYTHON_LISTS,       // 10
  ...PYTHON_CONDITIONS,  // 10
  ...PYTHON_LOOPS,       // 15
  ...PYTHON_FUNCTIONS,   // 10
  ...SQL_BASICS,         // SELECT/WHERE/ORDER BY/GROUP BY/HAVING (25)
  ...SQL_JOINS,          // INNER/LEFT/multiple joins (15)
  ...QUESTION_TYPES,     // remaining question types + collections/OOP/exceptions
  ...OTHER_LANGUAGES,    // Java, C, C++, JavaScript, HTML, CSS
];

export {
  OTHER_LANGUAGES, PYTHON_BASICS, PYTHON_CONDITIONS, PYTHON_FUNCTIONS,
  PYTHON_LISTS, PYTHON_LOOPS, QUESTION_TYPES, SQL_BASICS, SQL_JOINS,
};
