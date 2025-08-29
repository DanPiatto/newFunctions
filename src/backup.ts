import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { FirestoreAdminClient } from '@google-cloud/firestore/build/src/v1/firestore_admin_client';
import { BACKUP_BUCKET_URI } from "./config";

function getDateString(): string {
  const date = new Date();
  return date.toISOString().split('T')[0]; // Returns date in YYYY-MM-DD format
}

export const DailyscheduledFirestoreBackup = functions
  .region('australia-southeast1')
  .pubsub.schedule('0 0 * * *') // Daily at midnight
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    const client = new FirestoreAdminClient();
    const projectId = process.env.GCP_PROJECT || process.env.GCLOUD_PROJECT;
    const bucket = BACKUP_BUCKET_URI.value(); // e.g. gs://<project>.appspot.com/backups

    try {
      const response = await client.exportDocuments({
        name: `projects/${projectId}/databases/(default)`,
        outputUriPrefix: bucket + '/backups/' + getDateString(),
        collectionIds: [] // Empty array means all collections
      });
      console.log(`Backup started: ${response[0].name}`);
      return null;
    } catch (error) {
      console.error('Export failed:', error);
      throw new Error('Backup failed');
    }
  });

export const weeklyFunctionsBackup = functions
  .region('australia-southeast1')
  .pubsub.schedule('0 0 * * 0') // Runs at midnight every Sunday
  .timeZone('Australia/Sydney')
  .onRun(async () => {
    try {
      // Export Firebase functions code
      const functionsBackupPath = `backups/functions/weekly/${new Date().toISOString()}`;
      const bucket = admin.storage().bucket();

      // Get all function files
      const functionFiles = [
        'business.js',
        'user.js',
        'admin.js',
        'index.js'
      ];

      for (const file of functionFiles) {
        await bucket.upload(`./lib/${file}`, {
          destination: `${functionsBackupPath}/${file}`
        });
      }

      return null;
    } catch (error) {
      console.error('Weekly Functions backup failed:', error);
      return null;
    }
  });

