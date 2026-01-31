import crypto from "crypto";

const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY!;
const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;

/**
 * Encrypt a string using AES-256-GCM
 */
export function encrypt(text: string): string {
  if (!text) return "";
  
  const iv = crypto.randomBytes(IV_LENGTH);
  const key = Buffer.from(ENCRYPTION_KEY, "hex");
  
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  
  const authTag = cipher.getAuthTag();
  
  // Combine IV + Auth Tag + Encrypted data
  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypt a string using AES-256-GCM
 */
export function decrypt(encryptedText: string): string {
  if (!encryptedText) return "";
  
  try {
    const parts = encryptedText.split(":");
    if (parts.length !== 3) {
      throw new Error("Invalid encrypted text format");
    }
    
    const [ivHex, authTagHex, encrypted] = parts;
    
    const iv = Buffer.from(ivHex, "hex");
    const authTag = Buffer.from(authTagHex, "hex");
    const key = Buffer.from(ENCRYPTION_KEY, "hex");
    
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(encrypted, "hex", "utf8");
    decrypted += decipher.final("utf8");
    
    return decrypted;
  } catch (error) {
    console.error("Decryption error:", error);
    return "";
  }
}

/**
 * Encrypt user API keys for storage
 */
export function encryptApiKeys(
  apiKeys: Record<string, string | undefined>
): Record<string, string | undefined> {
  const encrypted: Record<string, string | undefined> = {};
  
  for (const [key, value] of Object.entries(apiKeys)) {
    encrypted[key] = value ? encrypt(value) : undefined;
  }
  
  return encrypted;
}

/**
 * Decrypt user API keys for use
 */
export function decryptApiKeys(
  encryptedKeys: Record<string, string | undefined>
): Record<string, string | undefined> {
  const decrypted: Record<string, string | undefined> = {};
  
  for (const [key, value] of Object.entries(encryptedKeys)) {
    decrypted[key] = value ? decrypt(value) : undefined;
  }
  
  return decrypted;
}

/**
 * Mask API key for display (show first 4 and last 4 chars)
 */
export function maskApiKey(key: string): string {
  if (!key || key.length < 12) return "••••••••";
  return `${key.slice(0, 4)}••••••••${key.slice(-4)}`;
}
