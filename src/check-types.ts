import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

import { MongoClient, ObjectId } from "mongodb";

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db();
  
  console.log("=== Checking account.userId type ===\n");
  
  const accounts = await db.collection("account").find({}).toArray();
  for (const acc of accounts) {
    console.log(`Account for providerId=${acc.providerId}:`);
    console.log(`  userId value: ${acc.userId}`);
    console.log(`  userId type: ${typeof acc.userId}`);
    console.log(`  Is ObjectId: ${acc.userId instanceof ObjectId}`);
    console.log("");
  }
  
  // Test: Can we find the account using ObjectId?
  const user = await db.collection("user").findOne({ email: "admin@ytauto.com" });
  if (user) {
    console.log("=== Testing account lookup ===");
    console.log(`User _id: ${user._id} (type: ${typeof user._id})`);
    
    // Try with string
    const accByString = await db.collection("account").findOne({ 
      userId: user._id.toString() 
    });
    console.log(`\nFind by string '${user._id.toString()}': ${accByString ? "FOUND" : "NOT FOUND"}`);
    
    // Try with ObjectId
    const accByObjectId = await db.collection("account").findOne({ 
      userId: user._id 
    });
    console.log(`Find by ObjectId: ${accByObjectId ? "FOUND" : "NOT FOUND"}`);
  }
  
  await client.close();
}

main();
