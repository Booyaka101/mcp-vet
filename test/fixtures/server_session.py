"""Fixture: Python MCP server session + handshake + error code.

Triggers: MCP_SESSION_ID (rule 1), INITIALIZE_HANDLER (rule 2),
ERROR_CODE_32002 (rule 3).
"""

SESSION_HEADER = "Mcp-Session-Id"  # BREAKING: header removed 2026-07-28
RESOURCE_MISSING = -32002  # BREAKING: must become -32602


def handle_request(request, headers):
    mcpSessionId = headers.get("mcp-session-id")  # BREAKING: variable + header key
    if request["method"] == "initialize":  # BREAKING: initialize handshake removed
        return {"protocolVersion": "2025-11-25", "capabilities": {}}
    if request["method"] == "notifications/initialized":  # BREAKING
        return None
    if mcpSessionId is None:
        return {"error": {"code": -32002, "message": "missing"}}  # BREAKING
    return {"error": {"code": RESOURCE_MISSING, "message": "gone"}}  # BREAKING


# Clean code below — should NOT be flagged.
def add(a, b):
    return a + b


def not_found():
    return {"error": {"code": -32601, "message": "method not found"}}
