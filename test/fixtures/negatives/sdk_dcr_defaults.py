# TRUE NEGATIVE — the shape the official python-sdk's own example clients use.
# Neither construction names `application_type`, and both are CORRECT: the SDK's
# OAuthClientMetadata model defaults it (src/mcp/shared/auth.py — "SEP-837: OIDC
# application_type. Defaults to 'native'..."), so the registration request does
# carry the parameter. v0.10.0 flagged all three of these upstream and counted
# them as true positives; they were false positives. This fixture locks the fix.
from mcp.client.auth import OAuthClientProvider
from mcp.shared.auth import OAuthClientMetadata


def build_auth_direct(server_url, storage):
    # Direct model construction — application_type defaults to "native".
    return OAuthClientProvider(
        server_url=server_url,
        client_metadata=OAuthClientMetadata(
            client_name="Example MCP Client",
            redirect_uris=["http://localhost:3000/callback"],
            grant_types=["authorization_code", "refresh_token"],
        ),
        storage=storage,
    )


def build_auth_validated(server_url, storage):
    # The simple-auth-client shape: a raw dict routed through model_validate,
    # so the same default applies.
    client_metadata_dict = {
        "client_name": "Simple Auth Client",
        "redirect_uris": ["http://localhost:3030/callback"],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
    }
    return OAuthClientProvider(
        server_url=server_url,
        client_metadata=OAuthClientMetadata.model_validate(client_metadata_dict),
        storage=storage,
    )
