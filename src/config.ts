import { defineSecret, defineString } from "firebase-functions/params";

// Secrets
export const SENDGRID_API_KEY = defineSecret("SENDGRID_API_KEY");
export const STRIPE_SECRET_KEY = defineSecret("STRIPE_SECRET_KEY");
export const OPENAI_API_KEY = defineSecret("OPENAI_API_KEY");
export const GOOGLE_CLIENT_SECRET = defineSecret("GOOGLE_CLIENT_SECRET");

// Non-secret parameters
export const GOOGLE_CLIENT_ID = defineString("GOOGLE_CLIENT_ID");
export const GOOGLE_REDIRECT_URL = defineString("GOOGLE_REDIRECT_URL");
export const PDF_RENDERER_URL = defineString("PDF_RENDERER_URL");
export const BACKUP_BUCKET_URI = defineString("BACKUP_BUCKET_URI");

