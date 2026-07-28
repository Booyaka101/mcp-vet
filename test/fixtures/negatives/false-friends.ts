// True negatives — mcp-vet must NOT flag anything in this file.
const okSession = { sessionId: 'abc', id: 123 }; // variable name has no "mcp"
export function initializeServer() {
  return 'ready';
} // identifier, not the exact 'initialize' string
const label = 'reinitialize the cache'; // not the exact string
const codes = { notFound: -32601, invalid: -32602 }; // not -32002
const methods = ['tasks/create', 'tools/call']; // tasks/create & tools/call are unaffected
const routing = { roots: ['/a'], logging: true }; // plain object, unrelated to any server-feature block
export function getRoots() {
  return routing.roots;
}
// `ping` as a plain health-check route / bare string / tool NAME — none of
// these are MCP method registration, so PING_REMOVED must NOT fire.
declare const app: any;
app.get('/ping', () => ({ status: 'ok' }));
const greeting = 'ping'; // bare string, no registration context
const tool = { name: 'ping', description: 'a tool merely NAMED ping' };
// -32001 as an implementation-defined SDK code OUTSIDE an error object — the
// changelog grandfathers -32000..-32019 for implementations.
const SDK_INTERNAL_CODE = -32001;
const limits = { floor: -32004 }; // not a `code` key
// 'thisServer' with no include-context field anywhere near it.
const target = 'thisServer';
export { okSession, label, codes, methods, greeting, tool, SDK_INTERNAL_CODE, limits, target };
