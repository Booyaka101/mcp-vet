# TRUE NEGATIVE — an MCP authorization SERVER implementing the RFC7591
# registration endpoint: it RECEIVES a client's registration and stores it.
# SEP-837/2468/2352 all constrain what an MCP *client* does, so none of the
# AUTH_* rules apply here. Reduced from greeves89/AI-Employee
# (orchestrator/app/core/mcp_oauth.py), which v0.10.2 flagged.
import json


async def register_client_endpoint(body, db, secret_hash, auth_method, redirect_uris, grant_types):
    client_id = f"mcp_{secret_hash[:16]}"
    client = RegisteredClient(
        client_id=client_id,
        client_secret_hash=secret_hash,
        client_name=str(body.get("client_name") or "")[:255] or None,
        redirect_uris=json.dumps(redirect_uris),
        grant_types=" ".join(grant_types),
        token_endpoint_auth_method=auth_method,
    )
    db.add(client)
    return client
