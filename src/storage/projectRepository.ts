// Where projects are saved. The app talks only to the ProjectRepository
// interface (the repository pattern), so the storage behind it can change
// without touching any UI code:
//
//   today:  IndexedDbRepository, in the browser, no server needed
//   tests:  MemoryRepository
//   later:  an HTTP repository talking to a backend, same interface
//
// Everything read back goes through deserialize(), the same hardened loader
// as file import: browser storage can be edited by other scripts or by hand,
// so it is not trusted either.

import { nanoid } from 'nanoid';
import { deserialize, serialize, type NetworkyFile } from '../model/serialize';

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: number;
  starred: boolean;
  deviceCount: number;
}

export interface Project extends ProjectSummary {
  file: NetworkyFile;
}

export interface ProjectRepository {
  list(): Promise<ProjectSummary[]>;
  get(id: string): Promise<Project | null>;
  /** Creates when `id` is new, otherwise replaces. Returns the saved summary. */
  save(project: { id?: string; name: string; file: NetworkyFile; starred?: boolean }): Promise<ProjectSummary>;
  rename(id: string, name: string): Promise<void>;
  setStarred(id: string, starred: boolean): Promise<void>;
  delete(id: string): Promise<void>;
}

/** What is actually stored: the file as JSON text, so it is re-validated on every load. */
interface StoredProject extends ProjectSummary {
  data: string;
}

export const MAX_PROJECTS = 200;
const cleanName = (n: string) => n.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 80) || 'Untitled';

function toSummary(p: StoredProject): ProjectSummary {
  return { id: p.id, name: p.name, updatedAt: p.updatedAt, starred: p.starred, deviceCount: p.deviceCount };
}

function toProject(p: StoredProject): Project | null {
  try {
    return { ...toSummary(p), file: deserialize(p.data) };
  } catch {
    return null; // a corrupted entry is skipped, never trusted
  }
}

function newRecord(input: { id?: string; name: string; file: NetworkyFile; starred?: boolean }, previous?: StoredProject): StoredProject {
  return {
    id: input.id ?? nanoid(12),
    name: cleanName(input.name),
    updatedAt: Date.now(),
    starred: input.starred ?? previous?.starred ?? false,
    deviceCount: Object.keys(input.file.topology.devices).length,
    data: serialize(input.file),
  };
}

const newestFirst = (a: ProjectSummary, b: ProjectSummary) => b.updatedAt - a.updatedAt;

/** In-memory storage: for tests, and the fallback when IndexedDB is unavailable (e.g. private mode). */
export class MemoryRepository implements ProjectRepository {
  private items = new Map<string, StoredProject>();

  async list() {
    return [...this.items.values()].map(toSummary).sort(newestFirst);
  }
  async get(id: string) {
    const p = this.items.get(id);
    return p ? toProject(p) : null;
  }
  async save(input: { id?: string; name: string; file: NetworkyFile; starred?: boolean }) {
    if (!input.id && this.items.size >= MAX_PROJECTS) throw new Error(`At most ${MAX_PROJECTS} projects; delete some first`);
    const rec = newRecord(input, input.id ? this.items.get(input.id) : undefined);
    this.items.set(rec.id, rec);
    return toSummary(rec);
  }
  async rename(id: string, name: string) {
    const p = this.items.get(id);
    if (p) this.items.set(id, { ...p, name: cleanName(name), updatedAt: Date.now() });
  }
  async setStarred(id: string, starred: boolean) {
    const p = this.items.get(id);
    if (p) this.items.set(id, { ...p, starred });
  }
  async delete(id: string) {
    this.items.delete(id);
  }
}

const DB = 'networky';
const STORE = 'projects';

/** Browser storage that survives reloads. One object store, keyed by project id. */
export class IndexedDbRepository implements ProjectRepository {
  private db: Promise<IDBDatabase>;

  constructor(factory: IDBFactory = indexedDB) {
    this.db = new Promise((resolve, reject) => {
      const req = factory.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async run<T>(mode: IDBTransactionMode, work: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await this.db;
    return new Promise((resolve, reject) => {
      const req = work(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  private async all(): Promise<StoredProject[]> {
    const rows = await this.run('readonly', (s) => s.getAll() as IDBRequest<StoredProject[]>);
    return rows.filter((r) => r && typeof r.id === 'string' && typeof r.data === 'string');
  }

  async list() {
    return (await this.all()).map(toSummary).sort(newestFirst);
  }
  async get(id: string) {
    const p = await this.run('readonly', (s) => s.get(id) as IDBRequest<StoredProject | undefined>);
    return p ? toProject(p) : null;
  }
  async save(input: { id?: string; name: string; file: NetworkyFile; starred?: boolean }) {
    const previous = input.id ? await this.run('readonly', (s) => s.get(input.id!) as IDBRequest<StoredProject | undefined>) : undefined;
    if (!previous && (await this.all()).length >= MAX_PROJECTS) throw new Error(`At most ${MAX_PROJECTS} projects; delete some first`);
    const rec = newRecord(input, previous);
    await this.run('readwrite', (s) => s.put(rec));
    return toSummary(rec);
  }
  async rename(id: string, name: string) {
    const p = await this.run('readonly', (s) => s.get(id) as IDBRequest<StoredProject | undefined>);
    if (p) await this.run('readwrite', (s) => s.put({ ...p, name: cleanName(name), updatedAt: Date.now() }));
  }
  async setStarred(id: string, starred: boolean) {
    const p = await this.run('readonly', (s) => s.get(id) as IDBRequest<StoredProject | undefined>);
    if (p) await this.run('readwrite', (s) => s.put({ ...p, starred }));
  }
  async delete(id: string) {
    await this.run('readwrite', (s) => s.delete(id));
  }
}

/** The repository the app uses: IndexedDB when the browser allows it, memory otherwise. */
export function createRepository(): ProjectRepository {
  try {
    if (typeof indexedDB !== 'undefined') return new IndexedDbRepository();
  } catch {
    /* fall through */
  }
  return new MemoryRepository();
}
