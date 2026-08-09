// Adversarial fixture (MISSED, documented): the transport name comes from a
// variable, so the literal 'sse' never sits as the transport key's value and
// SSE_TRANSPORT_DEPRECATED cannot fire. If detection ever improves, move this
// to caught/ and update README "Known limitations".

declare const mcp: { run(opts: { transport: string }): void };

const transport = process.env.MCP_TRANSPORT ?? 'sse';
mcp.run({ transport });
