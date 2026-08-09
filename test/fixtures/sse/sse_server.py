# An MCP server still on the deprecated HTTP+SSE transport, via the python-sdk
# legacy module. Expected: SSE_TRANSPORT_DEPRECATED on the import line (class
# name + module path), at the construction site, and at the connect_sse /
# handle_post_message wiring — nothing else.

from starlette.applications import Starlette
from starlette.routing import Mount, Route

from mcp.server.sse import SseServerTransport

sse = SseServerTransport("/messages/")


async def handle_sse(request):
    async with sse.connect_sse(request.scope, request.receive, request._send) as streams:
        await run_server(streams[0], streams[1])


async def run_server(read_stream, write_stream):
    ...


app = Starlette(
    routes=[
        Route("/sse", endpoint=handle_sse),
        Mount("/messages/", app=sse.handle_post_message),
    ]
)
