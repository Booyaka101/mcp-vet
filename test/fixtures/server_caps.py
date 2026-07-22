"""Fixture: Python MCP server capability declaration + task dispatch.

Triggers: ROOTS_CAP (rule 5), SAMPLING_CAP (rule 6), LOGGING_CAP (rule 7),
TASKS_LEGACY (rule 4).
"""


def build_capabilities():
    # Kwarg-style declaration (common in the Python SDK).
    return dict(
        capabilities=dict(
            roots={"listChanged": True},  # DEPRECATED
            sampling={},  # DEPRECATED
            logging={},  # DEPRECATED
            tools={"listChanged": True},  # clean
        )
    )


def dispatch(method, params):
    if method == "tasks/get":  # BREAKING: legacy Tasks method
        return get_task(params)
    if method == "tasks/update":  # BREAKING: legacy Tasks method
        return update_task(params)
    if method == "tasks/cancel":  # BREAKING: legacy Tasks method
        return cancel_task(params)
    return None


# Clean helpers — should NOT be flagged.
def get_task(params):
    return {"status": "working"}


def update_task(params):
    return {"status": "updated"}


def cancel_task(params):
    return {"status": "cancelled"}
