// Adversarial fixture (KNOWN MISS): computed capability keys. The key never
// exists as a single token, so the capability rules cannot see it. Must
// produce ZERO findings.

const capNames = { r: 'roo', s: 'sam' };

export const serverInfo = {
  capabilities: {
    [capNames.r + 'ts']: {}, // miss: computed 'roots' key
    [`${capNames.s}pling`]: {}, // miss: computed 'sampling' key
  },
};
