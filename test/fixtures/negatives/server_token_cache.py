# TRUE NEGATIVE — the shape the python-sdk's own simple-auth SERVER uses
# (servers/simple-auth/mcp_simple_auth/simple_auth_provider.py). This is an
# authorization-SERVER access-token cache keyed by the token it just minted,
# not an MCP client persisting credentials it got from registration, so
# SEP-2352 does not apply. v0.10.0/0.10.1 flagged it (counted as a false
# positive in BENCHMARK.md); 0.10.2 fixes it. The `client_id=` kwarg is what
# used to trip the heuristic — a token record naturally records which client
# the token belongs to.
import secrets
import time

from mcp.server.auth.provider import AccessToken


class SimpleAuthProvider:
    def __init__(self):
        self.tokens = {}
        self.user_data = {}

    def mint(self, client, scopes, resource):
        mcp_token = f"mcp_{secrets.token_hex(32)}"
        self.tokens[mcp_token] = AccessToken(
            token=mcp_token,
            client_id=client.client_id,
            scopes=scopes,
            expires_at=int(time.time()) + 3600,
            resource=resource,
        )
        return mcp_token
