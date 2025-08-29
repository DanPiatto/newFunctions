import { DocumentData } from "@google-cloud/firestore";
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import { v4 as uuidv4 } from "uuid";

/**
 * Firestore trigger to add user favorites when an order is created.
 * - Runs on Node 20 with firebase-functions v5 code style.
 * - Uses current Orders schema in this codebase (dish.dishID, orderPaymentType, orderPaymentDistance).
 * - Avoids duplication when favorites were already added inline in the order flow by
 *   skipping insertion if any UserFav document exists for the (userId, orderId) pair.
 */
export const addUserFavorite = functions
  .region("australia-southeast1")
  .firestore.document("Orders/{orderDocId}")
  .onCreate(async (snapshot, context) => {
    const data = snapshot.data() || {} as any;

    const userId: string | undefined = data.userId;
    const dishes: any[] = Array.isArray(data.dishes) ? data.dishes : [];
    const orderId: string = data.orderId || context.params.orderDocId;
    const bizId = data.bizId;

    if (!userId || dishes.length === 0 || !bizId) {
      // Nothing to do if required fields are missing
      return;
    }

    // If any favorites already exist for this order, skip to avoid duplication
    const favSnap = await admin
      .firestore()
      .collection("UserFav")
      .where("userId", "==", userId)
      .where("orderId", "==", orderId)
      .limit(1)
      .get();

    if (!favSnap.empty) {
      // Inline flow likely already created favorites; skip
      return;
    }

    const userFavCollection = admin.firestore().collection("UserFav");

    const tasks = dishes.map(async (dish: any) => {
      // Prefer dish.dishID as used in the current codebase; fall back to common variants
      const dishId: string | undefined = dish?.dishID || dish?.dishId || dish?.id;
      if (!dishId) return; // Skip malformed dish entries

      const favDoc = {
        id: uuidv4(),
        bizId: String(bizId),
        favDet: dishId,
        favOrder: dishId,
        userId: userId,
        orderId: orderId,
        // orderType is not reliably present on the order document; omit to avoid incorrect values
        orderPaymentType: data.orderPaymentType ?? null,
        orderPaymentDistance: data.orderPaymentDistance ?? "",
      } as DocumentData;

      await userFavCollection.doc().set(favDoc);
    });

    await Promise.all(tasks);
  });

