import { PerchWorld } from './world.js';
import { PERCH_TOOLS } from './tools.js';

export const PERCH = {
  id: 'perch',
  label: '雷霆大跳',
  defaults: () => ({
    enabled: false,
    enabledNote: 'set true in config.json to wake the companion on next start',
    mode: 'attach',
    port: 47650,
    minWidth: 240,
    minHeight: 120,
    headroom: 56,
    maxJumpHeight: 900,
    jumpCooldown: 8,
    windowPerching: true,
    edgeLeaps: true,
    autoWindowHops: true,
    autoRoamingJumps: true,
    aiThunderJump: true,
    excludeTitles: [],
  }),
  create: (ctx) => new PerchWorld(ctx),
  describe: {
    // Same declarations the model receives (see tools.js), so describe.json cannot drift.
    tools: PERCH_TOOLS,
    events: [],
  },
};

export default PERCH;
