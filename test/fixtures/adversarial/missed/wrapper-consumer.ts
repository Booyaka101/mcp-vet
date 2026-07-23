// Adversarial fixture (KNOWN MISS): a re-export wrapper renames an SDK schema
// constant in another module. The *wrapper module* is flagged when scanned, but
// this consumer never mentions a canonical name, so on its own it must produce
// ZERO findings. Scan whole projects, not single files, to keep this covered.

import { INIT_SCHEMA } from './some-wrapper-module';

declare const server: any;

server.setRequestHandler(INIT_SCHEMA, async () => ({})); // miss: renamed upstream

export {};
