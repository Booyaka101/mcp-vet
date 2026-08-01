"""Dirty fixture (Python): one instance of every rule added or reclassified for
the FINAL 2026-07-28 changelog — the Python analyzer must behave identically to
the TypeScript one on all nine new/reclassified ids.
"""
from mcp import types
from mcp.server.streamable_http import streamable_http_transport


def dispatch(request, server):
    method = request["method"]
    if method == "ping":  # BREAKING: PING_REMOVED (method-comparison context)
        return {}
    if method == "resources/subscribe":  # BREAKING: RESOURCE_SUBSCRIBE_REMOVED
        return {"ok": True}
    if method == "resources/unsubscribe":  # BREAKING: RESOURCE_SUBSCRIBE_REMOVED
        return {"ok": True}
    if method == "logging/setLevel":  # BREAKING: LOGGING_SETLEVEL_REMOVED (hard removal)
        return {"level": "set"}
    if method == "notifications/roots/list_changed":  # BREAKING: ROOTS_LIST_CHANGED_REMOVED
        return None
    if method == "notifications/elicitation/complete":  # BREAKING: ELICITATION_COMPLETE_REMOVED
        return None
    return server.handle(types.PingRequest)  # BREAKING: PING_REMOVED (SDK type)


def make_transport(event_db):
    # BREAKING: SSE_RESUMABILITY_REMOVED — event_store into a transport factory.
    return streamable_http_transport(event_store=event_db)


def read_resume_header(headers):
    last_event_id = headers.get("Last-Event-ID")  # BREAKING: SSE_RESUMABILITY_REMOVED
    return last_event_id


def legacy_errors(err):
    if err["code"] == -32004:  # BREAKING: ERROR_CODE_RENUMBERED (-32022 now)
        return {"error": {"code": -32001, "message": "Header mismatch"}}  # BREAKING (-32020)
    return {"error": {"code": -32003, "message": "Missing required client capability"}}  # BREAKING (-32021)


def not_found():
    return {"error": {"code": -32002, "message": "Resource not found"}}  # BREAKING (existing rule)


def sampling_params():
    return {
        "includeContext": "thisServer",  # DEPRECATED: INCLUDE_CONTEXT_VALUES
        "maxTokens": 64,
    }


def discover_auth(metadata):
    # DEPRECATED: OAUTH_DCR — RFC7591 dynamic client registration.
    return metadata["registration_endpoint"]


def register_client(http, metadata):
    # DEPRECATED: AUTH_DCR_NO_APPLICATION_TYPE — redirect_uris + client_name,
    # no application_type (SEP-837).
    body = {
        "redirect_uris": ["http://127.0.0.1:33418/callback"],
        "client_name": "dirty-fixture-client",
    }
    return http.post(metadata["registration_endpoint"], json=body)


def redeem_code(http, token_endpoint, code):
    # DEPRECATED: AUTH_ISS_UNVALIDATED — no iss read before redeeming (SEP-2468).
    return http.post(token_endpoint, data={"grant_type": "authorization_code", "code": code})


def persist_credentials(store, server_url, creds):
    # DEPRECATED: AUTH_CREDENTIALS_NOT_ISSUER_KEYED — keyed by the server URL (SEP-2352).
    store.set(server_url, {"client_id": creds["client_id"], "client_secret": creds["client_secret"]})


ELICITATION = {"elicitationId": "elic-1"}  # BREAKING: ELICITATION_COMPLETE_REMOVED (field)
