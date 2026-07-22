// Suppression fixture: only the last finding should survive.
const a = -32002; // mcp-vet-disable-line
// mcp-vet-disable-next-line ERROR_CODE_32002
const b = -32002;
const c = 'Mcp-Session-Id'; // mcp-vet-disable-line MCP_SESSION_ID
const d = 'tasks/get'; // NOT suppressed -> flagged
export { a, b, c, d };
