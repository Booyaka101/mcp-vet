# KNOWN MISS (documented limitation): the credential-store key is COMPUTED
# (`key_for(server_url)`), so the analyzer cannot classify it — the
# credential-keying rule deliberately skips computed keys rather than guess,
# even though this store is in fact keyed by the server URL, which the
# 2026-07-28 credential-binding requirement forbids. An MCP file, so the
# file-level context gate is not what keeps it quiet; the key expression is.
from mcp.client.session import ClientSession


def key_for(server_url):
    return "creds:" + server_url


def persist(store, server_url, creds):
    store.set(key_for(server_url), {"client_id": creds["client_id"], "client_secret": creds["client_secret"]})
