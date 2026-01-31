import { Router } from "express";
import { requireSuperAdmin } from "../middlewares/index.js";
import { validateObjectId, validateRequired, lowercaseEmail } from "../middlewares/index.js";
import * as adminController from "../controllers/admin.controller.js";
import { asyncHandler } from "../utils/index.js";

const router = Router();

// Apply super admin check to all routes
router.use(requireSuperAdmin);

// ============ User Management ============

/**
 * GET /api/admin/users
 * List all users (super admin only)
 */
router.get("/users", asyncHandler(adminController.listUsers));

/**
 * GET /api/admin/users/:id
 * Get single user details
 */
router.get("/users/:id", validateObjectId("id"), asyncHandler(adminController.getUser_));

/**
 * POST /api/admin/users
 * Create a new user (admin or collaborator)
 */
router.post(
  "/users",
  validateRequired(["name", "email", "password"]),
  lowercaseEmail("email"),
  asyncHandler(adminController.createUser)
);

/**
 * PUT /api/admin/users/:id
 * Update user
 */
router.put("/users/:id", validateObjectId("id"), asyncHandler(adminController.updateUser));

/**
 * DELETE /api/admin/users/:id
 * Delete user
 */
router.delete("/users/:id", validateObjectId("id"), asyncHandler(adminController.deleteUser));

/**
 * PUT /api/admin/users/:id/password
 * Reset user password
 */
router.put(
  "/users/:id/password",
  validateObjectId("id"),
  validateRequired(["password"]),
  asyncHandler(adminController.resetPassword)
);

// ============ Statistics ============

/**
 * GET /api/admin/stats
 * Get admin dashboard statistics
 */
router.get("/stats", asyncHandler(adminController.getStats));

export default router;
