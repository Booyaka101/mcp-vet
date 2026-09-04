// SSE_TRANSPORT_DEPRECATED already owns these two module paths, so
// TS_SDK_V1_MONOLITH suppresses on them: one import, one finding.
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';

export const make = (res: any) => new SSEServerTransport('/messages', res);
