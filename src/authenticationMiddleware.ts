import * as admin from "firebase-admin";
import * as express from "express";

const validateFirebaseIdToken = async (
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
) => {
  if (
    (!req.headers.authorization ||
      !req.headers.authorization.startsWith("Bearer ")) &&
    !(req.cookies && req.cookies.__session)
  ) {
    res.status(403).send("Unauthorized!!!");
    return;
  }

  let idToken;
  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {

    // Read the ID Token from the Authorization header.
    idToken = req.headers.authorization.split("Bearer ")[1];
  } else if (req.cookies) {

    // Read the ID Token from cookie.
    idToken = req.cookies.__session;
  } else {
    // No cookie
    res.status(403).send("Unauthorized!!!");
    return;
  }

  try {
    const decodedIdToken = await admin.auth().verifyIdToken(idToken);

    (req as any).user = decodedIdToken;
    next();
    return;
  } catch (error) {
    console.error("Error while verifying Firebase ID token:", error);
    res.status(403).send("Unauthorized!!!");
    return;
  }
};

export default validateFirebaseIdToken;
