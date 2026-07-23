# Adversarial fixture (CAUGHT): Python client-side session ownership.

transport = streamable_http_client(url, session_id=saved_id)  # BREAKING (medium)
sid = transport.session_id  # BREAKING (medium) — client reads its session id

migrated = streamable_http_client(url, session_id=None)  # OK — stateless form
unrelated = make_widget(session_id=x)  # OK — not a transport/client factory
