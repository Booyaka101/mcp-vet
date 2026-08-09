# A FastMCP server run over the deprecated HTTP+SSE transport. No legacy class
# or module import — the signals are the literal transport="sse" kwarg (high)
# and the sse_app() surface (medium). Expected: exactly two
# SSE_TRANSPORT_DEPRECATED findings.

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("weather")


@mcp.tool()
async def get_forecast(city: str) -> str:
    return f"Forecast for {city}"


app = mcp.sse_app()

if __name__ == "__main__":
    mcp.run(transport="sse")
