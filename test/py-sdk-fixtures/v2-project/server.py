from mcp.server.fastmcp import FastMCP

mcp = FastMCP("demo")


@mcp.tool()
async def report(x: int) -> str:
    ctx = mcp.get_context()
    await ctx.report_progress(1, 2)
    return str(x)
