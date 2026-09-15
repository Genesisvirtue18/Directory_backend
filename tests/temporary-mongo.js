// Manual verification helper: a disposable database, never an existing database.
import { MongoMemoryServer } from 'mongodb-memory-server';
import { mkdir, writeFile, rm } from 'node:fs/promises';

const mongo = await MongoMemoryServer.create();
const uriFile = new URL('../.cache/test-mongodb-uri.txt', import.meta.url);
await mkdir(new URL('../.cache/', import.meta.url), { recursive: true });
await writeFile(uriFile, mongo.getUri('day1_manual'));
console.info('Temporary MongoDB ready; URI written to .cache/test-mongodb-uri.txt');
const keepAlive = setInterval(() => {}, 1000);
async function stop() {
  clearInterval(keepAlive);
  await mongo.stop();
  await rm(uriFile, { force: true });
}
process.once('SIGINT', stop);
process.once('SIGTERM', stop);
