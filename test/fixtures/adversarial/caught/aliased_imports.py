# Adversarial fixture (CAUGHT): a Python import alias must not hide a
# deprecated SDK capability constructor — the import line and the aliased
# usage site are both flagged.
from mcp.types import RootsCapability as RC

caps = RC()  # DEPRECATED (roots) via alias
