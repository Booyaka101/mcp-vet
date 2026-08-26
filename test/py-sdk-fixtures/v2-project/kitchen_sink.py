"""One instance of every PY_SDK_V1 rule, in a project whose mcp resolves to v2."""
import os
import httpx  # PY_SDK_V1_HTTPX — mcp v2 no longer installs httpx
from datetime import timedelta

from mcp import Client
from mcp.server.fastmcp import FastMCP  # PY_SDK_V1_FASTMCP
from mcp.server.fastmcp.resources import FileResource
from mcp.shared.exceptions import McpError  # PY_SDK_V1_MCPERROR
from mcp.client.streamable_http import streamablehttp_client  # PY_SDK_V1_STREAMABLEHTTP_CLIENT
from mcp.client.websocket import websocket_client  # PY_SDK_V1_WEBSOCKET
from mcp.client.auth import OAuthClientProvider, ClientCredentialsProvider

mcp = FastMCP("kitchen-sink")

DEBUG = os.environ.get("MCP_DEBUG") == "true"  # PY_SDK_V1_ENV (never took effect in v1 either)

auth = OAuthClientProvider(server_url="https://example.com", timeout=10)  # PY_SDK_V1_OAUTH
machine = ClientCredentialsProvider(scopes=["read", "write"])  # PY_SDK_V1_OAUTH (scopes= -> scope=)
client = Client("https://example.com/mcp", cache=False)  # PY_SDK_V1_CACHE_FALSE
logo = FileResource(uri="file:///logo.png", path="logo.png", is_binary=True)  # PY_SDK_V1_FILERESOURCE


@mcp.tool()
async def slow(session, name: str) -> str:
    result = await session.call_tool(name, {}, read_timeout_seconds=timedelta(seconds=30))  # PY_SDK_V1_TIMEDELTA
    if result.isError:  # PY_SDK_V1_CAMEL_FIELDS (attribute access; wire JSON stays camelCase)
        raise McpError("tool failed")
    ctx = mcp.get_context()  # PY_SDK_V1_GET_CONTEXT
    await ctx.report_progress(1, 1)
    return "ok"
