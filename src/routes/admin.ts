import { Router, Request, Response, RequestHandler } from "express";
import bcrypt from "bcryptjs";
import User from "../models/User.js";
import Channel from "../models/Channel.js";
import Workspace from "../models/Workspace.js";
import Project from "../models/Project.js";

const router = Router();

// Type for authenticated user attached by middleware
interface AuthUser {
  id: string;
  email: string;
  name: string;
  role?: string;
}

// Helper to get user from request
function getUser(req: Request): AuthUser | undefined {
  return (req as unknown as { user?: AuthUser }).user;
}

// Middleware to check if user is super admin
const requireSuperAdmin: RequestHandler = async (req, res, next) => {
  const user = getUser(req);
  if (!user) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  // Look up user by email since Better Auth and Mongoose User have different IDs
  const dbUser = await User.findOne({ email: user.email.toLowerCase() });
  if (!dbUser || dbUser.role !== "super_admin") {
    return res.status(403).json({ error: "Forbidden - Super Admin access required" });
  }

  // Attach dbUser to request for use in route handlers
  (req as unknown as { dbUser: typeof dbUser }).dbUser = dbUser;

  next();
};

// Apply super admin check to all routes
router.use(requireSuperAdmin as RequestHandler);

/**
 * GET /api/admin/users
 * List all admins (super admin only)
 */
router.get("/users", (async (req: Request, res: Response) => {
  try {
    const { role, search, page = 1, limit = 20 } = req.query;

    const query: Record<string, unknown> = {};
    
    if (role && role !== "all") {
      query.role = role;
    }
    
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { email: { $regex: search, $options: "i" } },
      ];
    }

    const skip = (Number(page) - 1) * Number(limit);
    
    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password -apiKeys")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(Number(limit)),
      User.countDocuments(query),
    ]);

    res.json({
      users,
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
}) as RequestHandler);

/**
 * POST /api/admin/users
 * Create a new admin (super admin only)
 */
router.post("/users", (async (req: Request, res: Response) => {
  try {
    const currentUser = getUser(req);
    const { name, email, password, role = "admin" } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ error: "Name, email, and password are required" });
    }

    // Only allow creating admin or collaborator roles
    if (!["admin", "collaborator"].includes(role)) {
      return res.status(400).json({ error: "Invalid role. Must be 'admin' or 'collaborator'" });
    }

    // Check if email already exists
    const existingUser = await User.findOne({ email: email.toLowerCase() });
    if (existingUser) {
      return res.status(400).json({ error: "Email already registered" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 12);

    const user = await User.create({
      name,
      email: email.toLowerCase(),
      password: hashedPassword,
      role,
      createdBy: currentUser!.id,
      isActive: true,
    });

    res.status(201).json({
      message: "User created successfully",
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive,
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Error creating user:", error);
    res.status(500).json({ error: "Failed to create user" });
  }
}) as RequestHandler);

/**
 * GET /api/admin/users/:id
 * Get single user details (super admin only)
 */
router.get("/users/:id", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;

    const user = await User.findById(id).select("-password -apiKeys");
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    res.json({ user });
  } catch (error) {
    console.error("Error fetching user:", error);
    res.status(500).json({ error: "Failed to fetch user" });
  }
}) as RequestHandler);

/**
 * PUT /api/admin/users/:id
 * Update user (super admin only)
 */
router.put("/users/:id", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { name, email, role, isActive } = req.body;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    // Don't allow changing super_admin role
    if (user.role === "super_admin") {
      return res.status(403).json({ error: "Cannot modify super admin" });
    }

    // Don't allow promoting to super_admin
    if (role === "super_admin") {
      return res.status(403).json({ error: "Cannot promote to super admin" });
    }

    const updates: Record<string, unknown> = {};
    if (name !== undefined) updates.name = name;
    if (email !== undefined) updates.email = email.toLowerCase();
    if (role !== undefined && ["admin", "collaborator"].includes(role)) {
      updates.role = role;
    }
    if (isActive !== undefined) updates.isActive = isActive;

    const updatedUser = await User.findByIdAndUpdate(
      id,
      { $set: updates },
      { new: true }
    ).select("-password -apiKeys");

    res.json({
      message: "User updated successfully",
      user: updatedUser,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
}) as RequestHandler);

/**
 * DELETE /api/admin/users/:id
 * Delete/deactivate user (super admin only)
 */
router.delete("/users/:id", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { permanent = false } = req.query;

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "super_admin") {
      return res.status(403).json({ error: "Cannot delete super admin" });
    }

    if (permanent === "true") {
      await User.findByIdAndDelete(id);
      res.json({ message: "User permanently deleted" });
    } else {
      await User.findByIdAndUpdate(id, { isActive: false });
      res.json({ message: "User deactivated" });
    }
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
}) as RequestHandler);

/**
 * POST /api/admin/users/:id/reset-password
 * Reset user password (super admin only)
 */
router.post("/users/:id/reset-password", (async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 6) {
      return res.status(400).json({ error: "Password must be at least 6 characters" });
    }

    const user = await User.findById(id);
    if (!user) {
      return res.status(404).json({ error: "User not found" });
    }

    if (user.role === "super_admin") {
      return res.status(403).json({ error: "Cannot reset super admin password via this endpoint" });
    }

    const hashedPassword = await bcrypt.hash(newPassword, 12);
    await User.findByIdAndUpdate(id, { password: hashedPassword });

    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ error: "Failed to reset password" });
  }
}) as RequestHandler);

/**
 * GET /api/admin/stats
 * Get system statistics (super admin only)
 */
router.get("/stats", (async (req: Request, res: Response) => {
  try {
    const [
      totalAdmins,
      totalCollaborators,
      activeUsers,
      totalChannels,
      totalWorkspaces,
      totalProjects,
    ] = await Promise.all([
      User.countDocuments({ role: "admin" }),
      User.countDocuments({ role: "collaborator" }),
      User.countDocuments({ isActive: true }),
      Channel.countDocuments(),
      Workspace.countDocuments(),
      Project.countDocuments(),
    ]);

    res.json({
      stats: {
        users: {
          admins: totalAdmins,
          collaborators: totalCollaborators,
          active: activeUsers,
        },
        channels: totalChannels,
        workspaces: totalWorkspaces,
        projects: totalProjects,
      },
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Failed to fetch statistics" });
  }
}) as RequestHandler);

export default router;
