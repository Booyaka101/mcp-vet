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

// v0.9.0 removed methods, in the same split/computed shapes — still misses:
call('resources/' + 'subscribe'); // miss: concatenated resources/subscribe
call(`logging/${'set' + 'Level'}`); // miss: computed logging/setLevel
call('notifications/roots/' + 'list_changed'); // miss: concatenated notification
const header = ['Last-Event', 'ID'].join('-'); // miss: joined header name
const legacyCode = { code: -(32000 + 1) }; // miss: computed -32001 in code position
call(header + String(legacyCode.code));

export {};
