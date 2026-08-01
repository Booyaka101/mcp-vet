# A generic OAuth 2.0 client for a calendar-sync daemon. It registers without
# application_type, redeems an authorization code without touching iss, and
# persists its credentials keyed by the API host — all real (if sloppy) OAuth,
# but nothing in this file relates to the protocol this tool vets, so the
# scanner must stay silent. (Deliberately: this file never names that protocol
# — the three auth-hardening rules are gated on that file-level context.)
import json

STORE = {}


def register(http, register_url):
    body = {
        "redirect_uris": ["https://calendar.example.com/callback"],
        "client_name": "calendar-sync",
    }
    return http.post(register_url, json=body)


def redeem(http, token_url, code):
    return http.post(token_url, data={"grant_type": "authorization_code", "code": code})


def persist(store, api_host, creds):
    store.set(api_host, {"client_id": creds["client_id"], "client_secret": creds["client_secret"]})
