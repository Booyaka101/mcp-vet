"""A v1 server in a project that DECLARES v1 — the PY_SDK_V1 group stays
suppressed and the report carries one informational line naming v2.1.1."""
from datetime import timedelta

from mcp.server.fastmcp import FastMCP
from mcp.shared.exceptions import McpError

mcp = FastMCP("v1-app")


@mcp.tool()
async def report(x: int) -> str:
    ctx = mcp.get_context()
    await ctx.report_progress(1, 2, timeout=timedelta(seconds=5))
    if x < 0:
        raise McpError("negative")
    return str(x)
