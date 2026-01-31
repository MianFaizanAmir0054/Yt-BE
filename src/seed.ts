// Seed script for initializing database with super admin
// Run with: npm run seed

// Load environment variables synchronously at module load
import * as dotenv from "dotenv";
import path from "path";

// Load from project root (server folder is one level deep)
dotenv.config({ path: path.join(process.cwd(), ".env.local") });
dotenv.config({ path: path.join(process.cwd(), ".env") });

// Validate required env vars
if (!process.env.MONGODB_URI) {
  console.error("❌ MONGODB_URI environment variable is not set!");
  console.error("   Please create a .env.local file with MONGODB_URI=mongodb://localhost:27017/yt-auto");
  process.exit(1);
}

// Now import after env is loaded
import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { MongoClient, ObjectId } from "mongodb";
import { hashPassword } from "better-auth/crypto";

interface SeedConfig {
  superAdmin: {
    name: string;
    email: string;
    password: string;
  };
  createDemoData?: boolean;
}

const defaultConfig: SeedConfig = {
  superAdmin: {
    name: process.env.SUPER_ADMIN_NAME || "Super Admin",
    email: process.env.SUPER_ADMIN_EMAIL || "admin@ytauto.com",
    password: process.env.SUPER_ADMIN_PASSWORD || "Admin@123",
  },
  createDemoData: process.env.CREATE_DEMO_DATA === "true",
};

// Define schemas inline to avoid import issues
const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
    password: { type: String },
    image: { type: String },
    role: {
      type: String,
      enum: ["super_admin", "admin", "collaborator"],
      default: "collaborator",
    },
    createdBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    isActive: { type: Boolean, default: true },
    apiKeys: {
      openai: String,
      anthropic: String,
      perplexity: String,
      pexels: String,
      segmind: String,
      elevenLabs: String,
    },
    preferences: {
      defaultAspectRatio: { type: String, default: "9:16" },
      defaultVoice: String,
      theme: { type: String, default: "system" },
    },
  },
  { timestamps: true }
);

const channelSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    youtubeChannelId: { type: String, unique: true, sparse: true },
    youtubeHandle: { type: String },
    description: { type: String },
    thumbnailUrl: { type: String },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    youtubeCredentials: {
      accessToken: String,
      refreshToken: String,
      expiresAt: Date,
    },
    defaultAspectRatio: { type: String, default: "9:16" },
    defaultVoiceId: { type: String },
    brandColors: {
      primary: { type: String, default: "#6366f1" },
      secondary: { type: String, default: "#818cf8" },
      accent: { type: String, default: "#c7d2fe" },
    },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const workspaceSchema = new mongoose.Schema(
  {
    name: { type: String, required: true },
    description: { type: String },
    ownerId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    channelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Channel" }],
    settings: {
      requireApproval: { type: Boolean, default: false },
    },
  },
  { timestamps: true }
);

const workspaceMemberSchema = new mongoose.Schema(
  {
    workspaceId: { type: mongoose.Schema.Types.ObjectId, ref: "Workspace", required: true },
    userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
    role: {
      type: String,
      enum: ["admin", "editor", "viewer"],
      default: "editor",
    },
    invitedBy: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
    inviteToken: { type: String },
    status: {
      type: String,
      enum: ["pending", "accepted", "rejected", "removed"],
      default: "pending",
    },
    permissions: {
      canCreateProjects: { type: Boolean, default: true },
      canEditProjects: { type: Boolean, default: true },
      canDeleteProjects: { type: Boolean, default: false },
      canPublish: { type: Boolean, default: false },
      channelIds: [{ type: mongoose.Schema.Types.ObjectId, ref: "Channel" }],
    },
  },
  { timestamps: true }
);

// Get or create models
const User = mongoose.models.User || mongoose.model("User", userSchema);
const Channel = mongoose.models.Channel || mongoose.model("Channel", channelSchema);
const Workspace = mongoose.models.Workspace || mongoose.model("Workspace", workspaceSchema);
const WorkspaceMember = mongoose.models.WorkspaceMember || mongoose.model("WorkspaceMember", workspaceMemberSchema);

// MongoDB native client for Better Auth collections
let mongoClient: MongoClient;

async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState >= 1) {
    return;
  }
  await mongoose.connect(process.env.MONGODB_URI!);
  
  // Also connect native MongoDB client for Better Auth
  mongoClient = new MongoClient(process.env.MONGODB_URI!);
  await mongoClient.connect();
}

async function disconnectDB(): Promise<void> {
  await mongoose.disconnect();
  if (mongoClient) {
    await mongoClient.close();
  }
}

// Create user in Better Auth's "user" collection
async function createBetterAuthUser(email: string, password: string, name: string): Promise<string> {
  const db = mongoClient.db();
  const userCollection = db.collection("user");
  
  // Check if user already exists in Better Auth
  const existingUser = await userCollection.findOne({ email: email.toLowerCase() });
  if (existingUser) {
    console.log(`   (Better Auth user already exists: ${email})`);
    // Return _id as string (Better Auth MongoDB adapter uses _id as id)
    return existingUser._id.toString();
  }
  
  // Hash password using Better Auth's scrypt-based hasher (NOT bcrypt!)
  // Better Auth uses format: "salt:key" (both hex-encoded)
  const hashedPassword = await hashPassword(password);
  
  // Create user in Better Auth format
  // NOTE: DO NOT include an 'id' field - let MongoDB use _id
  // The MongoDB adapter automatically converts _id to id when reading
  const userResult = await userCollection.insertOne({
    email: email.toLowerCase(),
    name,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  
  const userObjectId = userResult.insertedId;
  
  // Create account entry for email/password auth
  // IMPORTANT: userId must be stored as ObjectId, not string!
  // Better Auth's MongoDB adapter converts userId to ObjectId when querying
  const accountCollection = db.collection("account");
  await accountCollection.insertOne({
    userId: userObjectId,  // Store as ObjectId, not string
    accountId: userObjectId.toString(),
    providerId: "credential",
    password: hashedPassword,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  
  console.log(`   ✅ Better Auth user created: ${email}`);
  return userObjectId.toString();
}

async function seedSuperAdmin(config: SeedConfig) {
  console.log("🌱 Seeding database...\n");

  // First, create in Better Auth (for login)
  console.log("Creating Better Auth users...");
  await createBetterAuthUser(
    config.superAdmin.email,
    config.superAdmin.password,
    config.superAdmin.name
  );

  // Check if super admin already exists in our User model
  const existingSuperAdmin = await User.findOne({ role: "super_admin" });

  if (existingSuperAdmin) {
    console.log(`✅ Super admin already exists: ${existingSuperAdmin.email}`);
    return existingSuperAdmin;
  }

  // Create super admin in our User model
  const hashedPassword = await bcrypt.hash(config.superAdmin.password, 12);

  const superAdmin = await User.create({
    name: config.superAdmin.name,
    email: config.superAdmin.email.toLowerCase(),
    password: hashedPassword,
    role: "super_admin",
    isActive: true,
  });

  console.log(`✅ Super admin created:`);
  console.log(`   Email: ${superAdmin.email}`);
  console.log(`   Password: ${config.superAdmin.password}`);
  console.log(`   ⚠️  Please change the password after first login!\n`);

  return superAdmin;
}

async function seedDemoData(superAdminId: string) {
  console.log("📦 Creating demo data...\n");

  // Create Better Auth users for demo accounts
  console.log("Creating Better Auth demo users...");
  await createBetterAuthUser("demo-admin@ytauto.com", "Demo@123", "Demo Admin");
  await createBetterAuthUser("demo-collab@ytauto.com", "Collab@123", "Demo Collaborator");

  // Create a demo admin
  const existingAdmin = await User.findOne({ email: "demo-admin@ytauto.com" });
  let demoAdmin = existingAdmin;

  if (!existingAdmin) {
    const hashedPassword = await bcrypt.hash("Demo@123", 12);
    demoAdmin = await User.create({
      name: "Demo Admin",
      email: "demo-admin@ytauto.com",
      password: hashedPassword,
      role: "admin",
      createdBy: superAdminId,
      isActive: true,
    });
    console.log(`✅ Demo admin created: demo-admin@ytauto.com / Demo@123`);
  } else {
    console.log(`✅ Demo admin already exists: demo-admin@ytauto.com`);
  }

  // Create a demo collaborator
  const existingCollaborator = await User.findOne({ email: "demo-collab@ytauto.com" });
  let demoCollaborator = existingCollaborator;

  if (!existingCollaborator) {
    const hashedPassword = await bcrypt.hash("Collab@123", 12);
    demoCollaborator = await User.create({
      name: "Demo Collaborator",
      email: "demo-collab@ytauto.com",
      password: hashedPassword,
      role: "collaborator",
      createdBy: superAdminId,
      isActive: true,
    });
    console.log(`✅ Demo collaborator created: demo-collab@ytauto.com / Collab@123`);
  } else {
    console.log(`✅ Demo collaborator already exists: demo-collab@ytauto.com`);
  }

  // Create demo channels
  const existingChannel = await Channel.findOne({ youtubeChannelId: "UCdemo123" });
  let demoChannel = existingChannel;

  if (!existingChannel) {
    demoChannel = await Channel.create({
      name: "Demo Tech Channel",
      youtubeChannelId: "UCdemo123",
      youtubeHandle: "@demotechch",
      description: "A demo channel for testing",
      ownerId: demoAdmin!._id,
      defaultAspectRatio: "9:16",
      brandColors: {
        primary: "#6366f1",
        secondary: "#818cf8",
        accent: "#c7d2fe",
      },
      isActive: true,
    });
    console.log(`✅ Demo channel created: Demo Tech Channel`);
  } else {
    console.log(`✅ Demo channel already exists: Demo Tech Channel`);
  }

  // Create a second demo channel
  const existingChannel2 = await Channel.findOne({ youtubeChannelId: "UCdemo456" });
  let demoChannel2 = existingChannel2;

  if (!existingChannel2) {
    demoChannel2 = await Channel.create({
      name: "Demo Gaming Channel",
      youtubeChannelId: "UCdemo456",
      youtubeHandle: "@demogamingch",
      description: "A demo gaming channel for testing",
      ownerId: demoAdmin!._id,
      defaultAspectRatio: "9:16",
      brandColors: {
        primary: "#ef4444",
        secondary: "#f87171",
        accent: "#fecaca",
      },
      isActive: true,
    });
    console.log(`✅ Demo channel created: Demo Gaming Channel`);
  } else {
    console.log(`✅ Demo channel already exists: Demo Gaming Channel`);
  }

  // Create demo workspace
  const existingWorkspace = await Workspace.findOne({ name: "Demo Workspace" });
  let demoWorkspace = existingWorkspace;

  if (!existingWorkspace) {
    demoWorkspace = await Workspace.create({
      name: "Demo Workspace",
      description: "A demo workspace for testing the platform",
      ownerId: demoAdmin!._id,
      channelIds: [demoChannel!._id, demoChannel2!._id],
      settings: {
        requireApproval: false,
      },
    });
    console.log(`✅ Demo workspace created: Demo Workspace`);

    // Add collaborator to workspace
    await WorkspaceMember.create({
      workspaceId: demoWorkspace._id,
      userId: demoCollaborator!._id,
      role: "editor",
      invitedBy: demoAdmin!._id,
      status: "accepted",
    });
    console.log(`✅ Demo collaborator added to workspace`);
  } else {
    console.log(`✅ Demo workspace already exists: Demo Workspace`);
  }

  console.log("\n📋 Demo Data Summary:");
  console.log("   Admin: demo-admin@ytauto.com / Demo@123");
  console.log("   Collaborator: demo-collab@ytauto.com / Collab@123");
  console.log("   Workspace: Demo Workspace (with 2 channels)");
}

async function main() {
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB\n");

    const superAdmin = await seedSuperAdmin(defaultConfig);

    if (defaultConfig.createDemoData) {
      await seedDemoData(superAdmin._id.toString());
    }

    console.log("\n🎉 Seeding complete!");
  } catch (error) {
    console.error("❌ Seeding failed:", error);
    process.exit(1);
  } finally {
    await disconnectDB();
    process.exit(0);
  }
}

main();
