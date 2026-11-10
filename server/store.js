// Append-only event store. The log on disk (JSON lines) is the source of truth; state is
// always recomputed with core/workflow.reduce. Appends are idempotent by event id.
import { readFileSync, existsSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { PERMISSIONS } from '../core/workflow.js';

export class Store {
  constructor(file, { seed = [] } = {}) {
    this.file = file;
    this.log = [];
    this.ids = new Set();
    this.listeners = new Set();
    mkdirSync(dirname(file), { recursive: true });
    for (const e of seed) this.#add(e, false);
    if (existsSync(file)) {
      for (const line of readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try { this.#add(JSON.parse(line), false); } catch { /* skip corrupt line */ }
      }
    }
  }

  static valid(e) {
    return e && typeof e.id === 'string' && e.id.length <= 80 && typeof e.caseId === 'string' && e.caseId.length <= 80 &&
      PERMISSIONS[e.type] && typeof e.at === 'string' && !Number.isNaN(Date.parse(e.at)) &&
      e.actor && typeof e.actor.id === 'string' && typeof e.actor.role === 'string' && typeof e.payload === 'object';
  }

  #add(e, persist = true) {
    if (!Store.valid(e) || this.ids.has(e.id)) return false;
    this.ids.add(e.id);
    this.log.push(e);
    if (persist) appendFileSync(this.file, JSON.stringify(e) + '\n');
    return true;
  }

  /** Append many; returns ids that were new. */
  append(events) {
    const added = [];
    for (const e of events) if (this.#add(e)) added.push(e);
    if (added.length) for (const fn of this.listeners) fn(added);
    return added;
  }

  since(cursor = 0) {
    return this.log.slice(Math.max(0, cursor));
  }

  get cursor() {
    return this.log.length;
  }

  forCase(caseId) {
    return this.log.filter((e) => e.caseId === caseId);
  }

  onAppend(fn) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}
