# A correctly migrated FastMCP server on Streamable HTTP. It accepts
# text/event-stream responses (Streamable HTTP frames POST responses as SSE)
# but runs a single-endpoint transport — the HTTP+SSE rule must NOT fire.

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("weather")

ACCEPT = "application/json, text/event-stream"


@mcp.tool()
async def get_forecast(city: str) -> str:
    return f"Forecast for {city}"


if __name__ == "__main__":
    mcp.run(transport="streamable-http")
