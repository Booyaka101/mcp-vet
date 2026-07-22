// Fixture: HTTP transport server with session + handshake code.
// Triggers: MCP_SESSION_ID (rule 1), INITIALIZE_HANDLER (rule 2).
import { createServer } from 'node:http';

const SESSION_HEADER = 'Mcp-Session-Id'; // BREAKING: header removed 2026-07-28

export function makeServer() {
  return createServer((req, res) => {
    const mcpSessionId = req.headers['mcp-session-id']; // BREAKING: variable + header key
    res.setHeader('Mcp-Session-Id', mcpSessionId ?? 'new'); // BREAKING: header write

    // BREAKING: registering an initialize handler
    server.setRequestHandler('initialize', async (request) => {
      return { protocolVersion: '2025-11-25', capabilities: {} };
    });

    server.setNotificationHandler('notifications/initialized', () => {
      // BREAKING: initialized notification is removed
    });
  });
}

// Clean code below — should NOT be flagged.
export function healthCheck() {
  return { status: 'ok', uptime: process.uptime() };
}

const server = {
  setRequestHandler(_m: string, _h: unknown) {},
  setNotificationHandler(_m: string, _h: unknown) {},
};
