# Adversarial fixture (KNOWN MISS): generated/loop-driven registration built
# from string fragments. Must produce ZERO findings.

OPS = ("get", "update", "cancel")

def register_all(server):
    for op in OPS:
        server.register(f"tasks/{op}", handle)  # miss: f-string method name

def handle(req):
    return None
