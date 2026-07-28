# Adversarial fixture (KNOWN MISS): generated/loop-driven registration built
# from string fragments. Must produce ZERO findings.

OPS = ("get", "update", "cancel")
SUB_OPS = ("subscribe", "unsubscribe")

def register_all(server):
    for op in OPS:
        server.register(f"tasks/{op}", handle)  # miss: f-string method name
    for op in SUB_OPS:
        server.register(f"resources/{op}", handle)  # miss: f-string removed method
    server.register("logging/" + "setLevel", handle)  # miss: concatenated removal
    server.reject(code=-(32000 + 3))  # miss: computed -32003 in a code kwarg

def handle(req):
    return None
