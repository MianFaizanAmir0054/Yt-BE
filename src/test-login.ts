import * as dotenv from "dotenv";
import path from "path";
dotenv.config({ path: path.join(process.cwd(), ".env.local") });

import { MongoClient } from "mongodb";
import { verifyPassword } from "better-auth/crypto";

async function main() {
  const client = new MongoClient(process.env.MONGODB_URI!);
  await client.connect();
  const db = client.db();
  
  const email = "admin@ytauto.com";
  const password = "Admin@123";
  
  console.log(`Testing login for: ${email}`);
  console.log(`Password: ${password}`);
  
  // Find user
  const user = await db.collection("user").findOne({ email: email.toLowerCase() });
  if (!user) {
    console.log("❌ User not found!");
    await client.close();
    return;
  }
  
  console.log(`\n✅ User found:`);
  console.log(`   _id: ${user._id}`);
  console.log(`   email: ${user.email}`);
  
  // Find account
  const account = await db.collection("account").findOne({ 
    userId: user._id,
    providerId: "credential"
  });
  
  if (!account) {
    console.log("\n❌ Credential account not found!");
    await client.close();
    return;
  }
  
  console.log(`\n✅ Credential account found:`);
  console.log(`   password hash format: ${account.password?.includes(":") ? "salt:key (scrypt)" : "unknown"}`);
  console.log(`   password hash: ${account.password?.substring(0, 40)}...`);
  
  // Test password verification with Better Auth's verifyPassword
  try {
    const isValid = await verifyPassword({ hash: account.password, password });
    console.log(`\n🔑 Password verification: ${isValid ? "✅ VALID" : "❌ INVALID"}`);
  } catch (err) {
    console.log(`\n❌ Password verification error: ${err}`);
  }
  
  await client.close();
}

main();
