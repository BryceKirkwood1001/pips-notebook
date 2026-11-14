/**
 * An in-memory stand-in for a MongoDB cluster, covering what the Mongo repository and the Atlas vector store use.
 * Vector search is unavailable (as on a cluster without Atlas Search), so the store ranks chunks in process.
 */
import type { Db } from 'mongodb';
import { AppError } from '../../src/errors';
import type { MongoConnector } from '../../src/storage';

type Doc = Record<string, any>;

function matches(doc: Doc, filter: Doc): boolean {
  return Object.entries(filter).every(([k, v]) =>
    v && typeof v === 'object' && '$in' in v ? (v.$in as unknown[]).includes(doc[k]) : doc[k] === v,
  );
}

function collection(docs: Map<string, Doc>) {
  return {
    async createIndex() {},
    listSearchIndexes: () => ({ toArray: async () => [] }),
    async createSearchIndex() { throw new Error('Atlas Search is not available on this cluster'); },
    aggregate: () => ({ toArray: async () => { throw new Error('$vectorSearch is not available'); } }),
    async countDocuments() { return docs.size; },
    async replaceOne(filter: Doc, doc: Doc, opts?: { upsert?: boolean }) {
      const found = [...docs.values()].find((d) => matches(d, filter));
      if (found || opts?.upsert) docs.set(doc._id, structuredClone(doc));
    },
    async findOne(filter: Doc) {
      const d = [...docs.values()].find((x) => matches(x, filter));
      return d ? structuredClone(d) : null;
    },
    async bulkWrite(ops: Doc[]) {
      for (const op of ops) docs.set(op.replaceOne.replacement._id, structuredClone(op.replaceOne.replacement));
    },
    find(filter: Doc) {
      let order: [string, number][] = [];
      const cursor = {
        sort(spec: Record<string, number>) { order = Object.entries(spec); return cursor; },
        async toArray() {
          const found = [...docs.values()].filter((d) => matches(d, filter)).map((d) => structuredClone(d));
          for (const [field, direction] of [...order].reverse()) {
            found.sort((a, b) => (a[field] < b[field] ? -direction : a[field] > b[field] ? direction : 0));
          }
          return found;
        },
      };
      return cursor;
    },
    async deleteMany(filter: Doc) {
      for (const [id, d] of docs) if (matches(d, filter)) docs.delete(id);
    },
    async deleteOne(filter: Doc) {
      const found = [...docs.entries()].find(([, d]) => matches(d, filter));
      if (!found) return { deletedCount: 0 };
      docs.delete(found[0]);
      return { deletedCount: 1 };
    },
    async updateOne(filter: Doc, update: Doc, opts?: { upsert?: boolean }) {
      let found = [...docs.values()].find((d) => matches(d, filter));
      if (!found) {
        if (!opts?.upsert) return;
        found = { _id: filter._id, ...(update.$setOnInsert ?? {}) } as Doc;
        docs.set(found._id, found);
      }
      const doc: Doc = found;
      for (const [k, v] of Object.entries<number>(update.$inc ?? {})) doc[k] = (doc[k] ?? 0) + v;
      for (const [k, v] of Object.entries<any>(update.$push ?? {})) {
        doc[k] = doc[k] ?? [];
        if (v && typeof v === 'object' && '$each' in v) doc[k].push(...v.$each);
        else doc[k].push(v);
      }
    },
  };
}

/**
 * A fake cluster that keeps its data across connections. `connect` refuses any connection string containing
 * "unreachable", the way a wrong host would fail.
 */
export function fakeMongoCluster() {
  const databases = new Map<string, Map<string, Map<string, Doc>>>();
  const docs = (database: string, name: string) => {
    if (!databases.has(database)) databases.set(database, new Map());
    const db = databases.get(database)!;
    if (!db.has(name)) db.set(name, new Map());
    return db.get(name)!;
  };
  let open = 0;
  const connect: MongoConnector = async (uri, database) => {
    if (uri.includes('unreachable')) throw new AppError('storage_error', 'Could not connect to MongoDB: getaddrinfo ENOTFOUND unreachable.example.net');
    open += 1;
    const db = { collection: (name: string) => collection(docs(database, name)) } as unknown as Db;
    return { db, close: async () => { open -= 1; } };
  };
  return { connect, docs, openConnections: () => open };
}
