import * as admin from "firebase-admin";

// Initialize using default credentials. In Cloud Functions, this uses the service account
// associated with the deployed function. Do NOT load JSON keys from source code.
admin.initializeApp();

export * from "./business";
export * from "./user";
export * from "./admin";
export * from "./computervision";
export * from "./backup";
export * from "./userfav";

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript

