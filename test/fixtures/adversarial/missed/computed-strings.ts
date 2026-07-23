// Adversarial fixture (KNOWN MISS): split/computed method strings. Static
// token analysis does not reconstruct these — documented in README "Known
// limitations". This file must produce ZERO findings; if it ever produces
// some, detection improved and the docs must be updated.

declare function call(method: string): void;
declare const op: string;

call('tasks' + '/list'); // miss: concatenated at runtime
call(`tasks/${op}`); // miss: template with substitution
const parts = ['tasks', 'result'];
call(parts.join('/')); // miss: joined at runtime

export {};
