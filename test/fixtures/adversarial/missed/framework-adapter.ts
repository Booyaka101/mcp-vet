// Adversarial fixture (KNOWN MISS): framework-adapter indirection. The legacy
// method names only exist at runtime inside a routing table built from
// fragments, so there is no token to match. Must produce ZERO findings.

declare const app: any;
declare function dispatch(method: string): any;

const NAMESPACE = 'tasks';
const ACTIONS = ['list', 'result'];

for (const action of ACTIONS) {
  app.post('/rpc/' + NAMESPACE + '/' + action, () => dispatch(NAMESPACE + '/' + action));
}

export {};
