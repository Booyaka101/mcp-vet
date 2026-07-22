// Fixture: task handling + error codes.
// Triggers: TASKS_LEGACY (rule 4), ERROR_CODE_32002 (rule 3).

const RESOURCE_MISSING = -32002; // BREAKING: must become -32602

export function handle(method: string, id: number) {
  switch (method) {
    case 'tasks/get': // BREAKING: legacy Tasks method shape
      return getTask(id);
    case 'tasks/update': // BREAKING: legacy Tasks method shape
      return updateTask(id);
    case 'tasks/cancel': // BREAKING: legacy Tasks method shape
      return cancelTask(id);
    default:
      return { error: { code: -32002, message: 'Resource not found' } }; // BREAKING
  }
}

function getTask(id: number) {
  if (id < 0) {
    return { error: { code: RESOURCE_MISSING, message: 'missing' } };
  }
  return { id, status: 'working' };
}

// Clean helpers — should NOT be flagged.
function updateTask(id: number) {
  return { id, status: 'updated', code: 200 };
}
function cancelTask(id: number) {
  return { id, status: 'cancelled', code: -32601 };
}
