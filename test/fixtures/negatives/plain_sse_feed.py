# A plain (non-MCP) Flask server-sent-events feed for a stock ticker. It uses
# text/event-stream and named SSE events, but nothing in this file relates to
# the protocol this tool vets — the scanner must NOT flag any of it.

import json
import time

from flask import Flask, Response

app = Flask(__name__)


def stream():
    while True:
        quote = {"symbol": "ACME", "price": 42.0}
        yield f"event: quote\ndata: {json.dumps(quote)}\n\n"
        time.sleep(1)


@app.route("/ticker")
def ticker():
    return Response(stream(), mimetype="text/event-stream")
