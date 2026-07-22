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
