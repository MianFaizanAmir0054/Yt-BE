import { Router } from "express";
import multer from "multer";
import path from "path";
import { requireAuth } from "../middlewares/index.js";
import { validateObjectId, validateRequired } from "../middlewares/index.js";
import * as projectController from "../controllers/project.controller.js";
import * as generationController from "../controllers/generation.controller.js";
import { asyncHandler } from "../utils/index.js";

const router = Router();

// Configure multer for voiceover uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(process.cwd(), "uploads", "voiceovers");
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(null, `voiceover-${uniqueSuffix}${path.extname(file.originalname)}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: (req, file, cb) => {
    const allowedTypes = [
      "audio/mpeg",
      "audio/wav",
      "audio/mp4",
      "audio/m4a",
      "audio/x-m4a",
      "audio/mp3",
    ];
    if (allowedTypes.includes(file.mimetype) || file.originalname.match(/\.(mp3|wav|m4a|mp4)$/i)) {
      cb(null, true);
    } else {
      cb(new Error("Invalid audio format. Supported: MP3, WAV, M4A"));
    }
  },
});

// All project routes require authentication
router.use(requireAuth);

// ============ Project CRUD ============

/**
 * GET /api/projects
 * List projects user has access to
 */
router.get("/", asyncHandler(projectController.listProjects));

/**
 * GET /api/projects/stats
 * Get project statistics for a workspace
 */
router.get("/stats", asyncHandler(projectController.getProjectStats));

/**
 * GET /api/projects/:id
 * Get single project details
 */
router.get("/:id", validateObjectId("id"), asyncHandler(projectController.getProject));

/**
 * POST /api/projects
 * Create a new project
 */
router.post(
  "/",
  validateRequired(["title", "workspaceId"]),
  asyncHandler(projectController.createProject)
);

/**
 * PUT /api/projects/:id
 * Update project
 */
router.put("/:id", validateObjectId("id"), asyncHandler(projectController.updateProject));

/**
 * DELETE /api/projects/:id
 * Delete project
 */
router.delete("/:id", validateObjectId("id"), asyncHandler(projectController.deleteProject));

// ============ Project Status Management ============

/**
 * PUT /api/projects/:id/status
 * Update project status
 */
router.put(
  "/:id/status",
  validateObjectId("id"),
  validateRequired(["status"]),
  asyncHandler(projectController.updateStatus)
);

/**
 * PUT /api/projects/:id/submit
 * Submit project for review
 */
router.put("/:id/submit", validateObjectId("id"), asyncHandler(projectController.submitForReview));

/**
 * PUT /api/projects/:id/approve
 * Approve project
 */
router.put("/:id/approve", validateObjectId("id"), asyncHandler(projectController.approveProject));

/**
 * POST /api/projects/:id/reject
 * Reject project
 */
router.post("/:id/reject", validateObjectId("id"), asyncHandler(projectController.rejectProject));

// ============ Project Generation (AI) ============

/**
 * POST /api/projects/:id/research
 * Generate research and script for a project
 */
router.post("/:id/research", validateObjectId("id"), asyncHandler(generationController.generateResearch));

/**
 * POST /api/projects/:id/voiceover
 * Upload and analyze voiceover audio
 */
router.post(
  "/:id/voiceover",
  validateObjectId("id"),
  upload.single("audio"),
  asyncHandler(generationController.uploadVoiceover)
);

/**
 * POST /api/projects/:id/images
 * Generate images for project scenes
 */
router.post("/:id/images", validateObjectId("id"), asyncHandler(generationController.generateImages));

/**
 * POST /api/projects/:id/scene-videos
 * Generate AI video clips for each scene using Fabric 1.0
 */
router.post("/:id/scene-videos", validateObjectId("id"), asyncHandler(generationController.generateSceneVideosEndpoint));

/**
 * POST /api/projects/:id/generate
 * Generate/assemble the final video
 */
router.post("/:id/generate", validateObjectId("id"), asyncHandler(generationController.generateVideo));

// ============ Timeline Management ============

/**
 * PUT /api/projects/:id/timeline
 * Update project timeline
 */
router.put("/:id/timeline", validateObjectId("id"), asyncHandler(generationController.updateTimeline));

/**
 * POST /api/projects/:id/timeline
 * Add a scene to the timeline
 */
router.post("/:id/timeline", validateObjectId("id"), asyncHandler(generationController.addTimelineScene));

/**
 * DELETE /api/projects/:id/timeline/:sceneId
 * Remove a scene from the timeline
 */
router.delete(
  "/:id/timeline/:sceneId",
  validateObjectId("id"),
  asyncHandler(generationController.deleteTimelineScene)
);

export default router;
