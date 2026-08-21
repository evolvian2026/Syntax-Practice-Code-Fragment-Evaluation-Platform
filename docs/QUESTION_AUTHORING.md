# Authoring questions

A question is data. Nothing in the application changes when you add one — use
the admin question builder, the import endpoint, or a seed file.

## The template

Starter code must contain the marker `{{STUDENT_CODE}}` exactly where the
student's fragment belongs:

```python
numbers = [1, 2, 3, 4, 5]

{{STUDENT_CODE}}

print("Done")
```

Optionally add `{{SETUP_CODE}}` where per-test data should be injected, so
hidden tests can change the inputs:

```python
{{SETUP_CODE}}

{{STUDENT_CODE}}
```

with test cases supplying `setupCode: "numbers = [1, 2, 3]"` and
`setupCode: "numbers = []"`. Students see the *public* test's setup rendered in
the read-only context; the marker itself is never shown.

The marker may sit inside an indented block — a multi-line fragment is
re-indented to match:

```python
if len(numbers) > 0:
    {{STUDENT_CODE}}
```

`hiddenPrefix` and `hiddenSuffix` wrap the whole template with code the student
never sees — useful for setup and for assertions that run after the fragment.

## Fields

| Field | Notes |
| ----- | ----- |
| `qid` | Stable id (`PY-LOOPS-0007`). Omit to auto-generate. Import upserts by `qid`. |
| `language`, `topic`, `subtopic` | Slugs that must already exist. |
| `difficulty` | `Easy` / `Medium` / `Hard`. |
| `questionType` | `FILL_CODE`, `COMPLETE_STATEMENT`, `COMPLETE_CONDITION`, `COMPLETE_LOOP`, `COMPLETE_SQL_CLAUSE`, `CHOOSE_AND_WRITE`, `FIX_SYNTAX`, `PREDICT_OUTPUT`, `IDENTIFY_SYNTAX`. Presentation only. |
| `evaluationType` | `OUTPUT`, `SYNTAX`, `AST`, `SQL_RESULT`, `VALUE`, `STATIC`, `TEXT`, `COMPOSITE`. Decides how it is graded. |
| `title`, `statement`, `instructions`, `learningObjective` | Shown to the student. |
| `starterCode`, `hiddenPrefix`, `hiddenSuffix` | The template. |
| `editablePrefill`, `editablePlaceholder` | Contents and placeholder of the editable region. `FIX_SYNTAX` questions prefill the broken code. |
| `dataset` | SQL sandbox dataset slug. Required for `SQL_RESULT`. |
| `requiredConstructs`, `forbiddenConstructs` | The teaching rule. |
| `requiredKeywords`, `forbiddenKeywords` | Cheap textual guards. |
| `options` | Choices for `CHOOSE_AND_WRITE`. |
| `config` | Evaluator extras (below). |
| `maxCodeLength`, `timeLimitMs`, `memoryLimitMb`, `maxScore` | Limits. |
| `testCases`, `hints`, `solutions`, `explanation`, `tags` | The rest. |
| `status` | `draft`, `published` or `archived`. |

## Constructs

Required constructs are what make this a syntax platform rather than an
output-checker. Common ids:

```
FOR_LOOP  WHILE_LOOP  NESTED_LOOP  BREAK  CONTINUE  RANGE
IF  IF_ELSE  ELIF  NESTED_IF  TERNARY  COMPARISON  OP_MOD
LIST_LITERAL  DICT_LITERAL  SET_LITERAL  TUPLE_LITERAL  SLICING  SUBSCRIPT
LIST_COMPREHENSION  DICT_COMPREHENSION  GENERATOR_EXPRESSION
FUNCTION_DEF  LAMBDA  RETURN  DEFAULT_PARAMETER  ARGS  KWARGS
CLASS_DEF  CONSTRUCTOR  INHERITANCE  METHOD_DEF  SELF_PARAMETER
TRY_EXCEPT  FINALLY  RAISE
PRINT  FSTRING  STRING_FORMATTING
SELECT  WHERE  GROUP_BY  HAVING  ORDER_BY  LIMIT  DISTINCT  SUBQUERY
JOIN  INNER_JOIN  LEFT_JOIN  RIGHT_JOIN  FULL_JOIN  CROSS_JOIN  SELF_JOIN  MULTIPLE_JOINS
```

Dynamic forms: `METHOD:append`, `CALL:len`, `DEF:greet`, `CLASS:Dog`,
`IMPORT:math`, `TAG:a`, `ATTR:href`, `PROPERTY:font-weight`, `SELECTOR:.card`.

`ANY:FOR_LOOP|WHILE_LOOP` accepts either. `GET /api/practice/constructs` returns
the grouped list the builder shows.

Set `config.constructMessage` to override the feedback shown when the rule fails:

```json
{ "constructMessage": "Output is correct, but this question is practising the FOR loop." }
```

## Test cases

```json
{
  "visibility": "public",
  "name": "Empty list",
  "setupCode": "numbers = []",
  "stdin": null,
  "expectedOutput": "Done",
  "matcher": "trimmed",
  "weight": 1
}
```

Matchers: `trimmed` (default), `exact`, `normalized`, `contains`, `regex`,
`unordered_rows`.

Hidden tests run only on Submit and are never revealed — they are what stops a
student hardcoding the visible answer. For SQL questions, a hidden test's
`setupCode` is extra **INSERT** statements seeded before the query runs, so a
query that hardcodes ids fails.

## Per-evaluation-type requirements

| Type | Needs |
| ---- | ----- |
| `OUTPUT`, `COMPOSITE`, `VALUE` | at least one test case |
| `SQL_RESULT` | a `dataset` and at least one test case |
| `SYNTAX` | at least one accepted solution, or `config.acceptRegex` |
| `AST` | at least one required construct |
| `STATIC` | `config.html` or `config.css` rules |
| `TEXT` | `config.acceptedText`, or test cases whose expected output is the answer |

## config

```jsonc
{
  "acceptRegex": ["^for\\s+\\w+\\s+in\\s+numbers:"],   // SYNTAX fallback
  "acceptedText": ["2\n4\n6"],                         // TEXT answers
  "caseSensitive": false,
  "sqlOrdered": true,                                  // row order matters
  "constructMessage": "…",
  "html": { "selector": "a", "minCount": 1,
            "attributes": { "href": "https://google.com" },
            "textEquals": "Google" },
  "css":  { "selector": ".highlight",
            "declarations": { "background-color": "yellow" },
            "requireProperties": ["display"] }
}
```

## Worked example

```json
{
  "qid": "PY-LOOPS-0001",
  "language": "python", "topic": "loops", "subtopic": "for",
  "difficulty": "Easy",
  "questionType": "COMPLETE_LOOP", "evaluationType": "OUTPUT",
  "title": "Print every number in a list",
  "statement": "Write a `for` loop that prints every number in `numbers`, one per line.",
  "instructions": "The list already exists. Write only the loop.",
  "starterCode": "{{SETUP_CODE}}\n\n{{STUDENT_CODE}}\n\nprint(\"Done\")",
  "editablePlaceholder": "for n in numbers:\n    print(n)",
  "requiredConstructs": ["FOR_LOOP", "PRINT"],
  "config": { "constructMessage": "Output is correct, but this question is practising the FOR loop." },
  "testCases": [
    { "visibility": "public", "setupCode": "numbers = [1, 2, 3, 4, 5]", "expectedOutput": "1\n2\n3\n4\n5\nDone" },
    { "visibility": "hidden", "setupCode": "numbers = [42]", "expectedOutput": "42\nDone" },
    { "visibility": "hidden", "setupCode": "numbers = []",   "expectedOutput": "Done" }
  ],
  "hints": [
    { "body": "Which loop is used to walk through every item of a list?", "penalty": 10 },
    { "body": "The loop header starts with `for` and ends with a colon.", "penalty": 15 },
    { "body": "Try `for item in numbers:` with an indented `print(item)`.", "penalty": 20 }
  ],
  "solutions": [
    { "code": "for n in numbers:\n    print(n)", "isPrimary": true, "note": "Reference solution" },
    { "code": "for number in numbers:\n    print(number)", "isPrimary": false }
  ],
  "explanation": "A `for` loop walks through each item of a collection.",
  "tags": ["loops", "for"],
  "status": "published"
}
```

## Before publishing

1. **Preview & test** in the builder — load the reference solution and confirm
   it scores 100.
2. Try a wrong-construct answer that produces the right output and confirm it is
   rejected.
3. Confirm the hidden tests reject a hardcoded answer.
4. `POST /api/admin/questions/:id/verify` re-runs the reference solution against
   a saved question — useful in CI after bulk edits.

Seeded questions are verified automatically: `npm run seed` executes each
reference solution and derives the expected output from it, so a seeded question
can never ship with an expectation its own solution fails.
