#!/usr/bin/env python3
"""
Python static-analysis harness.

Parses code with the real CPython AST and reports the *constructs* it contains,
so the evaluator can answer questions like "did the student actually use a for
loop?" rather than trusting the printed output.

It also produces a normalised AST dump used for syntax-equivalence grading:
`[5,10,15]` and `[5, 10, 15]` dump identically, while `[5, 10]` does not.

Job:  {"mode": "analyze"|"compare", "source": str, "candidates": [str], "kind": "exec"|"eval"}
Out:  JSON on stdout.
"""
import ast
import json
import sys

CANONICAL = {
    "For": ["FOR_LOOP", "LOOP"],
    "AsyncFor": ["FOR_LOOP", "LOOP"],
    "While": ["WHILE_LOOP", "LOOP"],
    "If": ["IF"],
    "IfExp": ["TERNARY", "CONDITIONAL_EXPRESSION"],
    "List": ["LIST_LITERAL"],
    "Dict": ["DICT_LITERAL"],
    "Set": ["SET_LITERAL"],
    "Tuple": ["TUPLE_LITERAL"],
    "ListComp": ["LIST_COMPREHENSION", "COMPREHENSION"],
    "DictComp": ["DICT_COMPREHENSION", "COMPREHENSION"],
    "SetComp": ["SET_COMPREHENSION", "COMPREHENSION"],
    "GeneratorExp": ["GENERATOR_EXPRESSION", "COMPREHENSION"],
    "FunctionDef": ["FUNCTION_DEF"],
    "AsyncFunctionDef": ["FUNCTION_DEF"],
    "Lambda": ["LAMBDA"],
    "Return": ["RETURN"],
    "ClassDef": ["CLASS_DEF"],
    "Try": ["TRY_EXCEPT", "EXCEPTION_HANDLING"],
    "TryStar": ["TRY_EXCEPT", "EXCEPTION_HANDLING"],
    "ExceptHandler": ["EXCEPT"],
    "Raise": ["RAISE", "EXCEPTION_HANDLING"],
    "With": ["WITH"],
    "Assert": ["ASSERT"],
    "Import": ["IMPORT"],
    "ImportFrom": ["IMPORT"],
    "Assign": ["ASSIGNMENT"],
    "AnnAssign": ["ASSIGNMENT", "ANNOTATED_ASSIGNMENT"],
    "AugAssign": ["AUG_ASSIGN", "ASSIGNMENT"],
    "Break": ["BREAK"],
    "Continue": ["CONTINUE"],
    "Pass": ["PASS"],
    "Yield": ["YIELD"],
    "YieldFrom": ["YIELD"],
    "Global": ["GLOBAL"],
    "Nonlocal": ["NONLOCAL"],
    "Delete": ["DELETE"],
    "JoinedStr": ["FSTRING", "STRING_FORMATTING"],
    "Slice": ["SLICE"],
    "Subscript": ["SUBSCRIPT", "INDEXING"],
    "Starred": ["UNPACKING", "STAR_EXPRESSION"],
    "Compare": ["COMPARISON"],
    "BoolOp": ["BOOLEAN_OPERATOR"],
    "UnaryOp": ["UNARY_OPERATOR"],
    "BinOp": ["ARITHMETIC"],
    "Await": ["AWAIT"],
    "Match": ["MATCH"],
}

OPERATOR_CONSTRUCTS = {
    "Add": "OP_ADD", "Sub": "OP_SUB", "Mult": "OP_MUL", "Div": "OP_DIV",
    "FloorDiv": "OP_FLOORDIV", "Mod": "OP_MOD", "Pow": "OP_POW",
    "Eq": "OP_EQ", "NotEq": "OP_NEQ", "Lt": "OP_LT", "LtE": "OP_LTE",
    "Gt": "OP_GT", "GtE": "OP_GTE", "In": "OP_IN", "NotIn": "OP_NOT_IN",
    "Is": "OP_IS", "IsNot": "OP_IS_NOT", "And": "OP_AND", "Or": "OP_OR",
    "Not": "OP_NOT", "BitAnd": "OP_BITAND", "BitOr": "OP_BITOR", "BitXor": "OP_BITXOR",
}


class Analyzer(ast.NodeVisitor):
    def __init__(self):
        self.node_types = {}
        self.constructs = set()
        self.calls = []
        self.methods = []
        self.names = []
        self.attributes = []
        self.imports = []
        self.string_literals = []
        self.numbers = []
        self.loop_depth = 0
        self.max_loop_depth = 0
        self.func_depth = 0

    def generic_visit(self, node):
        name = type(node).__name__
        self.node_types[name] = self.node_types.get(name, 0) + 1
        for c in CANONICAL.get(name, []):
            self.constructs.add(c)
        if name in OPERATOR_CONSTRUCTS:
            self.constructs.add(OPERATOR_CONSTRUCTS[name])
        super().generic_visit(node)

    # ---- loops ------------------------------------------------------
    def _visit_loop(self, node):
        self.loop_depth += 1
        self.max_loop_depth = max(self.max_loop_depth, self.loop_depth)
        if self.loop_depth > 1:
            self.constructs.add("NESTED_LOOP")
        if getattr(node, "orelse", None):
            self.constructs.add("LOOP_ELSE")
        self.generic_visit(node)
        self.loop_depth -= 1

    def visit_For(self, node):
        self._visit_loop(node)

    def visit_While(self, node):
        self._visit_loop(node)

    # ---- conditionals -----------------------------------------------
    def visit_If(self, node):
        if node.orelse:
            # `elif` shows up as a single If inside orelse with matching lineno
            if len(node.orelse) == 1 and isinstance(node.orelse[0], ast.If) \
               and node.orelse[0].col_offset == node.col_offset:
                self.constructs.add("ELIF")
            else:
                self.constructs.add("IF_ELSE")
        for child in ast.walk(node):
            if isinstance(child, ast.If) and child is not node:
                self.constructs.add("NESTED_IF")
                break
        self.generic_visit(node)

    # ---- functions / classes ----------------------------------------
    def visit_FunctionDef(self, node):
        self._function(node)

    def visit_AsyncFunctionDef(self, node):
        self._function(node)

    def _function(self, node):
        args = node.args
        if args.defaults:
            self.constructs.add("DEFAULT_PARAMETER")
        if args.vararg:
            self.constructs.add("ARGS")
        if args.kwarg:
            self.constructs.add("KWARGS")
        if args.args:
            self.constructs.add("PARAMETER")
            if args.args[0].arg == "self":
                self.constructs.add("SELF_PARAMETER")
        if node.decorator_list:
            self.constructs.add("DECORATOR")
        if node.name == "__init__":
            self.constructs.add("CONSTRUCTOR")
        if self.func_depth > 0:
            self.constructs.add("NESTED_FUNCTION")
        self.constructs.add("DEF:" + node.name)
        self.func_depth += 1
        self.generic_visit(node)
        self.func_depth -= 1

    def visit_ClassDef(self, node):
        if node.bases:
            self.constructs.add("INHERITANCE")
        self.constructs.add("CLASS:" + node.name)
        for item in node.body:
            if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.constructs.add("METHOD_DEF")
        self.generic_visit(node)

    # ---- calls -------------------------------------------------------
    def visit_Call(self, node):
        func = node.func
        if isinstance(func, ast.Name):
            self.calls.append(func.id)
            self.constructs.add("CALL:" + func.id)
            if func.id == "print":
                self.constructs.add("PRINT")
            if func.id == "range":
                self.constructs.add("RANGE")
            if func.id in ("list", "dict", "set", "tuple"):
                self.constructs.add(func.id.upper() + "_CONSTRUCTOR")
        elif isinstance(func, ast.Attribute):
            self.methods.append(func.attr)
            self.constructs.add("METHOD:" + func.attr)
            if func.attr == "format":
                self.constructs.add("STRING_FORMATTING")
        if any(isinstance(a, ast.Starred) for a in node.args):
            self.constructs.add("STAR_ARGUMENT")
        if node.keywords:
            self.constructs.add("KEYWORD_ARGUMENT")
        self.generic_visit(node)

    def visit_Attribute(self, node):
        self.attributes.append(node.attr)
        self.generic_visit(node)

    def visit_Name(self, node):
        self.names.append(node.id)
        self.generic_visit(node)

    def visit_Assign(self, node):
        for t in node.targets:
            if isinstance(t, (ast.Tuple, ast.List)):
                self.constructs.add("UNPACKING")
                self.constructs.add("MULTIPLE_ASSIGNMENT")
        self.generic_visit(node)

    def visit_Import(self, node):
        for alias in node.names:
            self.imports.append(alias.name)
            self.constructs.add("IMPORT:" + alias.name.split(".")[0])
        self.generic_visit(node)

    def visit_ImportFrom(self, node):
        if node.module:
            self.imports.append(node.module)
            self.constructs.add("IMPORT:" + node.module.split(".")[0])
        self.generic_visit(node)

    def visit_Constant(self, node):
        if isinstance(node.value, str):
            self.string_literals.append(node.value)
        elif isinstance(node.value, bool):
            pass
        elif isinstance(node.value, (int, float)):
            self.numbers.append(node.value)
        self.generic_visit(node)

    def visit_Subscript(self, node):
        if isinstance(node.slice, ast.Slice):
            self.constructs.add("SLICING")
        self.generic_visit(node)

    def visit_Try(self, node):
        if node.finalbody:
            self.constructs.add("FINALLY")
        if node.orelse:
            self.constructs.add("TRY_ELSE")
        self.generic_visit(node)


def normalize_dump(tree):
    """AST dump that ignores formatting/whitespace but keeps structure + values."""
    return ast.dump(tree, annotate_fields=True, include_attributes=False)


def parse(source, kind):
    mode = "eval" if kind == "eval" else "exec"
    return ast.parse(source, mode=mode)


def try_parse_any(source):
    """Prefer expression parsing (for fragment equivalence), fall back to module.

    When both fail, the *statement* error is the useful one to report -- a
    student writing `for n in numbers` wants "expected ':'", not "invalid
    syntax" from the expression attempt.
    """
    try:
        return parse(source, "eval"), "eval"
    except SyntaxError:
        pass
    return parse(source, "exec"), "exec"


def analyze(source, kind="auto"):
    if kind == "auto":
        tree, used = try_parse_any(source)
    else:
        tree, used = parse(source, kind), kind
    an = Analyzer()
    an.visit(tree)
    body = getattr(tree, "body", None)
    statements = len(body) if isinstance(body, list) else 1
    return {
        "ok": True,
        "parsedAs": used,
        "statements": statements,
        "nodeTypes": an.node_types,
        "constructs": sorted(an.constructs),
        "calls": sorted(set(an.calls)),
        "methods": sorted(set(an.methods)),
        "names": sorted(set(an.names)),
        "attributes": sorted(set(an.attributes)),
        "imports": sorted(set(an.imports)),
        "strings": an.string_literals[:50],
        "numbers": an.numbers[:50],
        "maxLoopDepth": an.max_loop_depth,
        "dump": normalize_dump(tree),
    }


def syntax_error_payload(exc, source):
    return {
        "ok": False,
        "error": {
            "type": "SyntaxError",
            "message": exc.msg if isinstance(exc, SyntaxError) else str(exc),
            "line": getattr(exc, "lineno", None),
            "offset": getattr(exc, "offset", None),
            "text": (getattr(exc, "text", None) or "").rstrip("\n"),
        },
    }


def main():
    job = json.loads(sys.stdin.read() or "{}")
    mode = job.get("mode", "analyze")
    source = job.get("source", "")
    kind = job.get("kind", "auto")

    try:
        if mode == "compare":
            student, skind = try_parse_any(source)
            student_dump = normalize_dump(student)
            matches = []
            for cand in job.get("candidates", []):
                try:
                    ctree, _ = try_parse_any(cand)
                    matches.append(normalize_dump(ctree) == student_dump)
                except SyntaxError:
                    matches.append(False)
            result = analyze(source, kind)
            result["equivalent"] = any(matches)
            result["matches"] = matches
            print(json.dumps(result))
            return
        print(json.dumps(analyze(source, kind)))
    except SyntaxError as exc:
        print(json.dumps(syntax_error_payload(exc, source)))
    except Exception as exc:  # pragma: no cover - defensive
        print(json.dumps({"ok": False, "error": {"type": type(exc).__name__, "message": str(exc)}}))


if __name__ == "__main__":
    main()
