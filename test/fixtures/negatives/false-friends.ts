// True negatives — mcp-vet must NOT flag anything in this file.
const okSession = { sessionId: 'abc', id: 123 }; // variable name has no "mcp"
export function initializeServer() {
  return 'ready';
} // identifier, not the exact 'initialize' string
const label = 'reinitialize the cache'; // not the exact string
const codes = { notFound: -32601, invalid: -32602 }; // not -32002
const methods = ['tasks/list', 'tasks/create', 'tools/call']; // not the 3 legacy methods
const routing = { roots: ['/a'], logging: true }; // plain object, unrelated to any server-feature block
export function getRoots() {
  return routing.roots;
}
export { okSession, label, codes, methods };
