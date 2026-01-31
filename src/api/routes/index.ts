import { Router } from "express";
import adminRoutes from "./admin.routes.js";
import workspaceRoutes from "./workspace.routes.js";
import channelRoutes from "./channel.routes.js";
import projectRoutes from "./project.routes.js";
import userRoutes from "./user.routes.js";

const router = Router();

// Mount all route modules
router.use("/admin", adminRoutes);
router.use("/workspaces", workspaceRoutes);
router.use("/channels", channelRoutes);
router.use("/projects", projectRoutes);
router.use("/user", userRoutes);

export default router;

// Also export individual routes for flexibility
export {
  adminRoutes,
  workspaceRoutes,
  channelRoutes,
  projectRoutes,
  userRoutes,
};
