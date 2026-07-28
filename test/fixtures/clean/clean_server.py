"""Clean fixture: a Python server already migrated to the 2026-07-28 spec.

Must produce ZERO findings.
"""


def build_capabilities():
    return dict(
        capabilities=dict(
            tools={"listChanged": True},
            resources={"subscribe": True},
            prompts={"listChanged": True},
        )
    )


def handle_request(request):
    meta = request.get("params", {}).get("_meta", {})
    if "protocolVersion" not in meta:
        # JSON-RPC standard invalid-params code.
        return {"error": {"code": -32602, "message": "Invalid params"}}
    return {"ok": True}


def method_not_found():
    return {"error": {"code": -32601, "message": "method not found"}}


# --- Migrated forms from the FINAL changelog — all must stay clean ---


def handle_subscriptions(request):
    if request["method"] == "subscriptions/listen":
        return {
            "resultType": "complete",  # required on every result (SEP-2322)
            "subscriptions": {"toolsListChanged": True, "resourcesListChanged": True},
        }
    return None


def header_mismatch():
    # The renumbered 2026-07-28 code is the CORRECT one.
    return {"error": {"code": -32020, "message": "Header mismatch"}}


def list_result():
    # Cacheable list results (SEP-2549).
    return {"resultType": "complete", "tools": [], "ttlMs": 60000, "cacheScope": "private"}


def make_transport(streamable_http_client, url):
    # Stateless migration: no stored session id.
    return streamable_http_client(url, session_id=None)


SAMPLING_DEFAULTS = {"includeContext": "none"}
