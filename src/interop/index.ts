// The registry the UI reads. Add a format by writing one Exporter (see
// types.ts) and listing it here; the Export dialog picks it up.

import { ciscoExporter } from './ciscoExport';
import { networkyExporter } from './networkyJson';
import type { Exporter } from './types';

export const EXPORTERS: Exporter[] = [networkyExporter, ciscoExporter];

export { importCiscoConfig, IMPORT_LIMITS } from './ciscoImport';
export type { ExportResult, Exporter, ImportNote, ImportResult } from './types';

/** A safe file name stem from a project name. */
export const fileStem = (name: string) => name.replace(/[^\w.-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'network';
