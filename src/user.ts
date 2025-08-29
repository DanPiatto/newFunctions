import { DocumentData } from "@google-cloud/firestore";
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as express from "express";
import * as cors from "cors";
import Stripe from "stripe";
import { STRIPE_SECRET_KEY, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URL } from "./config";
import { google } from "googleapis";
import { v4 as uuidv4 } from "uuid";

// import { ReadLine } from "readline";
// import {resolve} from "dns";
import axios from "axios";
const qs = require("qs");

let stripeInstance: Stripe | null = null;
function getStripe(): Stripe {
  if (!stripeInstance) {
    stripeInstance = new Stripe(STRIPE_SECRET_KEY.value(), { apiVersion: "2020-08-27" });
  }
  return stripeInstance;
}
import authenticationMiddleware from "./authenticationMiddleware";
import { User, Order } from "./types";
import { sendPushNotifications } from "./util";
import sharp = require("sharp");
import { Timestamp } from "firebase-admin/firestore";
const path = require("path");

// from web backend
const app = express();

// const SCOPES = ["https://www.googleapis.com/auth/plus.business.manage"];
const SCOPES = [
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/business.manage",
];

const clientId = GOOGLE_CLIENT_ID.value();
const clientSecret = GOOGLE_CLIENT_SECRET.value();
const getTokenUrl = "https://oauth2.googleapis.com/token";
// const redirectUrl = "http://localhost:3002/AddBusiness";
const redirectUrl = GOOGLE_REDIRECT_URL.value();
const getUserDataUrl =
  "https://cloudresourcemanager.googleapis.com/v1/projects";

app.use(express.json());

// Automatically allow cross-origin requests
app.use(cors({ origin: true }));

app.post("/", async (req, res) => {
  functions.logger.info("Save User", { structuredData: true });

  const firestore = admin.firestore().collection("Users");

  // Create customer in Stripe
const customer = await getStripe().customers.create({
    email: req.body.userEmail,
    name: `${req.body.userFirstName} ${req.body.userLastName}`,
  });

  const user: DocumentData = {
    userEmail: req.body.userEmail,
    userDOB: new Date(req.body.userDOB).toISOString(),
    userPhone: req.body.userPhone,
    userFirstName: req.body.userFirstName,
    userLastName: req.body.userLastName,
    userId: req.body.userId,
    userStripeId: customer.id,
    // timestamp: admin.firestore.FieldValue.serverTimestamp(), // Add server timestamp
    timestamp: new Date(),
  };

  await firestore.doc().set(user);

  res.json(true);
});

app.post("/device", authenticationMiddleware, async (req, res) => {
  functions.logger.info("/device add device", { structuredData: true });
  if (!req.body.pushToken) {
    res.json(true);
    return;
  }
  const uid = (req as any).user.uid;
  const user = (await getUser(uid)) as User;
  functions.logger.info("/device add device doc id " + user.id);
  const userDevices = user?.userDevices || [];
  const device = userDevices.find((d) => {
    return d.name === req.body.deviceName;
  });
  if (device) {
    // Update push token because it has changed
    if (device?.pushToken !== req.body.pushToken) {
      device.pushToken = req.body.pushToken;
      const ref = admin.firestore().collection("Users").doc(user.id);
      await ref.update({ userDevices });
    }
  } else {
    userDevices.push({
      pushToken: req.body.pushToken,
      name: req.body.deviceName,
    });
    const ref = admin.firestore().collection("Users").doc(user.id);
    await ref.update({ userDevices });
  }
  functions.logger.info("/device done ");
  res.json(true);
});

app.put("/order/:orderId", authenticationMiddleware, async (req, res) => {
  try {
    functions.logger.info("/order", { structuredData: true });
    const order = await fetchOrder(req.params.orderId);

    if (!order) throw new Error("No order found for " + req.params.orderId);
    const orderUser = (await getUser(order.userId)) as User;
    const uid = (req as any).user.uid;
    const businessUser = (await getUser(uid)) as any;

    // If the user has businesses, ensure they have access to this order's business; otherwise allow only the order owner.
    if (Array.isArray(businessUser?.userBusinesses) && businessUser.userBusinesses.length > 0) {
      const bizId = businessUser.userBusinesses.find(
        (b: any) => `${b.bizId}` === `${order?.bizId}`
      )?.bizId;
      if (!bizId) throw new Error("User does not have access to the business");
    } else {
      if (order.userId !== uid) throw new Error("Invalid Order");
    }

    // Update order status
    const ref = admin.firestore().collection("Orders").doc(order.id);
    await ref.update({ orderStatus: req.body.orderStatus });
    functions.logger.info("/order Updated order", { structuredData: true });

    if (req.body.orderStatus === "COMPLETE") {
      const message = req.body.message;
      const pushTokens = orderUser?.userDevices?.map((d) => d.pushToken);
      functions.logger.info(pushTokens, { structuredData: true });
      functions.logger.info(message, { structuredData: true });
      await sendPushNotifications(pushTokens, message);
      functions.logger.info("Sent notifications", { structuredData: true });
    }

    res.json(true);
  } catch (err: any) {
    functions.logger.error(err, { structuredData: true });
    res.status(500).send(err.message);
  }
});

/**
 * Fetch an order
 * @param {string} orderId order ID
 * @returns Order or undefined
 */
async function fetchOrder(orderId: string) {
  const firestore = admin.firestore().collection("Orders");

  const orders = await firestore
    .where("orderId", "==", orderId)
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push({ ...doc.data(), id: doc.id });
      });
      return result;
    });
  return orders?.[0] as Order | undefined;
}

app.get("/favourite", authenticationMiddleware, async (req, res) => {
  functions.logger.info("Get User Favourites", { structuredData: true });

  const firestore = admin.firestore().collection("UserFav");

  const favourites = await firestore
    .where("userId", "==", (req as any).user.uid)
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });

      return result;
    });

  res.json({ favourites });
});

app.get("/orders", authenticationMiddleware, async (req, res) => {
  functions.logger.info("Get User Favourites", { structuredData: true });

  const orderRef = admin.firestore().collection("Orders");
  const orders = await orderRef
    .where("userId", "==", (req as any).user.uid)
    .limit(5)
    .orderBy("date", "desc")
    .get()
    .then((snapshot) => {
      const result: any = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });
      return result;
    });
  res.json({ orders });
});

app.get(
  "/order-status/:orderId",
  authenticationMiddleware,
  async (req, res) => {
    functions.logger.info("Get User Order status", { structuredData: true });

    const orderRef = admin.firestore().collection("Orders");
    const orders = await orderRef
      .where("userId", "==", (req as any).user.uid)
      .limit(5)
      .orderBy("date", "desc")
      .get()
      .then((snapshot) => {
        const result: any = [];
        snapshot.forEach((doc) => {
          result.push(doc.data());
        });
        return result;
      });
    res.json({ orders });
  }
);

app.get("/reservations", authenticationMiddleware, async (req, res) => {
  functions.logger.info("Reservation", { structureData: true });

  const firestore = admin.firestore().collection("Reservations");

  let reservations = await firestore
    .where("userId", "==", (req as any).user.uid)
    .where("reservationStatus", "in", [
      "pending",
      "confirmed",
      "expired",
      "fullfilled",
    ])
    .orderBy("date", "desc")
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });
      return result;
    });

  let pendingConfrimed: DocumentData[] = [];
  let otherConfimed: DocumentData = [];

  reservations.forEach((reserv) => {
    if (
      reserv["reservationStatus"] === "pending" ||
      reserv["pending"] == "confirmed"
    ) {
      pendingConfrimed.push(reserv);
    } else {
      otherConfimed.push(reserv);
    }
  });

  let filterd = [...pendingConfrimed];

  for (let i = 0; i < otherConfimed.length; i++) {
    if (filterd.length < 3) {
      filterd.push(otherConfimed[i]);
    } else {
      break;
    }
  }
  res.send({ reservations: filterd });
});

app.get("/", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;
  const user = await getUser(uid);
  res.send(user);
});

/**
 * Get a single user
 * @param {string} uid user ID
 * @return {object} User object
 */
async function getUser(uid: string): Promise<User | undefined> {
  const users = await admin
    .firestore()
    .collection("Users")
    .where("userId", "==", uid)
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        functions.logger.info("doc id " + doc.id, { structuredData: true });
        result.push({ ...doc.data(), id: doc.id });
      });
      return result;
    });
  if (!users[0]) {
    functions.logger.error("No user found for " + uid);
  }
  return users[0] as User;
}

async function getBusiness(bizId: string): Promise<any | undefined> {
  const businees = await admin
    .firestore()
    .collection("Business")
    .doc(bizId)
    .get()
    .then((doc) => {
      if (doc.exists) {
        return {
          ...doc.data(),
          id: doc.id,
        };
      } else {
        functions.logger.error("No Business found for " + bizId);
        return undefined;
      }
    })
    .catch((err) => {
      functions.logger.error(`Error ${err}` + bizId);
      return undefined;
    });

  return businees;
}

app.put("/", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;
  functions.logger.info("Update user " + uid, { structuredData: true });
  functions.logger.info(req.body.user, { structuredData: true });
  const ids = await admin
    .firestore()
    .collection("Users")
    .where("userId", "==", uid)
    .get()
    .then((snapshot) => {
      const result: string[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.id);
      });
      return result;
    });

  if (ids.length !== 1) {
    console.error("Error getting the correct user document for " + uid);
    return;
  }

  const ref = admin.firestore().collection("Users").doc(ids[0]);
  await ref.update(req.body.user);

  functions.logger.info("Updated Doc", { structuredData: true });

  res.send(true);
});

app.post("/payment-sheet", authenticationMiddleware, async (req, res) => {
  try {
    functions.logger.info("Payment sheet", { structuredData: true });

    const uid = (req as any).user.uid;
    const user = await getUser(uid);

    if (!user?.userStripeId) {
      res.send({});
      return;
    }

const ephemeralKey = await getStripe().ephemeralKeys.create(


      { customer: user?.userStripeId },
      { apiVersion: "2020-08-27" }
    );
    let intent: Stripe.PaymentIntentCreateParams = {
      amount: req.body.amount,
      currency: "aud",
      customer: user?.userStripeId,
      payment_method_types: ["card"],
    };
    if (req.body.bizStripeId) {
      intent = {
        ...intent,
        transfer_data: {
          destination: req.body.bizStripeId,
        },
        transfer_group: req.body.orderId,
      };
    }
const paymentIntent = await getStripe().paymentIntents.create(intent);


    res.send({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: user.userStripeId,
      paymentIntentId: paymentIntent.id,
    });
  } catch (err) {
    functions.logger.error(err, { structuredData: true });
    throw new functions.https.HttpsError("unknown", "error occurred");
  }
});

app.post(
  "/reservation/payment-sheet",
  authenticationMiddleware,
  async (req, res) => {
    try {
      functions.logger.info("Payment sheet", { structuredData: true });

      const uid = (req as any).user.uid;
      const user = await getUser(uid);

      if (!user?.userStripeId) {
        res.send({});
        return;
      }

      const ephemeralKey = await getStripe().ephemeralKeys.create(
        { customer: user?.userStripeId },
        { apiVersion: "2020-08-27" }
      );

      // Use the amount from the request body
      const amount = req.body.amount || 500; // Default to $5 if not provided

      let intent: Stripe.PaymentIntentCreateParams = {
        amount: amount, // Amount in cents
        currency: "aud",
        customer: user?.userStripeId,
        payment_method_types: ["card"],
      };

      if (req.body.bizStripeId) {
        intent = {
          ...intent,
          transfer_data: {
            destination: req.body.bizStripeId,
          },
          transfer_group: req.body.orderId,
        };
      }

      const paymentIntent = await getStripe().paymentIntents.create(intent);

      res.send({
        paymentIntent: paymentIntent.client_secret,
        ephemeralKey: ephemeralKey.secret,
        customer: user.userStripeId,
        paymentIntentId: paymentIntent.id,
      });
    } catch (err) {
      functions.logger.error(err, { structuredData: true });
      throw new functions.https.HttpsError("unknown", "error occurred");
    }
  }
);

app.post("/payment-sheet-setup", authenticationMiddleware, async (req, res) => {
  try {
    functions.logger.info("Payment sheet Setup", { structuredData: true });
    const uid = (req as any).user.uid;
    const user = await getUser(uid);
    if (!user?.userStripeId) {
      res.send({});
      return;
    }

    const ephemeralKey = await getStripe().ephemeralKeys.create(
      { customer: user?.userStripeId },
      { apiVersion: "2020-08-27" }
    );
    let intent: Stripe.SetupIntentCreateParams = {
      customer: user?.userStripeId,
      payment_method_types: ["card"],
    };

const paymentIntent = await getStripe().setupIntents.create(intent);

    res.send({
      paymentIntent: paymentIntent.client_secret,
      ephemeralKey: ephemeralKey.secret,
      customer: user.userStripeId,
      payment_intent_id: paymentIntent.id,
    });
  } catch (err) {
    functions.logger.error(err, { structuredData: true });
    throw new functions.https.HttpsError("unknown", "error occurred");
  }
});

app.post("/refund", authenticationMiddleware, async (req, res) => {
  try {
    functions.logger.info(`Refund ${req.body}`, { structuredData: true });
    //required prams
    const orderId = req.body.orderId;
    const businnessId = req.body.bizId;

    const uid = (req as any).user.uid;

    const business = await getBusiness(businnessId);

    const order = await fetchOrder(orderId);

    // check if busisbness is there
    if (!business) {
      res.status(404).send({
        refunded: false,
        error: "no bussiness found",
      });
      return;
    }

    // check if buisineess has rights to refund the order

    if (uid !== business.uid) {
      res.status(401).send({
        refunded: false,
        error: "Authorization for business failed",
      });
      return;
    }

    // check if the order exists
    if (!order) {
      res.status(404).send({
        refunded: false,
        error: "Order not found",
      });
      return;
    }

    // has payment intennt

    if (order?.paymentIntent === undefined || order.paymentIntent === null) {
      res.status(404).send({
        refunded: false,
        error: "Order has no payment information",
      });
      return;
    }

const refund = await getStripe().refunds.create({
      payment_intent: order?.paymentIntent,
    });

    if (refund) {
      // the order was refunded
      await admin.firestore().collection("Orders").doc(order.id).update({
        OrderStatus: "REFUNDED",
        refundId: refund.id,
      });

      res.status(200).send({
        refunded: true,
      });
    }

    // const paymentIntent = await stripe.paymentIntents.create(intent);
  } catch (err) {
    functions.logger.error(err, { structuredData: true });
    res.status(500).send({
      refunded: false,
      error: `Error occured ${err}`,
    });
  }
});

app.post("/user-notify", async (req, res) => {
  const orderUser = (await getUser(req.body["userid"])) as User;
  // const uid = (req as any).user.uid;

  const message = req.body.message;
  const pushTokens = orderUser?.userDevices?.map((d) => d.pushToken);

  await sendPushNotifications(pushTokens, message);

  res.send("ok");
});

const detachAllPaymentMethods = async (
  customerId: string
): Promise<Boolean> => {
  // remove this if finalized not detached
const paymentMethods = await getStripe().paymentMethods.list({
    customer: customerId,
    type: "card",
  });

  functions.logger.error("Payment Method", paymentMethods);
  functions.logger.error("Payment Method", customerId);
  //not detaching the payment method .. suggest by JDoglus
  // const payment_method = paymentMethods.data
  // for(let payment of payment_method){
  //   await stripe.paymentMethods.detach(
  //     payment.id
  //   );
  // }
  return true;
};

const confirmUserPayment = async (
  bizStripeId: string,
  orderId: string,
  intentId: string,
  customer: string,
  amount: number
): Promise<string> => {
  try {
const setupintent = await getStripe().setupIntents.retrieve(intentId);
    const payment_id = setupintent.payment_method;
    if (!payment_id) {
      return Promise.reject(`Payment Error status no payment metod found`);
    }
const paymentIntent = await getStripe().paymentIntents.create({
      amount: amount,
      currency: "aud",
      customer: customer,
      automatic_payment_methods: { enabled: true },
      payment_method: payment_id as string,
      off_session: true,
      confirm: true,
      transfer_data: {
        destination: bizStripeId,
      },
      transfer_group: orderId,
    });
    if (paymentIntent.status == "succeeded") {
      return paymentIntent.id;
    } else {
      return Promise.reject(`Payment Error status ${paymentIntent.status}`);
    }
  } catch (err) {
    functions.logger.error("User Confirm  Payment error ", err);
    return Promise.reject(
      `Payment Error  ${(err as any)["code"] ?? ""} ${err}`
    );
  }
};

export function sumDishes(order: Partial<Order>): number {
  let result = 0;
  order.dishes?.forEach((i) => {
    let price = 0;
    if (i.dishTotalPrice) {
      price = i.dishTotalPrice; // remove/ 100 as it is not in dollars
    } else {
      price = parseFloat(i.dishAvailSize[0].price);
    }
    price *= i.dishCount;
    result += price;
  });
  return Math.round(result * 100);
}

app.get("/complete-geofencing", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;
  const user = (await getUser(uid)) as User;
  const ref = admin.firestore().collection("Users").doc(user.id);
  const { FieldValue } = require("firebase-admin/firestore");
  if (user) {
    // order
    let userCurrent = user.userCurrentOrder;

    if (userCurrent) {
      const orderedVenue = userCurrent.order.bizName;
      const orderedDishes = userCurrent.order.dishes
        ?.map((dish, index, array) => {
          const dishName = dish.dishName;
          if (index === array.length - 1) {
            return dishName;
          }
          return `${dishName}& `;
        })
        .join("");

      if (userCurrent.postStatus === "complete") {
        res.send("Order already completed");
        return;
      }
      const orderType = userCurrent.orderType;
      const orderRef = admin.firestore().collection("Orders");
      if (orderType === "onapproach") {
        let payment = userCurrent.order.setupPaymentIntent;

        if (typeof payment === "string" || userCurrent.order.bizId === "6") {
          if (userCurrent.order.bizStripeId) {
            let orderDoc = orderRef.doc();

            const success: {
              success: boolean;
              paymentId?: string;
              error?: string;
            } = await confirmUserPayment(
              userCurrent.order.bizStripeId,
              orderDoc.id,
              typeof payment === "string" ? payment : "",
              user.userStripeId,
              sumDishes(userCurrent.order)
            )
              .then((id) => {
                if (!id) {
                  return {
                    success: false,
                    error: "Cannot get payment intent id",
                  };
                }
                return {
                  success: true,
                  paymentId: id,
                };
              })
              .catch((e) => {
                return {
                  success: false,
                  error: `${e}`,
                };
              });

            if (success.success) {
              // post order
              const order: DocumentData = {
                ...userCurrent.order,
                date: new Date().toISOString(),
                timestamp: Timestamp.fromDate(new Date()),
                orderStatus: "PENDING_ON_APPROACH",
                orderPaymentType: "ON_APPROACH",
                orderId: orderDoc.id,
                paymentIntent: success.paymentId ?? null,
                userId: user.userId,
              };

              await orderDoc.set(order);
              // Update user's current order status
              await ref.update({
                //removing order
                userCurrentOrder: {
                  ...userCurrent,
                  geofencing: "complete",
                  postStatus: "complete",
                },
              });

              // add ordered details into UserFav collection
              const userFavCollection = admin.firestore().collection("UserFav");

              const tasks = (order.dishes || []).map(async (dish: any) => {
                let favId = uuidv4();

                const UserFav: DocumentData = {
                  id: favId,
                  bizId: order.bizId.toString(),
                  favDet: dish.dishID,
                  favOrder: dish.dishID,
                  userId: (req as any).user.uid,
                  orderId: order.orderId,
                  orderType: orderType,
                  orderPaymentType: order.orderPaymentType,
                  orderPaymentDistance: order.orderPaymentDistance || "",
                };

                try {
                  await userFavCollection.doc().set(UserFav);
                } catch (error) {
                  console.error("Error adding user favorite:", error);
                }
              });

              // Add reward points
              const userRef = await admin
                .firestore()
                .collection("Users")
                .where("userId", "==", (req as any).user.uid)
                .get()
                .then((snapshot) => {
                  const docs: any = [];
                  snapshot.forEach((doc) => {
                    docs.push(doc.ref);
                  });
                  return docs[0];
                });
              await userRef.update({
                "piattoRewards.HighUser": FieldValue.increment(2),
              });
              await Promise.all(tasks);

              // notifications
              const pushTokens = (user?.userDevices ?? []).map(
                (d) => d.pushToken
              );
              await sendPushNotifications(
                pushTokens,
                `Your order of ${orderedDishes} at ${orderedVenue} has been submitted to the venue! When you arrive, please chill till you receive another notification saying your order has been completed, at which point, hopefully they'll keep an eye out for you!`
              );

              res.send({ success: true });
            } else {
              // error

              res.status(402).send(`Error ${success.error}`);
            }
          } else {
            res.status(402).send(`Error biz is not valid`);
          }
        } else {
          res.status(403).send(`Setup Payment Id not found`);
        }
      } else {
        // complet
        res.send({ success: true });
      }
    } else {
      res.status(402).send("User has no current order");
    }

    return;
  }
  res.status(402).send("User unauthorized");
});

app.get("/cancel-current-order", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;
  const user = (await getUser(uid)) as User;

  if (!user) {
    res.status(402).send("User unauthorized");
    return;
  }
  let userCurrent = user.userCurrentOrder;
  if (userCurrent) {
    if (user.userStripeId) {
      let detachPromise = detachAllPaymentMethods(user.userStripeId);

      let success: { success: boolean; error?: string } = await detachPromise
        .then(() => {
          return {
            success: true,
          };
        })
        .catch((e) => {
          return {
            success: false,
            error: `${e}`,
          };
        });
      if (!success.success) {
        res.status(402).send(`Error  while detaching p-info ${success.error}`);
        return;
      }
    }
    const ref = admin.firestore().collection("Users").doc(user.id);
    await ref.update({
      //removing order
      userCurrentOrder: {},
    });

    res.send({ success: true });

    return;
  }
});

// API endpoint to cancel a reservation
app.post("/cancel-reservation", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;
  const { reservationID } = req.body;

  if (!reservationID) {
    return res.status(400).json("Reservation ID is required");
  }

  try {
    const reservationsRef = admin.firestore().collection("Reservations");
    const query = reservationsRef
      .where("reservationId", "==", reservationID)
      .where("userId", "==", uid);
    const querySnapshot = await query.get();

    if (querySnapshot.empty) {
      return res
        .status(404)
        .send("Reservation not found or does not belong to user");
    }

    const reservationDoc = querySnapshot.docs[0];
    await reservationDoc.ref.delete();

    return res.status(200).json({
      success: true,
      message: "Reservation canceled successfully",
      deletedReservationId: reservationID,
    });
  } catch (error) {
    console.error("Error canceling reservation:", error);
    return res.status(500).send("Internal server error");
  }
});
app.post("/seated-pay-post", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;
  const user = (await getUser(uid)) as User;
  const { FieldValue } = require("firebase-admin/firestore");

  if (user) {
    let userCurrent = user.userCurrentOrder;

    if (userCurrent?.order) {
      // check order status

      const orderedVenue = userCurrent.order.bizName;
      const orderedDishes = userCurrent.order.dishes
        ?.map((dish, index, array) => {
          const dishName = dish.dishName;
          if (index === array.length - 1) {
            return dishName;
          }
          return `${dishName}& `;
        })
        .join("");
      if (userCurrent.postStatus === "complete") {
        res.status(402).send("Order already completed");
        return;
      }

      if (`${userCurrent.order.bizId}` !== `${req.body.bizId}`) {
        res
          .status(402)
          .send(`"User Current Order is not from this venue ${req.body.bizId}`);
        return;
      }

      const orderType = userCurrent.orderType;
      const ref = admin.firestore().collection("Users").doc(user.id);
      const orderRef = admin.firestore().collection("Orders");
      // if (orderType === "onseated")
      {
        let payment = userCurrent.order.setupPaymentIntent;

        if (
          typeof payment === "string" ||
          userCurrent.order.bizId === req.body.bizId
        ) {
          if (userCurrent.order.bizStripeId) {
            let orderDoc = orderRef.doc();
            let success: {
              success: boolean;
              paymentId?: string;
              error?: string;
            } = {
              success: false,
              error: "initialization error -seated post",
            };
            if (
              userCurrent.order.bizId !== req.body.bizId &&
              typeof payment === "string"
            ) {
              success = await confirmUserPayment(
                userCurrent.order.bizStripeId,
                orderDoc.id,
                payment,
                user.userStripeId,
                sumDishes(userCurrent.order)
              )
                .then((id) => {
                  if (!id) {
                    return {
                      success: false,
                      error: "Cannot get payment intent id",
                    };
                  }
                  return {
                    success: true,

                    paymentId: id,
                  };
                })
                .catch((e) => {
                  return {
                    success: false,
                    error: `${e}`,
                  };
                });
            } else {
              success = {
                success: true,
              };
            }

            if (success.success) {
              // post order
              const order: DocumentData = {
                ...userCurrent.order,
                date: new Date().toISOString(),
                timestamp: Timestamp.fromDate(new Date()),
                orderStatus: null,
                orderPaymentType: "IMMEDIATE",
                orderId: orderDoc.id,
                orderTableNo: req.body.tableNo ?? null,
                userId: (req as any).user.uid,
                paymentIntent: success.paymentId ?? null,
              };

              await orderDoc.set(order);

              //add ordered details into UserFav collection
              const userFavCollection = admin.firestore().collection("UserFav");

              const tasks = (order.dishes || []).map(async (dish: any) => {
                let favId = uuidv4();

                const UserFav: DocumentData = {
                  id: favId,
                  bizId: order.bizId.toString(),
                  favDet: dish.dishID,
                  favOrder: dish.dishID,
                  userId: (req as any).user.uid,
                  orderId: order.orderId,
                  orderType: orderType,
                  orderPaymentType: order.orderPaymentType,
                  orderPaymentDistance: order.orderPaymentDistance || "",
                };

                try {
                  await userFavCollection.doc().set(UserFav);
                } catch (error) {
                  console.error("Error adding user favorite:", error);
                }
              });

              // Add reward points
              const userRef = await admin
                .firestore()
                .collection("Users")
                .where("userId", "==", (req as any).user.uid)
                .get()
                .then((snapshot) => {
                  const docs: any[] = [];
                  snapshot.forEach((doc) => {
                    docs.push(doc.ref);
                  });
                  return docs[0];
                });

              await userRef.update({
                "piattoRewards.HighUser": FieldValue.increment(2),
              });

              await Promise.all(tasks);

              await ref.update({
                //removing order
                userCurrentOrder: {
                  ...userCurrent,
                  geofencing: "complete",
                  postStatus: "complete",
                },
              });

              // notifications
              const pushTokens = (user?.userDevices ?? []).map(
                (d) => d.pushToken
              );
              await sendPushNotifications(
                pushTokens,
                `Your order of ${orderedDishes} at ${orderedVenue} has been submitted to the venue! You'll receive another notification when your order is being prepared.`
              );

              res.send({ success: true });
            } else {
              // error
              res.status(402).send(`Error ${success.error}`);
            }
          } else {
            res.status(402).send(`Error biz is not valid`);
          }
        } else {
          res.status(402).send("No Setup Intent Found ");
        }

        return;
      }
      res.status(402).send("Order type is Not Seated order");
    } else {
      res.status(402).send("User has no current order");
    }

    return;
  }
  res.status(402).send("User unauthorized");
});

//to webbackend
app.post("/landing", (req, res) => {
  const oauth2Client = new google.auth.OAuth2(
    clientId,
    clientSecret,
    redirectUrl
  );
  let url = oauth2Client.generateAuthUrl({
    access_type: "offline",
    scope: SCOPES,
  });
  res.send(JSON.stringify(url));
});

app.post("/code", async (req, res) => {
  const code = req.body.code;
  let userData;
  const formData = {
    client_id: clientId,
    client_secret: clientSecret,
    code: code,
    grant_type: "authorization_code",
    redirect_uri: redirectUrl,
  };
  const postData = qs.stringify(formData);

  try {
    const response = await axios.post(getTokenUrl, postData, {
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
      },
    });

    const token = response.data.access_token;

    const token_type = response.data.token_type;
    const result = await axios.get(getUserDataUrl, {
      headers: {
        Authorization: `${token_type} ${token}`,
      },
    });
    userData = result.data;
    res.send(JSON.stringify(userData));
  } catch (error) {
    res.send(JSON.stringify({ message: "Internet Error" }));
  }
});

app.delete("/:userId", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;

  if (!uid) {
    return res.status(400).json("Please login first");
  }

  try {
    const firestore = admin.firestore();

    const userRef = firestore.collection("Users");
    const userDeletedRef = firestore.collection("usersDeleted");
    const query = userRef.where("userId", "==", uid);
    const querySnapshot = await query.get();

    if (querySnapshot.empty) {
      return res.status(404).send("User not found");
    }

    // Assuming there's only one matching user, delete the first one found
    const userDoc = querySnapshot.docs[0];
    const data = userDoc.data() as any;

    const user: DocumentData = {
      userEmail: data.userEmail,
      userDOB: new Date(data.userDOB).toISOString(),
      userPhone: data.userPhone,
      userFirstName: data.userFirstName,
      userLastName: data.userLastName,
      userId: data.userId,
      timestamp: new Date(),
    };

    await userDeletedRef.doc().set(user);

    await userDoc.ref.delete();

    return res.status(200).json({
      success: true,
      message: "User deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting user:", error);
    return res.status(500).send("Internal server error");
  }
});

app.post("/recommend", authenticationMiddleware, async (req, res) => {
  const uid = (req as any).user.uid;
  const { newUserEmail } = req.body;

  const recommendationsCollection = admin
    .firestore()
    .collection("Recommendations");

  const recommendation = {
    userId: uid,
    newUserEmail,
    timestamp: new Date(),
    status: "pending",
  };

  await recommendationsCollection.doc().set(recommendation);

  res.send("ok");
});

export const user = functions
  .region("australia-southeast1")
  .runWith({ secrets: [STRIPE_SECRET_KEY, GOOGLE_CLIENT_SECRET] })
  .https.onRequest(app);

export const watermarkImages = functions
  .region("australia-southeast1")
  .storage.object()
  .onFinalize(async (object) => {
    // ...

    const fileBucket = object.bucket; // The Storage bucket that contains the file.
    const filePath = object.name; // File path in the bucket.
    const contentType = object.contentType; // File content type.

    // Exit if this is triggered on a file that is not an image.
    // Exit if this is triggered on a file that is not an image.
    if (contentType && !contentType.startsWith("image/")) {
      return functions.logger.log("This is not an image.");
    }

    // check if the folder structure matches

    // Get the folder path without the image name.
    const folderPath = path.dirname(filePath);
    // Check if there are subfolders and extract the parent folder path.
    const subfolders = folderPath.split("/");

    if (
      subfolders.length !== 3 &&
      subfolders[0] !== "Users" &&
      subfolders[2] !== "id"
    ) {
      return;
    }

    // Get the file name.
    const fileName = path.basename(filePath);

    if (!filePath) {
      return;
    }
    // Exit if the image is already a thumbnail.
    if (fileName.startsWith("wmuserid_")) {
      return functions.logger.log("Already a Watermark.");
    }

    // Download file into memory from bucket.
    const bucket = admin.storage().bucket(fileBucket);
    const downloadResponse = await bucket.file(filePath).download();
    const imageBuffer = downloadResponse[0];
    functions.logger.log("Image downloaded!");

    // Generate a resized image using sharp.
    const processedImageBuffer = await sharp(imageBuffer)
      .resize({ width: 500 })
      .toBuffer();

    // Create an SVG watermark to composite onto the image.
    const svg = `<svg width="400" height="120" xmlns="http://www.w3.org/2000/svg">
      <rect x="0" y="0" width="400" height="120" fill="none" />
      <text x="100%" y="90%" text-anchor="end" font-family="Merriweather, Arial" font-size="36" fill="rgba(255,255,255,0.55)">Piatto</text>
    </svg>`;
    const svgBuffer = Buffer.from(svg);

    const watermarkedImageBuffer = await sharp(processedImageBuffer)
      .composite([
        {
          input: svgBuffer,
          gravity: "southeast",
        },
      ])
      .toBuffer();

    // Upload the watermarked image back to Cloud Storage.
    const watermarkFileName = `wmuserid_${path.basename(filePath)}`;
    const watermarkFilePath = path.join(
      path.dirname(filePath),
      watermarkFileName
    );

    const metadata = { contentType: contentType };
    await bucket.file(watermarkFilePath).save(watermarkedImageBuffer, {
      metadata,
    });

    return functions.logger.log("Watermark uploaded!");
  });

