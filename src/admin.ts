// import {DocumentData} from "@google-cloud/firestore";
import * as functions from "firebase-functions";
import * as express from "express";
import * as cors from "cors";
import * as sgMail from "@sendgrid/mail";
import authenticationMiddleware from "./authenticationMiddleware";
import { SENDGRID_API_KEY } from "./config";

const app = express();

// Automatically allow cross-origin requests
app.use(cors({ origin: true }));

let sendgridReady = false;
function initSendgrid() {
  if (!sendgridReady) {
    sgMail.setApiKey(SENDGRID_API_KEY.value());
    sendgridReady = true;
  }
}

app.post("/send-feedbackemail", authenticationMiddleware, async (req, res) => {
  try {
    functions.logger.info("Sending email", { structuredData: true });
    initSendgrid();
    try {
      const msg = {
        to: "womanfullstackdeveloper@gmail.com",
        from: "no-reply@piatto.com.au",
        templateId: "d-98ef125ed6144d089be33267153b04f3",
        dynamicTemplateData: {
          name: req.body.name,
          email: req.body.email,
          id: (req as any).user.uid,
          deviceId: req.body.deviceId,
          feedback: req.body.feedback,
        },
        html: `<strong>User Feedback:</strong> <p>${req.body.feeback} </p>`,
      } as any;
      await sgMail.send(msg);
      res.json(true);
    } catch (error) {
      console.error(error);
      res.status(500).json(false);
    }
  } catch (err) {
    functions.logger.info(err, { structuredData: true });
  }
});

app.post("/send-disputeemail", authenticationMiddleware, async (req, res) => {
  try {
    initSendgrid();
    const { orderId, bizId, titles, detail } = req.body;
    const msg = {
      to: "womanfullstackdeveloper@gmail.com",
      from: "no-reply@piatto.com.au",
      subject: `Dispute for Order ID': ${orderId}`,
      text: `A dispute has been raised for Order ID: ${orderId} at Business ID: ${bizId}. \n\nIssues: ${titles.join(", ")}\n\nDetails: ${detail}`,
    } as any;
    await sgMail.send(msg);
    res.json({ success: true });
  } catch (error: any) {
    console.error("Error sending dispute email:", error);
    res.status(500).json({ success: false, error: error.message });
  }
});

export const admin = functions
  .region("australia-southeast1")
  .runWith({ secrets: [SENDGRID_API_KEY] })
  .https.onRequest(app);

