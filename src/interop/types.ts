// Phase 4: getting networks in and out of Networky.
//
// Every format is a plugin with the same shape, exactly like the engine's
// protocol plugins: the UI lists EXPORTERS and IMPORTERS from index.ts and
// knows nothing about any one format. Adding a format = one file + one line.
//
// Everything here is pure TypeScript: no React, no DOM, no network. An
// exporter only ever produces TEXT for the user to download and run
// themselves. Networky never talks to AWS or to a real router, so it never
// needs credentials (which must never live in a browser).

import type { Layout, Topology } from '../model/types';

export interface ExportInput {
  topology: Topology;
  layout: Layout;
  /** Project name, for file names and comments. */
  name: string;
}

export interface ExportResult {
  fileName: string;
  /** MIME type for the download. */
  mime: string;
  text: string;
  /**
   * What did NOT translate, in plain language. Shown next to the preview,
   * because a silent partial translation is worse than none.
   */
  notes: string[];
}

export interface Exporter {
  id: string;
  title: string;
  /** One line under the title in the export dialog. */
  description: string;
  /** Short label for the preview's language, e.g. 'Cisco IOS', 'HCL'. */
  language: string;
  export(input: ExportInput): ExportResult;
}

/** One line of an import report. */
export interface ImportNote {
  /** 1-based line in the pasted text, when the note is about one line. */
  line?: number;
  level: 'error' | 'skipped' | 'info';
  text: string;
}

export interface ImportResult {
  /** The topology after the import. Unchanged input when nothing applied. */
  topology: Topology;
  /** Positions for devices the import created (canvas coordinates). */
  layout: Layout;
  notes: ImportNote[];
  /** Devices that received configuration, by hostname. */
  devices: string[];
}

export interface ImportOptions {
  /** 'merge' adds to the existing config (like 'copy tftp running-config'); 'replace' resets it first. */
  mode: 'merge' | 'replace';
}
