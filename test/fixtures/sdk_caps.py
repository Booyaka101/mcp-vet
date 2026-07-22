# Fixture: the Python SDK capability-constructor pattern (as used by real servers,
# e.g. the official git server). roots/sampling are deprecated on 2026-07-28.
from mcp.types import ClientCapabilities, RootsCapability, SamplingCapability


def announce(session):
    return session.check_client_capability(
        ClientCapabilities(roots=RootsCapability(), sampling=SamplingCapability())
    )
