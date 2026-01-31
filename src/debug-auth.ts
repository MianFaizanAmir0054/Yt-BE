import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

import { MongoClient } from "mongodb";

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db();
  
  // Drop existing Better Auth collections to start fresh
  console.log("Dropping old Better Auth collections...");
  try {
    await db.collection("user").drop();
    console.log("  ✓ Dropped 'user' collection");
  } catch {
    console.log("  (no 'user' collection to drop)");
  }
  
  try {
    await db.collection("account").drop();
    console.log("  ✓ Dropped 'account' collection");
  } catch {
    console.log("  (no 'account' collection to drop)");
  }
  
  try {
    await db.collection("session").drop();
    console.log("  ✓ Dropped 'session' collection");
  } catch {
    console.log("  (no 'session' collection to drop)");
  }
  
  console.log("\nBetter Auth collections cleared. Now run: npm run seed");
  
  await client.close();
}

main();
