import { DocumentData } from "@google-cloud/firestore";
import * as functions from "firebase-functions";
import * as admin from "firebase-admin";
import * as express from "express";
import * as cors from "cors";
import { v4 as uuidv4 } from "uuid";
import "firebase-functions/logger/compat";

import authenticationMiddleware from "./authenticationMiddleware";
// import { Cuisine } from "./types";
import { DocumentReference, Timestamp } from "firebase-admin/firestore";

const app = express();

const USE_LIMIT_BUSSINESS_FILTER = false;
const USE_LIMIT_BUSINESS_KM = 50;

const { FieldValue } = require("firebase-admin/firestore");
export const businessVerifiedReward = functions
  .region("australia-southeast1")
  .firestore.document("Business/{bizId}")
.onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after) return;

    const wasVerified = Boolean(before.bizVerified);
    const isVerified = Boolean(after.bizVerified);

    if (!wasVerified && isVerified) {
      const uid = after?.uid;
      if (uid) {
        const userRef = await admin
          .firestore()
          .collection("Users")
          .where("userId", "==", uid)
          .limit(1)
          .get()
          .then((snap) => snap.docs[0]?.ref);
        await userRef?.update({
          "piattoRewards.PiattoPromotor": FieldValue.increment(10),
        });
      }
    }
  });

// Reward: when a standard Review is marked complete, award reviewer points.
export const reviewCompletedReward = functions
  .region("australia-southeast1")
  .firestore.document("Reviews/{reviewId}")
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after) return;

    const wasComplete = Boolean(before.reviewComplete);
    const isComplete = Boolean(after.reviewComplete);

    if (!wasComplete && isComplete) {
      const uid = after?.revUid;
      if (uid) {
        const userRef = await admin
          .firestore()
          .collection("Users")
          .where("userId", "==", uid)
          .limit(1)
          .get()
          .then((snap) => snap.docs[0]?.ref);
        await userRef?.update({
          "piattoRewards.PiattoReviewer": FieldValue.increment(5),
        });
      }
    }
  });

// Reward: when an accessibility review is marked complete, award crusader points.
export const accessReviewCompletedReward = functions
  .region("australia-southeast1")
  .firestore.document("accessReview/{reviewId}")
  .onUpdate(async (change) => {
    const before = change.before.data();
    const after = change.after.data();
    if (!before || !after) return;

    const wasComplete = Boolean(before.reviewComplete);
    const isComplete = Boolean(after.reviewComplete);

    if (!wasComplete && isComplete) {
      const uid = after?.revUid;
      if (uid) {
        const userRef = await admin
          .firestore()
          .collection("Users")
          .where("userId", "==", uid)
          .limit(1)
          .get()
          .then((snap) => snap.docs[0]?.ref);
        await userRef?.update({
          "piattoRewards.AccessCrusader": FieldValue.increment(5),
        });
      }
    }
  });

app.use(cors({ origin: true }));

app.get("/cuisines", async (req, res) => {
  functions.logger.info("Get Cuisines", { structuredData: true });

  const cuisineCollection = admin.firestore().collection("Cuisine");

  const cuisines = await cuisineCollection.get().then((snapshot) => {
    const result: DocumentData[] = [];
    snapshot.forEach((doc) => {
      result.push(doc.data());
    });
    return result;
  });

  res.json({ cuisines });
});

const getCuisinesBiz = async (cuisName: string) => {
  const businessCollection = admin.firestore().collection("Business");
  const businesses = await businessCollection
    .where("bizVerified", "==", true)
    .where("bizCuisines", "array-contains-any", [
      cuisName,
      cuisName.toUpperCase(),
      cuisName.toLocaleLowerCase(),
    ])
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });
      return result;
    });

  return businesses;
};

app.get("/cuisine/:cuisName", async (req, res) => {
  functions.logger.info("Get Business by Cuisine ", { structuredData: true });
  functions.logger.info(req.params, { structuredData: true });
  const businesses = await getCuisinesBiz(req.params.cuisName);
  const sortedBusinesses = sortBusinessByDistance(
    businesses,
    req.query.lat as string,
    req.query.lng as string
  );

  res.send(sortedBusinesses);
});

/**
 * Get all cuisines
 */
// async function getCuisines() {
//   const firestore = admin.firestore().collection("Cuisine");
//   const cuisines = await firestore.get().then((snapshot) => {
//     const result: DocumentData[] = [];
//     snapshot.forEach((doc) => {
//       result.push(doc.data());
//     });
//     return result;
//   });
//   return cuisines as Cuisine[];
// }

type Coordinates = {
  lat: number;
  lng: number;
};

const getDistanceFromLatLonInKm = (
  start: Coordinates,
  destination: Coordinates
) => {
  const R = 6371; // Radius of the earth in km
  const dLat = deg2rad(destination.lat - start.lat); // deg2rad below
  const dLon = deg2rad(destination.lng - start.lng);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(deg2rad(start.lat)) *
      Math.cos(deg2rad(destination.lat)) *
      Math.sin(dLon / 2) *
      Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const d = R * c; // Distance in km
  return d;
};

const deg2rad = (deg: number) => {
  return deg * (Math.PI / 180);
};
const parseCoordinatesBiz = (latS: string, lonS: string): Coordinates => {
  let la = Number(0);
  let ln = Number(0);

  if (
    latS != undefined &&
    lonS != undefined &&
    !isNaN(Number(latS)) &&
    !isNaN(Number(lonS))
  ) {
    la = Number(latS);
    ln = Number(lonS);
  }

  return { lat: la, lng: ln };
};

const parseCoordinates = (lata: any, lona: any): Coordinates => {
  let lat = Number(0);
  let lng = Number(0);

  if (typeof lata === "number" && typeof lona === "number") {
    if (!isNaN(lata) && !isNaN(lona)) {
      lat = lata;
      lng = lona;
      return { lat, lng };
    }
  }

  if (lata != undefined && lona != undefined && !isNaN(lata) && !isNaN(lona)) {
    lat = Number(lata);
    lng = Number(lona);
  }

  return {
    lat,
    lng,
  };
};

const filterBusineesOut = (
  distanceKM: number,
  business: DocumentData[],
  userCoords: Coordinates
) => {
  return business.filter((b) => {
    let d = getDistanceFromLatLonInKm(
      userCoords,
      parseCoordinatesBiz(b.bizLat, b.bizLon)
    );
    return d <= distanceKM;
  });
};

const sortBusinessByAccessRating = (
  businesses: DocumentData[],
  lat: string,
  lng: string
) => {
  let bizs = businesses;

  const userCoords: Coordinates = {
    lat: Number(lat),
    lng: Number(lng),
  };

  // filter then
  if (USE_LIMIT_BUSSINESS_FILTER) {
    bizs = filterBusineesOut(USE_LIMIT_BUSINESS_KM, businesses, userCoords);
  }

  const sortedBusinesses = bizs.sort((a, b) => {
    const ratingA = Number(a?.bizAccessRating ?? 0);
    const ratingB = Number(b?.bizAccessRating ?? 0);
    return ratingB - ratingA;
  });

  return sortedBusinesses;
};

const sortBusinessByFoodQuality = (
  businesses: DocumentData[],
  lat: string,
  lng: string
) => {
  let bizs = businesses;

  const userCoords: Coordinates = {
    lat: Number(lat),
    lng: Number(lng),
  };

  // filter then
  if (USE_LIMIT_BUSSINESS_FILTER) {
    bizs = filterBusineesOut(USE_LIMIT_BUSINESS_KM, businesses, userCoords);
  }
  const sortedBusinesses = bizs.sort((a, b) => {
    const ratingA = Number(a?.foodQuality ?? 0);
    const ratingB = Number(b?.foodQuality ?? 0);
    return ratingB - ratingA;
  });
  return sortedBusinesses;
};

const sortBusinessByDistance = (
  businesses: DocumentData[],
  lat: string,
  lng: string
) => {
  const userCoords: Coordinates = {
    lat: Number(lat),
    lng: Number(lng),
  };

  let sortedBusinesses = businesses.sort((a, b) => {
    const start1 = parseCoordinatesBiz(a.bizLat, a.bizLon);
    const start2 = parseCoordinatesBiz(b.bizLat, b.bizLon);
    let distance_2 = getDistanceFromLatLonInKm(userCoords, start2);
    let distance_1 = getDistanceFromLatLonInKm(userCoords, start1);

    if (isNaN(distance_1)) {
      distance_1 = Number.MAX_VALUE;
    }
    if (isNaN(distance_2)) {
      distance_2 = Number.MAX_VALUE;
    }

    return distance_1 - distance_2;
  });
  if (USE_LIMIT_BUSSINESS_FILTER) {
    // if filter
    sortedBusinesses = filterBusineesOut(
      USE_LIMIT_BUSINESS_KM,
      sortedBusinesses,
      userCoords
    );
  }
  return sortedBusinesses;
};

const sortBusinessByStarRating = (
  businesses: DocumentData[],
  lat: string,
  lng: string
) => {
  let bizs = businesses;

  const sortedBusinesses = bizs.sort((a, b) => {
    const ratingA = Number(a?.bizRating ?? 0);
    const ratingB = Number(b?.bizRating ?? 0);
    return ratingB - ratingA;
  });

  const userCoords: Coordinates = {
    lat: Number(lat),
    lng: Number(lng),
  };

  // filter then
  if (USE_LIMIT_BUSSINESS_FILTER) {
    bizs = filterBusineesOut(USE_LIMIT_BUSINESS_KM, businesses, userCoords);
  }

  return sortedBusinesses;
};

const sortPreccintByDistance = (
  preccints: DocumentData[],
  lat: string,
  lon: string
) => {
  const userCoords: Coordinates = {
    lat: Number(lat),
    lng: Number(lon),
  };

  let sortedPreccints = preccints.sort((a, b) => {
    let preccints = a["precincts"];
    let bps = b["precincts"];
    let start1 = parseCoordinates(0, 0);
    let start2 = parseCoordinates(0, 0);
    if ((preccints ?? []).length > 0 && (bps ?? []).length > 0) {
      let p = preccints[0];
      let bp = bps[0];

      start1 = parseCoordinates(p["lat"], p["lon"]);
      start2 = parseCoordinates(bp["lat"], bp["lon"]);
    }

    let distance_2 = getDistanceFromLatLonInKm(userCoords, start2);
    let distance_1 = getDistanceFromLatLonInKm(userCoords, start1);

    if (isNaN(distance_1)) {
      distance_1 = Number.MAX_VALUE;
    }
    if (isNaN(distance_2)) {
      distance_2 = Number.MAX_VALUE;
    }

    return distance_1 - distance_2;
  });

  //Filter out duplicate city names
  const uniqueCities: string[] = [];
  const uniqueSortedPrecincts = sortedPreccints.filter((precinct) => {
    if (!uniqueCities.includes(precinct.city)) {
      uniqueCities.push(precinct.city);
      return true;
    }
    return false;
  });

  return uniqueSortedPrecincts;
};

app.get("/nearby", async (req, res) => {
  functions.logger.info("getBusinessByProximity logs!", {
    structuredData: true,
  });

  const businesses = await admin
    .firestore()
    .collection("Business")
    .where("bizVerified", "==", true)
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });
      return result;
    });

  const sortedBusinesses = sortBusinessByDistance(
    businesses,
    req.query.lat as string,
    req.query.lng as string
  );
  res.send(sortedBusinesses);
});

// access Rating
app.get("/accessRating", async (req, res) => {
  let businessWhere = await admin
    .firestore()
    .collection("Business")
    .where("bizAccessRating", "!=", null);

  // if (req.query.bizType) {
  //   businessWhere = businessWhere.where(
  //     "bizType",
  //     "array-contains",
  //     req.query.bizType
  //   );
  // }

  // if (req.query.cuisName) {
  //   businessWhere = businessWhere.where(
  //     "bizCuisines",
  //     "array-contains",
  //     req.query.cuisName
  //   );
  // }

  let business = await businessWhere.get().then((snapshot) => {
    const result: DocumentData[] = [];
    snapshot.forEach((doc) => {
      result.push(doc.data());
    });
    return result;
  });

  // if (req.query.search) {
  //   let s = req.query.search as string;
  //   let cuisines = await getCuisines();
  //   cuisines = cuisines.filter((c) =>
  //     c.cuisName.toLowerCase().indexOf(s.toLowerCase())
  //   );

  //   business = await searchBiz(business, s, cuisines);
  // }

  const sortedBusinesses = sortBusinessByAccessRating(
    business,
    req.query.lat as string,
    req.query.lng as string
  );

  res.send(sortedBusinesses);
});

app.get("/starRating", async (req, res) => {
  let businessWhere = await admin
    .firestore()
    .collection("Business")
    .where("bizRating", "!=", null);

  let business = await businessWhere.get().then((snapshot) => {
    const result: DocumentData[] = [];
    snapshot.forEach((doc) => {
      result.push(doc.data());
    });

    return result;
  });

  const sortedBusinesses = sortBusinessByStarRating(
    business,
    req.query.lat as string,
    req.query.lng as string
  );

  res.send(sortedBusinesses);
});

//food quality
app.get("/foodQuality", async (req, res) => {
  let businessWhere = await admin
    .firestore()
    .collection("Business")
    .where("bizVerified", "==", true);

  // if (req.query.bizType) {
  //   businessWhere = businessWhere.where(
  //     "bizType",
  //     "array-contains",
  //     req.query.bizType
  //   );
  // }

  // if (req.query.cuisName) {
  //   businessWhere = businessWhere.where(
  //     "bizCuisines",
  //     "array-contains",
  //     req.query.cuisName
  //   );
  // }

  let business = await businessWhere.get().then((snapshot) => {
    const result: DocumentData[] = [];
    snapshot.forEach((doc) => {
      result.push(doc.data());
    });
    return result;
  });

  // if (req.query.search) {
  //   let s = req.query.search as string;
  //   let cuisines = await getCuisines();
  //   cuisines = cuisines.filter((c) =>
  //     c.cuisName.toLowerCase().indexOf(s.toLowerCase())
  //   );

  //   business = await searchBiz(business, s, cuisines);
  // }

  const sortedBusinesses = sortBusinessByFoodQuality(
    business,
    req.query.lat as string,
    req.query.lng as string
  );

  res.send(sortedBusinesses);
});


app.get("/type/:type", async (req, res) => {
  functions.logger.info("Get Business by Type", { structuredData: true });
  const { type } = req.params;

  const businesses = await admin
    .firestore()
    .collection("Business")
    .where("bizVerified", "==", true)
    .where("bizType.typeName", "in", [
      type,
      type.toUpperCase(),
      type.toLowerCase(),
      type.charAt(0).toLocaleUpperCase() + type.slice(1).toLocaleLowerCase(),
    ])
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });
      return result;
    });

  const sortedBusinesses = sortBusinessByDistance(
    businesses,
    req.query.lat as string,
    req.query.lng as string
  );

  res.send(sortedBusinesses);
});

app.get("/precincts", async (req, res) => {
  functions.logger.info("Get Preccints by Type", { structuredData: true });

  const preccints = await admin
    .firestore()
    .collection("Precincts")
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });
      return result;
    });

  const sortedPreccints = sortPreccintByDistance(
    preccints,
    req.query.lat as string,
    req.query.lng as string
  );

  res.send(sortedPreccints);
});

app.get("/precinct/:precint", async (req, res) => {
  const precint = req.params.precint;

  let businessWhere = await admin
    .firestore()
    .collection("Business")
    .where("bizVerified", "==", true);

  let businesses = await businessWhere.get().then((snapshot) => {
    const result: DocumentData[] = [];

    snapshot.forEach((doc) => {
      const data = doc.data();

      // Check if bizSuburb exists and is a string
      if (data.bizSuburb && typeof data.bizSuburb === "string") {
        // Normalize both strings by trimming and converting to lowercase
        const normalizedBizSuburb = data.bizSuburb.trim().toLowerCase();
        const normalizedPrecinct = precint.trim().toLowerCase();

        // Check if normalized bizSuburb includes normalized precinct
        if (normalizedBizSuburb.includes(normalizedPrecinct)) {
          result.push(data);
        }
      }
    });

    return result;
  });

  const sortedBusinesses = sortBusinessByDistance(
    businesses,
    req.query.lat as string,
    req.query.lng as string
  );

  res.send(sortedBusinesses);
});

const searchBiz = async (businesses: DocumentData[], searchText: string) => {
  const validBizTypes = ["Cafe", "Bar", "Restaurant", "Food Truck", "Event"];
  const cuisineList = [
    "French",
    "Pizza",
    "Italian",
    "Coffee",
    "Cosmopolitan",
    "Greek",
    "Vietnamese",
    "Japanese",
    "Healthy",
    "Himalayan",
    "Portuguese",
    "Nepalese",
    "Asian",
    "Lebanese",
    "Chinese",
  ];
  let result = [];
  const lowerSearchText = searchText.toLowerCase();

  if (
    validBizTypes.map((type) => type.toLowerCase()).includes(lowerSearchText)
  ) {
    result = businesses.filter(
      (business) =>
        typeof business.bizType.typeName === "string" &&
        business.bizType.typeName.toLowerCase().includes(lowerSearchText)
    );
    return result;
  } else if (
    cuisineList
      .map((cuisine) => cuisine.toLowerCase())
      .includes(lowerSearchText)
  ) {
    // Use getCuisineBiz to search for businesses by cuisine

    result = businesses.filter(
      (business) =>
        Array.isArray(business.bizCuisines) &&
        business.bizCuisines.some((cuisine) =>
          cuisine.toLowerCase().includes(lowerSearchText)
        )
    );
    return result;
  } else {
    const menuPromises = businesses.map((business) =>
      admin
        .firestore()
        .collection("MenuDetails")
        .where("menuBizId", "==", business.bizId)
        .get()
        .then((snapshot) => {
          const menuIds: string[] = [];
          snapshot.forEach((doc) => {
            const menuData = doc.data();
            if (menuData.menuId) {
              menuIds.push(menuData.menuId);
            }
          });
          return { business, menuIds };
        })
    );

    const menuResults = await Promise.all(menuPromises);

    // New query to find businesses by menuName
    const menuNamePromises = admin
      .firestore()
      .collection("MenuDetails")
      .get()
      .then((snapshot) => {
        const businessesByMenuName: any = [];
        snapshot.forEach((doc) => {
          const menuData = doc.data();
          // Perform case-insensitive comparison
          if (
            menuData.menuName &&
            menuData.menuName.toLowerCase().includes(lowerSearchText)
          ) {
            const business = businesses.find(
              (b) => b.bizId === menuData.menuBizId
            );
            if (business) {
              businessesByMenuName.push(business);
            }
          }
        });
        return businessesByMenuName;
      });

    const businessesByMenuName = await menuNamePromises;

    // Combine results
    const allDishesPromises = menuResults.flatMap((menuResult) =>
      menuResult.menuIds.map((menuId) =>
        getDishesFromMenu(menuId).then((dishes) => {
          const dishNames: string[] = [];
          dishes.forEach((dish) => {
            dishNames.push(dish.dishName);
          });
          return {
            menuId,
            dishNames,
            business: menuResult.business,
          };
        })
      )
    );

    const allDishesResults = await Promise.all(allDishesPromises);

    const result: any[] = [];
    const uniqueBizNames = new Set<string>();

    allDishesResults.forEach((item) => {
      let containDish = false;
      if (
        item.dishNames.some(
          (dish: any) =>
            typeof dish === "string" &&
            dish.toLowerCase().includes(lowerSearchText)
        )
      ) {
        containDish = true;
      }

      if (
        (typeof item.business.bizName === "string" &&
          item.business.bizName.toLowerCase().includes(lowerSearchText)) ||
        containDish
      ) {
        if (!uniqueBizNames.has(item.business.bizName)) {
          item.business.containDish = containDish;
          result.push(item.business);
          uniqueBizNames.add(item.business.bizName);
        }
      }
    });

    // Add businesses found by menuName
    businessesByMenuName.forEach((business: any) => {
      if (!uniqueBizNames.has(business.bizName)) {
        result.push(business);
        uniqueBizNames.add(business.bizName);
      }
    });

    return result;
  }
};

app.get("/search/:searchText", async (req, res) => {
  functions.logger.info("Get Business by Name", { structuredData: true });

  // // Fetch all cuisines
  // let cuisines = await getCuisines();

  // //Filter cuisines based on searchText
  // cuisines = cuisines.filter((c) =>
  //   c.cuisName.toLowerCase().indexOf(req.params.searchText.toLowerCase())
  // );

  //Fetch all verified businesses
  const collection = admin
    .firestore()
    .collection("Business")
    .where("bizVerified", "==", true);
  const businesses = await collection.get().then((snapshot) => {
    const result: DocumentData[] = [];
    snapshot.forEach((doc) => {
      result.push(doc.data());
    });

    return result;
  });

  // Search businesses based on searchText and filtered cuisines

  let result = await searchBiz(businesses, req.params.searchText);

  // Sort businesses by distance if lat and lng are provided
  // if (req.query.lat != undefined && req.query.lng != undefined) {
  //   result = sortBusinessByDistance(
  //     result,
  //     req.query.lat as string,
  //     req.query.lng as string
  //   );
  // }

  res.send(result);
});

app.post("/concern", authenticationMiddleware, async (req, res) => {
  if (!req.body.bizId) {
    res.status(404).send("Invalid request");
    return;
  }

  const firestore = admin
    .firestore()
    .collection("Business")
    .doc(req.body.bizId)
    .collection("Concerns");

  let doc = firestore.doc();

  let concern = {
    orderId: req.body.orderId,
    titles: req.body.concern.titles,
    detail: req.body.concern.detail,
    id: doc.id,
    uid: (req as any).user.uid,
  };

  await doc.set(concern);
  res.send({ concernId: doc.id });
});

app.post("/:bizId/order", authenticationMiddleware, async (req, res) => {
  try {
    functions.logger.info("Create order", { structuredData: true });

    const ordersCollection = admin.firestore().collection("Orders");

    const orderStatus =
      req.body.orderPaymentType === "ON_APPROACH"
        ? "PENDING_ON_APPROACH"
        : null;

    const order: DocumentData = {
      orderId: uuidv4(),
      bizId: req.params.bizId,
      dishes: req.body.orderItems,
      dishStatus: "WAITING",
      userId: (req as any).user.uid,
      date: new Date().toISOString(),
      timestamp: new Date(),
      orderTableNo: req.body.orderTableNo || null,
      orderPaymentType: req.body.orderPaymentType || null,
      orderPaymentDistance: req.body.orderPaymentDistance || null,
      OrderStatus: orderStatus,
      reservationId: req.body.reservationId,
    };

    await ordersCollection.doc().set(order);

    if (order.reservationId) {
      let res = await getReservation(req.params.bizId, (req as any).user.uid);
      if (res) {
        await admin
          .firestore()
          .collection("Reservations")
          .doc(res.id)
          .update({
            reservationStatus: "fullfiled",
          })
          .catch((e) => {
            functions.logger.info(`error ${e}`, { structuredData: true });
          });
      }
    }

    res.json(order);
  } catch (error) {
    console.error("Error creating order:", error);
    res.status(500).send("Internal Server Error");
  }
});

const getDishesFrorMenu = async (menuId: string) => {
  const dishesWithRef = await admin
    .firestore()
    .collection("DishDetails")

    .where("dishMenuId", "==", menuId)
    .get()
    .then((snapshot) => {
      const result: { data: DocumentData; ref: DocumentReference }[] = [];

      snapshot.forEach((doc) => {
        let dish = doc.data();

        result.push({ data: dish, ref: doc.ref });
      });

      //

      return result;
    });

  let dishes = [];

  for (let d of dishesWithRef) {
    let dish = d.data;

    const dishOptCollection = await d.ref.collection("dishOptions").get();
    let dishOptions = !dishOptCollection.empty
      ? dishOptCollection.docs.map((opt) => opt.data())
      : [];

    dish["dishOptions"] = dishOptions;

    dishes.push(dish);
  }
  return dishes;
};
const getDishesFromMenu = async (menuId: string) => {
  const snapshot = await admin
    .firestore()
    .collection("DishDetails")
    .where("dishMenuId", "==", menuId)
    .get();

  const dishes: any[] = []; // Array to hold dish names

  snapshot.forEach((doc) => {
    const dish = doc.data();
    dishes.push(dish); // Push only the dish name
  });

  return dishes; // Return the array of dish names
};

app.get("/:id/menus/", async (req, res) => {
  //  gets data for the menus first by getting menus then dishes
  functions.logger.info(`Get Business menus--no${req.params.id}`, {
    structuredData: true,
  });

  const menus = await admin
    .firestore()
    .collection("MenuDetails")
    .where("menuBizId", "==", String(req.params.id))
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push({ ...doc.data() });
      });

      return result;
    })
    .catch((e) => {
      console.log(e);
      return [];
    });

  for (const menu of menus) {
    const dishes = await getDishesFrorMenu(menu.menuId);

    menu.dishes = dishes;
  }

  res.send(menus);
});

const getReservation = async (bizId: string, uid: string) => {
  const firestore = admin.firestore().collection("Reservations");

  const oldReservation = await firestore
    .where("userId", "==", uid)
    .where("bizId", "==", bizId)
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push({
          id: doc.id,
          ...doc.data(),
        });
      });
      return result;
    });

  return oldReservation.length > 0 ? oldReservation[0] : null;
};

app.post("/:bizId/reserve", authenticationMiddleware, async (req, res) => {
  functions.logger.info("Create reservation", { structuredData: true });
  const firestore = admin.firestore().collection("Reservations");

  const oldReservation = await firestore
    .where("userId", "==", (req as any).user.uid)
    .where("bizId", "==", req.params.bizId)
    .get()
    .then((snapshot) => {
      const result: DocumentData[] = [];
      snapshot.forEach((doc) => {
        result.push(doc.data());
      });
      return result;
    });

  if (oldReservation.length > 0) {
    res.status(402).send({ error: "Cannot create reservations" });
    // throw new Error("Create reservation failed");
  } else {
    let doc = firestore.doc();
    const uid = (req as any).user.uid;
    const reservation = {
      reservationId: doc.id,
      bizId: req.params.bizId,
      userId: uid,
      date: Timestamp.fromDate(new Date()),
      reservationDate: req.body.reservationDate,
      numberOfPeople: req.body.numberOfPeople,
      timeFrom: req.body.timeFrom,
      timeTo: req.body.timeTo,
      occasion: req.body.occasion,
      area: req.body.area,
      tableMode: req.body.tableMode,
      accessibility: req.body.accessibility,
      userFirstName: req.body.userFirstName,
      userLastName: req.body.userLastName,
      userPhone: req.body.userPhone,
      userEmail: req.body.userEmail,
      payAmount: req.body.payAmount,
      reservationStatus: req.body.reservationStatus,
      bizName: req.body.bizName,
      bizAddress: req.body.bizAddress,
      dishes: req.body.dishes,
      bizImage: req.body.bizImage,
    };
    const filteredReservation = Object.fromEntries(
      Object.entries(reservation).filter(([_, v]) => v !== undefined)
    );

    await doc.set(filteredReservation);
    res.json(true);

    if (uid) {
      const userCollection = admin.firestore().collection("Users");
      const userRef = await userCollection
        .where("userId", "==", uid)
        .get()
        .then((snapshot) => {
          const docs: any = [];
          snapshot.forEach((doc) => {
            docs.push(doc.ref);
          });
          return docs[0];
        });

        // Update points and mark as processed
        await userRef?.update({
          "piattoRewards.PiattoReserver": FieldValue.increment(5),
        })
    }
  }
});

app.post("/:bizId/review", authenticationMiddleware, async (req, res) => {
  functions.logger.info("Create review", { structuredData: true });
  const firestore = admin.firestore().collection("Reviews");

  const review: DocumentData = {
    reviewId: uuidv4(),
    bizId: req.params.bizId,
    revUid: (req as any).user.uid,
    revDate: new Date().toISOString(),
    revVisitDate: req.body.revVisitDate,
    revVisitTime: req.body.revVisitTime,
    revFoodDrink: req.body.revFoodDrink,
    revFoodPres: req.body.revFoodPres,
    revService: req.body.revService,
    revDecor: req.body.revDecor,
    revStaffPres: req.body.revStaffPres,
    revSetting: req.body.revSetting,
    revComfort: req.body.revComfort,
    revComments: req.body.revComments,
  };

  await firestore.doc().set(review);
  res.json(true);
});

app.post(
  "/:bizId/accessibility-review",
  authenticationMiddleware,
  async (req, res) => {
    functions.logger.info("Created accessibility review", {
      structuredData: true,
    });
    const firestore = admin.firestore().collection("accessReview");

    const accessibilityReview: DocumentData = {
      reviewId: uuidv4(),
      bizId: req.params.bizId,
      revUid: (req as any).user.uid,
      revDate: new Date().toISOString(),
      disAccessEnt: req.body.disAccessEnt,
      disAccessEntRating: req.body.disAccessEntRating,
      disParkBays: req.body.disParkBays,
      disParkBaysRating: req.body.disParkBaysRating,
      disCarparkToVenue: req.body.disCarparkToVenue,
      disCarparkToVenueRating: req.body.disCarparkToVenueRating,
      disBathroom: req.body.disBathroom,
      disBathroomRating: req.body.disBathroomRating,
      staffUnderstanding: req.body.staffUnderstanding,
      staffUnderstandingRating: req.body.staffUnderstandingRating,
      menuAccess: req.body.menuAccess,
      menuAccessRating: req.body.menuAccessRating,
      orderAccess: req.body.orderAccess,
      orderAccessRating: req.body.orderAccessRating,
      payingAccess: req.body.payingAccess,
      payingAccessRating: req.body.payingAccessRating,
    };

    await firestore.doc().set(accessibilityReview);
    res.json(true);
  }
);

// // Start writing Firebase Functions
// // https://firebase.google.com/docs/functions/typescript
export const business = functions
  .region("australia-southeast1")
  .https.onRequest(app);

const getBusineessPreccint = async (
  preccints: DocumentData[],
  bussiness: any
) => {
  // returns business with precinct metadata
  for (let p of preccints) {
    const city = p["city"];
    for (const precinct of p["precincts"]) {
      const sLon = precinct["lon"];
      const sLat = precinct["lat"];
      const blat = bussiness["bizLat"];
      const blon = bussiness["bizLon"];

      if (!isNaN(sLon) && !isNaN(sLat) && !isNaN(blat) && !isNaN(blon)) {
        const kms = getDistanceFromLatLonInKm(
          { lat: sLat, lng: sLon },
          { lat: blat, lng: blon }
        );
        const meters = kms * 1000;
        if (meters <= parseFloat(precinct["radius"])) {
          const update = {
            bizPrecinct: { // standardized name
              city: city,
              precinct: precinct["name"],
            },
          };
          return update;
        }
      }
    }
  }
  return null;
};

export const addedBussiness = functions
  .region("australia-southeast1")
  .firestore.document(`Business/{bizId}`)
  .onCreate(async (snapshot) => {
    functions.logger.info("Business created - assigning precinct", { structuredData: true });
    const data = snapshot.data();
    // Use the same collection name as the HTTP API uses ("Precincts")
    const preSnapshot = await admin.firestore().collection("Precincts").get();

    if (!preSnapshot.empty) {
      const precs = preSnapshot.docs.map((doc) => doc.data());
      const updatedBusiness = await getBusineessPreccint(precs, { ...data });
      if (updatedBusiness) {
        await snapshot.ref.update(updatedBusiness);
      }
    }
  });

