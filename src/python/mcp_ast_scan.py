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
TRANSPORTISH = re.compile(r"transport|client", re.I)
ERRORISH = re.compile(r"error", re.I)
METHODISH = ("method", "type")
SESSION_KWARGS = ("session_id", "sessionId")
# SSE-resumability option kwargs (SEP-2575 removal) — transport context only.
SSE_KWARGS = (
    "event_store", "eventStore",
    "resumption_token", "resumptionToken",
    "on_resumption_token", "onresumptiontoken",
)
# Credential-store shapes (SEP-2352): a persist-ish call/subscript-assign whose
# value side carries client_id/client_secret. The KEY is classified — an
# issuer-derived key is the migrated form; a bare string constant or a
# server/resource-URL variable violates the issuer-keying MUST.
STORE_VERBS = re.compile(r"^(set|setitem|put|add|write|__setitem__)$", re.I)
STOREISH = re.compile(r"save|store|persist|upsert|cache|credential", re.I)
CREDENTIALISH = re.compile(r"client_secret|client_id|credential", re.I)
SERVERISH_KEY = re.compile(r"server|url|uri|resource|endpoint|host|base|target|mcp", re.I)
ISSUERISH = re.compile(r"\biss\b|issuer", re.I)
# A server-side ACCESS-TOKEN cache is not a client credential store: SEP-2352 is
# about the credentials a client obtains from registration. `self.tokens[tok] =
# AccessToken(..., client_id=...)` mentions client_id but is not that.
TOKENISH = re.compile(r"(^|[._])tokens?([._]|$)|access_?token|oauth_?token|refresh_?token|bearer_?token", re.I)
CLIENT_SECRETISH = re.compile(r"client_secret", re.I)


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


def _is_registration(node, strict=False):
    """Method-registration context for a string literal. ``strict`` drops the
    ``"name"`` dict-key form — a tool literally *named* "ping" is legal, so
    PING_REMOVED only accepts method/type keys, comparisons and handler calls."""
    p = getattr(node, "parent", None)
    if p is None:
        return False
    if isinstance(p, ast.Compare):
        for o in [p.left, *p.comparators]:
            if o is not node and _mentions_method(o):
                return True
    if isinstance(p, ast.Call) and node in p.args and _func_is_handlerish(p.func):
        # strict: register_tool("ping", ...) registers a TOOL NAME, not a method.
        if not (strict and re.search(r"tool|prompt|resource", _func_name(p.func), re.I)):
            return True
    if isinstance(p, ast.Dict):
        try:
            idx = p.values.index(node)
        except ValueError:
            idx = -1
        if idx >= 0:
            k = p.keys[idx]
            if isinstance(k, ast.Constant) and isinstance(k.value, str):
                keys = ("method", "type") if strict else ("method", "type", "name")
                if k.value.lower() in keys:
                    return True
    return False


def _number_value(node):
    """The signed int value of a Constant / UnaryOp(-Constant), else None."""
    if _is_int_constant(node):
        return node.value
    if isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and _is_int_constant(node.operand):
        return -node.operand.value
    return None


def _is_error_code_context(node):
    """Is this numeric literal in a JSON-RPC error `code` position? Accepts the
    value of a "code" dict key, a code= kwarg, an argument to an *Error*(...)
    call, or a comparison against something named code. Guards
    ERROR_CODE_RENUMBERED (-32000..-32019 stays implementation-defined)."""
    p = getattr(node, "parent", None)
    if p is None:
        return False
    if isinstance(p, ast.Dict):
        try:
            idx = p.values.index(node)
        except ValueError:
            idx = -1
        if idx >= 0:
            k = p.keys[idx]
            if isinstance(k, ast.Constant) and k.value == "code":
                return True
    if isinstance(p, ast.keyword) and p.arg == "code":
        return True
    if isinstance(p, ast.Call) and node in p.args and ERRORISH.search(_func_name(p.func)):
        return True
    if isinstance(p, ast.Compare):
        for o in [p.left, *p.comparators]:
            if o is not node:
                name = o.attr if isinstance(o, ast.Attribute) else (o.id if isinstance(o, ast.Name) else "")
                if name and "code" in name.lower():
                    return True
                if isinstance(o, ast.Subscript):
                    s = o.slice
                    if isinstance(s, ast.Index):  # py<3.9 compatibility
                        s = s.value
                    if isinstance(s, ast.Constant) and s.value == "code":
                        return True
    return False


def _func_name(func):
    if isinstance(func, ast.Attribute):
        return func.attr
    if isinstance(func, ast.Name):
        return func.id
    return ""


def _base_name(node):
    """Leftmost usable name of an attribute chain (`transport.session_id` -> 'transport')."""
    if isinstance(node, ast.Attribute):
        return _base_name(node.value) or node.attr
    if isinstance(node, ast.Name):
        return node.id
    return ""


def _subtree_mentions_credentials(node):
    """True when a value expression carries client_id/client_secret/credential
    in any name, attribute, kwarg, or string (incl. dict keys)."""
    for n in ast.walk(node):
        if isinstance(n, ast.Name) and CREDENTIALISH.search(n.id):
            return True
        if isinstance(n, ast.Attribute) and CREDENTIALISH.search(n.attr):
            return True
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and CREDENTIALISH.search(n.value):
            return True
        if isinstance(n, ast.keyword) and n.arg and CREDENTIALISH.search(n.arg):
            return True
    return False


def _mentions_client_secret(node):
    for n in ast.walk(node):
        if isinstance(n, ast.Name) and CLIENT_SECRETISH.search(n.id):
            return True
        if isinstance(n, ast.Attribute) and CLIENT_SECRETISH.search(n.attr):
            return True
        if isinstance(n, ast.Constant) and isinstance(n.value, str) and CLIENT_SECRETISH.search(n.value):
            return True
        if isinstance(n, ast.keyword) and n.arg and CLIENT_SECRETISH.search(n.arg):
            return True
    return False


def _looks_like_token_store(base, value_node):
    """True for a token cache rather than a persisted-registration-credential
    store. A client_secret in the value settles it the other way — only
    registration hands one out."""
    if _mentions_client_secret(value_node):
        return False
    if TOKENISH.search(base or ""):
        return True
    if isinstance(value_node, ast.Call) and TOKENISH.search(_func_name(value_node.func)):
        return True
    return False


def _expr_text(node):
    """Rough textual name of a key expression, for issuer/server classification."""
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return _expr_text(node.value) + "." + node.attr
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    return ""


def _collect_aliases(tree):
    """Map local alias -> canonical imported name, so `from mcp.types import
    RootsCapability as RC` still flags `RC()` usage sites (and the import line)."""
    aliases = {}
    for n in ast.walk(tree):
        if isinstance(n, (ast.Import, ast.ImportFrom)):
            for a in n.names:
                if a.asname and a.asname != a.name:
                    aliases[a.asname] = a.name.rsplit(".", 1)[-1]
    return aliases


class Scanner:
    def __init__(self, lines, aliases=None):
        self.tokens = []
        self.lines = lines
        self.aliases = aliases or {}

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
                # 'ping' uses the STRICT registration check (a tool named "ping"
                # is legal and must not count as MCP method registration).
                if node.value == "ping":
                    tok["registration"] = _is_registration(node, strict=True)
                self.tokens.append(tok)
            elif _is_int_constant(node):
                tok = {"kind": "number", "value": str(node.value), "line": node.lineno, "col": self._col(node)}
                if _is_error_code_context(node):
                    tok["errorCode"] = True
                self.tokens.append(tok)
        elif isinstance(node, ast.UnaryOp) and isinstance(node.op, ast.USub) and _is_int_constant(node.operand):
            # Anchor negative numbers at the '-' (the UnaryOp), matching ts-morph.
            tok = {"kind": "number", "value": str(-node.operand.value), "line": node.lineno, "col": self._col(node)}
            if _is_error_code_context(node):
                tok["errorCode"] = True
            self.tokens.append(tok)
        elif isinstance(node, ast.Name):
            self.tokens.append({"kind": "name", "value": node.id, "line": node.lineno, "col": self._col(node)})
            # An aliased identifier also counts as its canonical imported name.
            original = self.aliases.get(node.id)
            if original:
                self.tokens.append({"kind": "name", "value": original, "line": node.lineno, "col": self._col(node)})
        elif isinstance(node, ast.Attribute):
            tok = {"kind": "name", "value": node.attr, "line": node.lineno, "col": self._col(node)}
            # `transport.session_id` read = client-side session ownership.
            if node.attr in SESSION_KWARGS and TRANSPORTISH.search(_base_name(node.value)):
                tok["clientSession"] = True
            self.tokens.append(tok)
        elif isinstance(node, (ast.Import, ast.ImportFrom)):
            # Surface imported names so `from mcp.types import X as Y` still
            # flags the import line even though usages only say `Y`.
            for a in node.names:
                line = getattr(a, "lineno", None) or node.lineno
                self.tokens.append(
                    {"kind": "name", "value": a.name.rsplit(".", 1)[-1], "line": line, "col": self._col(a) or self._col(node)}
                )
                # `import mcp.server.sse` — the dotted path itself is a signal
                # (module-path rules match on it), so surface it whole too.
                if "." in a.name:
                    self.tokens.append(
                        {"kind": "string", "value": a.name, "line": line, "col": self._col(a) or self._col(node)}
                    )
            # `from mcp.server.sse import X` — surface the module path, which
            # otherwise never appears as a token (it is not a quoted string).
            if isinstance(node, ast.ImportFrom) and node.module and "." in node.module:
                self.tokens.append(
                    {"kind": "string", "value": node.module, "line": node.lineno, "col": self._col(node)}
                )

    def _maybe_cred_key(self, key_node):
        """Emit a credKey token when `key_node` is clearly NOT issuer-derived.
        Computed keys (calls, f-strings) are skipped — a documented miss."""
        s = key_node
        if isinstance(s, ast.Index):  # py<3.9 compatibility
            s = s.value
        text = _expr_text(s)
        if not text or ISSUERISH.search(text):
            return
        # `data["client_secret"] = ...` builds a token-REQUEST body; the key is
        # the OAuth field name, not a store key. Never a credential store.
        if CREDENTIALISH.search(text):
            return
        if isinstance(s, ast.Constant) and isinstance(s.value, str):
            self.tokens.append(
                {"kind": "string", "value": s.value, "line": s.lineno, "col": self._col(s), "credKey": True}
            )
        elif isinstance(s, (ast.Name, ast.Attribute)) and SERVERISH_KEY.search(text):
            self.tokens.append(
                {"kind": "name", "value": text, "line": s.lineno, "col": self._col(s), "credKey": True}
            )

    def visit(self, node, in_caps):
        self.emit_for(node, in_caps)

        # Credential-store subscript assignment: store[server_url] = {...client_secret...}
        if isinstance(node, ast.Assign):
            for tgt in node.targets:
                if isinstance(tgt, ast.Subscript):
                    base = _expr_text(tgt.value)
                    if _subtree_mentions_credentials(node.value) or CREDENTIALISH.search(base):
                        if not _looks_like_token_store(base, node.value):
                            self._maybe_cred_key(tgt.slice)

        if isinstance(node, ast.Dict):
            for k, v in zip(node.keys, node.values):
                if k is not None:
                    self.visit(k, in_caps)
                    if isinstance(k, ast.Constant) and isinstance(k.value, str):
                        tok = {"kind": "key", "value": k.value, "line": k.lineno, "col": self._col(k)}
                        if k.value in CAP:
                            tok["inCapabilities"] = in_caps
                        # {"transport": "sse"} / {"event": "endpoint"} — the
                        # literal forms of the HTTP+SSE transport (SEP-2596).
                        if isinstance(v, ast.Constant) and v.value == "sse" and re.search(r"transport", k.value, re.I):
                            tok["transportSse"] = True
                        if isinstance(v, ast.Constant) and v.value == "endpoint" and k.value == "event":
                            tok["sseEndpointEvent"] = True
                        self.tokens.append(tok)
                child_caps = in_caps or (isinstance(k, ast.Constant) and k.value == "capabilities")
                self.visit(v, child_caps)
            return

        if isinstance(node, ast.Call):
            # Credential-store call: store.set(key, creds) / save_credentials(key, ...)
            fname = _func_name(node.func)
            if (STORE_VERBS.match(fname) or STOREISH.search(fname)) and len(node.args) >= 2:
                value_side = node.args[1:] + [kw.value for kw in node.keywords]
                if STOREISH.search(fname) and "credential" in fname.lower():
                    creds = True
                else:
                    creds = any(_subtree_mentions_credentials(a) for a in value_side)
                if creds and not _looks_like_token_store(fname, node):
                    self._maybe_cred_key(node.args[0])
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
                    # `session_id=` into a transport/client factory = the client
                    # resuming/owning a session. `session_id=None` is migrated.
                    if kw.arg in SESSION_KWARGS and TRANSPORTISH.search(_func_name(node.func)):
                        if isinstance(kw.value, ast.Constant) and kw.value.value is None:
                            tok["benign"] = True
                        else:
                            tok["clientSession"] = True
                    # SSE-resumability options handed to a transport factory
                    # (event_store=..., resumption_token=...) — removed 2026-07-28.
                    if kw.arg in SSE_KWARGS and TRANSPORTISH.search(_func_name(node.func)):
                        tok["transportCtx"] = True
                    # mcp.run(transport="sse") / send(event="endpoint") — the
                    # literal kwarg forms of the HTTP+SSE transport (SEP-2596).
                    if isinstance(kw.value, ast.Constant) and kw.value.value == "sse" and re.search(r"transport", kw.arg, re.I):
                        tok["transportSse"] = True
                    if isinstance(kw.value, ast.Constant) and kw.value.value == "endpoint" and kw.arg == "event":
                        tok["sseEndpointEvent"] = True
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
    scanner = Scanner(src.split("\n"), _collect_aliases(tree))
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
