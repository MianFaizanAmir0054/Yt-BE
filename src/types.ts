import { Request as ExpressRequest } from "express";

// Extend Express Request to include user and file
export interface AuthenticatedRequest extends ExpressRequest {
  user?: {
    id: string;
    email: string;
    name: string;
    image?: string;
  };
}

// Re-export multer callback types
export type MulterDiskStorageCallback = (error: Error | null, destination: string) => void;
export type MulterFileFilterCallback = (error: Error | null, acceptFile: boolean) => void;
