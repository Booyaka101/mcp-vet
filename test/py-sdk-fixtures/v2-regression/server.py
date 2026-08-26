"""A fully v2-ported server that still speaks removed protocol surface.

0.11.0's Python matcher table only knew v1 vocabulary; this fixture locks in
that the pre-existing protocol rules fire on v2 module paths too (mcp/server/
sse.py is still a real module in v2.1.1) and are never gated behind the v1/v2
SDK detection.
"""
from mcp.server.mcpserver import MCPServer
from mcp.server.sse import SseServerTransport  # SSE_TRANSPORT_DEPRECATED

server = MCPServer("v2-legacy-protocol")


def not_found():
    return {"error": {"code": -32002, "message": "Resource not found"}}  # ERROR_CODE_32002


def dispatch(request):
    if request["method"] == "logging/setLevel":  # LOGGING_SETLEVEL_REMOVED
        return {}
    return None
