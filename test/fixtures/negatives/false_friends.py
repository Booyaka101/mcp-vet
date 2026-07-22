# True negatives — mcp-vet must NOT flag anything in this file.
ok_session = {"sessionId": "abc", "id": 123}


def initialize_server():
    return "ready"


label = "reinitialize the cache"
codes = {"notFound": -32601, "invalid": -32602}
methods = ["tasks/create", "tools/call"]
routing = {"roots": ["/a"], "logging": True}


def get_roots():
    return routing["roots"]
