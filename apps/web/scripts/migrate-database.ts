import { bootstrapDatabaseSchema, closeDatabasePool } from "../src/server/db";

try {
  await bootstrapDatabaseSchema();
  console.log("PostgreSQL schema is ready.");
} finally {
  await closeDatabasePool();
}
