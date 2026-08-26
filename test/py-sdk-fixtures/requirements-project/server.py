import httpx  # declared above — PY_SDK_V1_HTTPX must NOT fire

from mcp.server.fastmcp import FastMCP  # PY_SDK_V1_FASTMCP fires (v2 via requirements.txt)

mcp = FastMCP("req-app")
