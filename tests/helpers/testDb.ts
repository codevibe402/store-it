import { MongoMemoryReplSet } from "mongodb-memory-server";
import mongoose from "mongoose";

let mongod: MongoMemoryReplSet | null = null;

type MongooseCache = { conn: typeof mongoose | null; promise: Promise<typeof mongoose> | null };

function getGlobalCache(): MongooseCache {
  const g = globalThis as unknown as { mongoose?: MongooseCache };
  // adapters/database/mongoose.ts captures `global.mongoose` into a local
  // `cached` variable the first time it's imported (statically, before any
  // beforeAll runs) and never re-reads the global afterward — so this must
  // mutate the same object in place rather than replace `globalThis.mongoose`
  // with a new one, or connectDB() would keep holding a stale reference and
  // try to open a second, real connection with the placeholder MONGODB_URI.
  if (!g.mongoose) g.mongoose = { conn: null, promise: null };
  return g.mongoose;
}

// Pre-populates the connection cache that adapters/database/mongoose.ts's
// connectDB() reads (`global.mongoose`), so route handlers under test get a
// real mongodb-memory-server connection without ever touching the
// placeholder MONGODB_URI env value.
export async function connectTestDB(): Promise<void> {
  // A single-node replica set, not a plain standalone instance — some code
  // under test (folderService.moveFolder) uses multi-document transactions
  // (session.withTransaction), which MongoDB only supports on a replica set
  // (or mongos). Against a standalone mongod, starting a transaction throws
  // immediately, so both sides of any concurrent-move test would "fail" the
  // same way regardless of whether the CAS logic being tested is correct.
  mongod = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(mongod.getUri());
  const cache = getGlobalCache();
  cache.conn = mongoose;
  cache.promise = Promise.resolve(mongoose);
}

export async function disconnectTestDB(): Promise<void> {
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
  if (mongod) {
    await mongod.stop();
    mongod = null;
  }
  const cache = getGlobalCache();
  cache.conn = null;
  cache.promise = null;
}

export async function clearTestDB(): Promise<void> {
  const collections = mongoose.connection.collections;
  await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
}
