// Confidence gradient fixture.
const mode = 'initialize'; // LOW: bare string, no registration context
export function route(req: any) {
  if (req.method === 'initialize') return 1; // HIGH: compared against a method
  return 0;
}
const server = { capabilities: { sampling: {} } }; // HIGH: structurally inside capabilities
// extra note describing the server capabilities and defaults
const opts = { logging: false }; // MEDIUM: near the word "capabilities", not structural
export { mode, server, opts };
