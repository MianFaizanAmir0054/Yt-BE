import { Request, Response, NextFunction } from "express";

/**
 * Validate required fields in request body
 */
export function validateRequired(fields: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const missing: string[] = [];
    
    for (const field of fields) {
      if (req.body[field] === undefined || req.body[field] === null || req.body[field] === "") {
        missing.push(field);
      }
    }

    if (missing.length > 0) {
      return res.status(400).json({
        error: "Missing required fields",
        details: { missing },
      });
    }

    next();
  };
}

/**
 * Validate MongoDB ObjectId format
 */
export function validateObjectId(paramName: string = "id") {
  return (req: Request, res: Response, next: NextFunction) => {
    const rawId = req.params[paramName];
    const id = Array.isArray(rawId) ? rawId[0] : rawId;
    const objectIdRegex = /^[0-9a-fA-F]{24}$/;

    if (!id || !objectIdRegex.test(id)) {
      return res.status(400).json({
        error: `Invalid ${paramName} format`,
      });
    }

    next();
  };
}

/**
 * Validate email format
 */
export function validateEmail(fieldName: string = "email") {
  return (req: Request, res: Response, next: NextFunction) => {
    const email = req.body[fieldName];
    
    if (!email) {
      return next(); // Let required validation handle this
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        error: `Invalid ${fieldName} format`,
      });
    }

    next();
  };
}

/**
 * Validate enum values
 */
export function validateEnum(fieldName: string, allowedValues: string[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    const value = req.body[fieldName];
    
    if (!value) {
      return next(); // Let required validation handle this
    }

    if (!allowedValues.includes(value)) {
      return res.status(400).json({
        error: `Invalid ${fieldName}. Must be one of: ${allowedValues.join(", ")}`,
      });
    }

    next();
  };
}

/**
 * Sanitize and trim string fields
 */
export function sanitizeStrings(fields: string[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    for (const field of fields) {
      if (typeof req.body[field] === "string") {
        req.body[field] = req.body[field].trim();
      }
    }
    next();
  };
}

/**
 * Lowercase email fields
 */
export function lowercaseEmail(fieldName: string = "email") {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (typeof req.body[fieldName] === "string") {
      req.body[fieldName] = req.body[fieldName].toLowerCase().trim();
    }
    next();
  };
}
