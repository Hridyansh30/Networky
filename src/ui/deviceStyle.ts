import type { DeviceKind } from '../model/types';

export const KIND_BADGE: Record<DeviceKind, string> = {
  pc: 'PC',
  laptop: 'LT',
  server: 'SRV',
  hub: 'HUB',
  switch: 'SW',
  router: 'R',
};
