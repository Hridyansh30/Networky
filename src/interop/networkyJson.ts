// The native format: everything, losslessly. The only format Networky can
// read back completely (Open), because every other format is a translation.

import { serialize } from '../model/serialize';
import type { Exporter } from './types';

export const networkyExporter: Exporter = {
  id: 'networky',
  title: 'Networky project',
  description: 'Everything: devices, cables, positions and settings. Open it again with Open, or share it.',
  language: 'JSON',
  export: ({ topology, layout, name }) => ({ fileName: `${name}.networky.json`, mime: 'application/json', text: serialize({ topology, layout }), notes: [] }),
};
