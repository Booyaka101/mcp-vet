# ANCHOR FIXTURE — a hand-rolled MCP OAuth client where the DCR metadata and the
# actual code redemption are far apart, and each rule must anchor at the line
# that matters. Reduced from ogx-ai/ogx
# (client-sdks/openapi/templates/python/lib/tools/mcp_oauth.py).
#   AUTH_DCR_NO_APPLICATION_TYPE -> the POSTED registration_request (line 24),
#     NOT the unposted software_statement dict above it.
#   AUTH_ISS_UNVALIDATED -> the singular "grant_type" redemption (line 36),
#     NOT the "grant_types" DCR declaration that also says authorization_code.
import requests


class SimpleMcpAuthClient:
    def __init__(self, redirect_uri):
        self.redirect_uri = redirect_uri
        self.software_statement = {
            "software_id": "simple-mcp-client",
            "redirect_uris": [self.redirect_uri],
            "client_name": "Simple MCP Client",
        }

    def register_client(self, registration_endpoint):
        registration_request = {
            "client_name": self.software_statement["client_name"],
            "redirect_uris": [self.redirect_uri],
            "grant_types": ["authorization_code"],
            "response_types": ["code"],
        }
        response = requests.post(registration_endpoint, json=registration_request)
        data = response.json()
        self.client_id = data.get("client_id")
        self.client_secret = data.get("client_secret")
        return data

    def exchange_code(self, token_endpoint, auth_code):
        data = {
            "grant_type": "authorization_code",
            "code": auth_code,
            "redirect_uri": self.redirect_uri,
            "client_id": self.client_id,
        }
        if self.client_secret:
            data["client_secret"] = self.client_secret
        response = requests.post(token_endpoint, data=data)
        return response.json().get("access_token")
