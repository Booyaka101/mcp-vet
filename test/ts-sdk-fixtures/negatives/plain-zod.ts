// zod below the v2 floor, but no MCP SDK import — TS_SDK_V1_ZOD3 must not fire.
// The rule is about the SDK's peer floor, not about zod versions in general.
import { z } from 'zod';

export const User = z.object({ name: z.string(), age: z.number().int() });
export type User = z.infer<typeof User>;
