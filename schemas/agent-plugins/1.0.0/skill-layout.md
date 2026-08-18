# Agent Plugins 1.0.0 — skill discovery layout rules (vendored)

There is no `skill.schema.json` at agent-plugins.org (verified 404 on
2026-08-18); the skill *format* is owned by the separate Agent Skills
specification, and the *discovery layout* inside a plugin is normative prose in
the Agent Plugins specification. This file pins that prose verbatim so
`PLUGIN_SKILL_LAYOUT` cannot drift from the spec.

Source: https://agent-plugins.org/specification (fetched 2026-08-18).
Companion machine-readable schemas vendored in this directory:

- `plugin.schema.json` — https://agent-plugins.org/schemas/1.0.0/plugin.schema.json (fetched 2026-08-18)
- `mcp.schema.json` — https://agent-plugins.org/schemas/1.0.0/mcp.schema.json (fetched 2026-08-18)

## §6.1 Fixed locations

> Clients MUST discover each supported component type from its fixed location.
> plugin.json cannot override these locations or contain inline component
> configuration.

| Component type | Fixed location | Pattern |
| --- | --- | --- |
| Skills | `skills/` | Subdirectories containing `SKILL.md` |
| MCP servers | `mcp.json` | JSON configuration |

## §6.2 Missing locations

> If a fixed component location is absent, the client MUST NOT treat that as an
> error.

(So a plugin without `mcp.json` or without `skills/` is valid and must not
warn.)

## §7.1 Skills — the discovery rule PLUGIN_SKILL_LAYOUT enforces

> The fixed discovery location is `skills/`. Each immediate child directory
> containing a path named exactly `SKILL.md` that resolves to a regular file is
> treated as one skill. Clients MUST NOT recursively search deeper descendants
> for additional skills.

A `SKILL.md` anywhere other than `skills/<name>/SKILL.md` (directly in
`skills/`, or nested deeper) is therefore invisible to every conformant
client — it is silently ignored, not an error.

## §8.2 Extension directories

> The extension directory for a namespace is the top-level directory named
> after it. For example, files for `com.example.client` belong in
> `com.example.client/`.

(So a reverse-domain top-level directory such as `com.github.copilot/` is a
legal client-extension directory and must be ignored by the vetter, not
flagged.)
