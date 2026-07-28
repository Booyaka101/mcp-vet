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


# `ping` outside method-registration context must NOT fire PING_REMOVED.
def health(app):
    app.get("/ping")
    greeting = "ping"
    tool = {"name": "ping"}
    return greeting, tool


# Implementation-defined SDK code outside an error `code` position (the
# changelog grandfathers -32000..-32019 for implementations).
SDK_INTERNAL_CODE = -32001
LIMITS = {"floor": -32004}

# 'thisServer' with no include-context field anywhere near it.
TARGET = "thisServer"
