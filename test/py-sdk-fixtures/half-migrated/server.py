from mcp.server.mcpserver import MCPServer
from mcp.server.fastmcp import FastMCP  # leftover v1 import — the only finding

server = MCPServer("demo")
legacy = FastMCP("legacy")
