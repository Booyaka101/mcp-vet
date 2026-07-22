#!/usr/bin/env python3
"""Bundled Python AST scanner for mcp-vet.

Reads a newline-separated list of file paths on stdin, parses each with
``ast.parse`` and emits normalized tokens the Node rule engine consumes. Output
is a single JSON object mapping each file path to its list of tokens:

    {"/abs/path.py": [{"kind": "string", "value": "...", "line": 12, "col": 5}, ...]}

Token kinds match the TypeScript analyzer: "string", "number", "name", "key".
Capability keys carry ``inCapabilities`` (structurally inside a ``capabilities``
object/kwarg) and ``initialize`` strings carry ``registration`` (used like a
registered method name), so the engine can assign confidence uniformly.
"""
import ast
import json
import re
import sys

sys.setrecursionlimit(20000)

CAP = {"roots", "sampling", "logging"}
INIT_STRINGS = {"initialize", "notifications/initialized"}
HANDLERISH = re.compile(r"handler|handle|register|route|request|notification|method|^on$", re.I)
CAPS_RE = re.compile(r"capabilit", re.I)
METHODISH = ("method", "type")


def _func_mentions_caps(func):
    """True when a call target names a capabilities container, e.g.
    ClientCapabilities(...) / ServerCapabilities(...) — the Python SDK's way of
    declaring capabilities, so `roots=`/`sampling=`/`logging=` kwargs inside are
    structural (high confidence), not merely near the word 'capabilities'."""
    name = ""
    if isinstance(func, ast.Attribute):
        name = func.attr
    elif isinstance(func, ast.Name):
        name = func.id
    return bool(CAPS_RE.search(name))


def _is_int_constant(node):
    return (
        isinstance(node, ast.Constant)
        and isinstance(node.value, int)
        and not isinstance(node.value, bool)
    )


def _byte_to_char_col(line, byte_off):
    """Convert a CPython ``ast`` UTF-8 *byte* col_offset to a 1-based *character*
    column, matching ts-morph and JS string indexing. col_offset always lands on
    a character boundary (start of a node), so the truncated decode is clean."""
    if line is None:
        return byte_off + 1
    prefix = line.encode("utf-8", "surrogatepass")[:byte_off]
    return len(prefix.decode("utf-8", "ignore")) + 1


def _mentions_method(o):
    if isinstance(o, ast.Attribute):
        return o.attr.lower() in METHODISH
    if isinstance(o, ast.Name):
        return o.id.lower() in METHODISH
    if isinstance(o, ast.Subscript):
        s = o.slice
        if isinstance(s, ast.Index):  # py<3.9 compatibility
            s = s.value
        if isinstance(s, ast.Constant) and isinstance(s.value, str):
            return s.value.lower() in METHODISH
    return False


def _func_is_handlerish(func):
    name = ""
    if isinstance(func, ast.Attribute):
        name = func.attr
    elif isinstance(func, ast.Name):
        name = func.id
    return bool(HANDLERISH.search(name))


def _is_registration(node):
    p = getattr(node, "parent", None)
    if p is None:
        return False
    if isinstance(p, ast.Compare):
        for o in [p.left, *p.comparators]:
            if o is not node and _mentions_method(o):
                return True
    if isinstance(p, ast.Call) and node in p.args and _func_is_handlerish(p.func):
        return True
    if isinstance(p, ast.Dict):
        try:
            idx = p.values.index(node)
        except ValueError:
            idx = -1
        if idx >= 0:
            k = p.keys[idx]
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                if k.value.lower() in ("method", "type", "name"):
                    return True
    return False


class Scanner:
    def __init__(self, lines):
        self.tokens = []
        self.lines = lines

    def _col(self, node):
        c = getattr(node, "col_offset", None)
        if not isinstance(c, int):
            return None
        ln = getattr(node, "lineno", None)
        line = self.lines[ln - 1] if isinstance(ln, int) and 1 <= ln <= len(self.lines) else None
        return _byte_to_char_col(line, c)

    def emit_for(self, node, in_caps):
        if isinstance(node, ast.Constant):
            if isinstance(node.value, str):
                tok = {"kind": "string", "value": node.value, "line": node.lineno, "col": self._col(node)}
                if node.value in CAP:
                    tok["inCapabilities"] = in_caps
                if node.value in INIT_STRINGS:
                    tok["registration"] = _is_registration(node)
                self.tokens.append(tok)
            elif _is_int_constant(node):
                self.tokens.append(
                    {"kind": "number", "value": str(node.value), "line": node.lineno, "col": self._col(node)}
                )
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and _is_int_constant(node.operand):
            # Anchor negative numbers at the '-' (the UnaryOp), matching ts-morph.
            self.tokens.append(
                {"kind": "number", "value": str(-node.operand.value), "line": node.lineno, "col": self._col(node)}
            )
        elif isinstance(node, ast.Name):
            self.tokens.append({"kind": "name", "value": node.id, "line": node.lineno, "col": self._col(node)})
        elif isinstance(node, ast.Attribute):
            self.tokens.append({"kind": "name", "value": node.attr, "line": node.lineno, "col": self._col(node)})

    def visit(self, node, in_caps):
        self.emit_for(node, in_caps)

        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if k is not None:
                    self.visit(k, in_caps)
                    if isinstance(k, ast.Constant) and isinstance(k.value, str):
                        tok = {"kind": "key", "value": k.value, "line": k.lineno, "col": self._col(k)}
                        if k.value in CAP:
                            tok["inCapabilities"] = in_caps
                        self.tokens.append(tok)
                child_caps = in_caps or (isinstance(k, ast.Constant) and k.value == "capabilities")
                self.visit(v, child_caps)
            return

        if isinstance(node, ast.Call):
            # A call to ClientCapabilities(...) / ServerCapabilities(...) is itself
            # a capabilities container — its args/kwargs are structurally in-caps.
            caps_ctx = in_caps or _func_mentions_caps(node.func)
            self.visit(node.func, in_caps)
            for a in node.args:
                self.visit(a, caps_ctx)
            for kw in node.keywords:
                if kw.arg is not None:
                    line = getattr(kw, "lineno", None) or getattr(kw.value, "lineno", 0)
                    tok = {"kind": "key", "value": kw.arg, "line": line, "col": self._col(kw)}
                    if kw.arg in CAP:
                        tok["inCapabilities"] = caps_ctx
                    self.tokens.append(tok)
                child_caps = caps_ctx or (kw.arg == "capabilities")
                self.visit(kw.value, child_caps)
            return

        for child in ast.iter_child_nodes(node):
            self.visit(child, in_caps)


def scan_source(src):
    try:
        tree = ast.parse(src)
    except (SyntaxError, ValueError):
        return []
    for n in ast.walk(tree):
        for c in ast.iter_child_nodes(n):
            c.parent = n
    scanner = Scanner(src.split("\n"))
    try:
        scanner.visit(tree, False)
    except RecursionError:
        pass
    return scanner.tokens


def main():
    data = sys.stdin.read()
    files = [line for line in data.splitlines() if line.strip()]
    result = {}
    for f in files:
        try:
            # utf-8-sig strips a leading BOM (common on Windows-authored files);
            # a BOM left in the source makes ast.parse raise SyntaxError.
            with open(f, "r", encoding="utf-8-sig", errors="replace") as fh:
                src = fh.read()
        except OSError:
            result[f] = []
            continue
        result[f] = scan_source(src)
    sys.stdout.write(json.dumps(result))


if __name__ == "__main__":
    main()
