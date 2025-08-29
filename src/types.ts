export interface User {
  id: string;
  userEmail: string;
  userPhone: string;
  userDOB: string;
  userFirstName: string;
  userLastName: string;
  userId: string;
  userStripeId: string;
  userDevices: { pushToken: string; name: string }[];
  userBusinesses: { bizId: number; role: string }[];
  userCurrentOrder?:{
    orderType:"onseated"|"onapproach",
    order:Partial<Order>,
    radius:number,
    geofencing:"incomplete"|"complete",
    postStatus?:"pending"|"complete",
    processing?:boolean
  };
 
}

export interface Order {
  id: string;
  orderId?: string;
  bizId?: string;
  bizStripeId: string;
  orderStatus?: "PENDING_ON_APPROACH" | "EXPIRED" | "WAITING" | "COMPLETE";
  orderTakeDelDine?: "TAKE" | "DELIVERY" | "DINE_IN";
  orderPaymentType: "ON_APPROACH" | "IMMEDIATE";
  orderPaymentDistance: number; // Used for ON_APPROACH payment type
  userId: string;
  orderTableNo: number;
  date: string;
  paymentIntent?: string;
  dishes: OrderItem[];
  setupPaymentIntent?:string
  bizName?: string; 
}

export interface DishDetails {
  dishID: string;
  bizId: string; //done
  bizName: string; //
  dishMenuId: number; // done
  dishName: string; // done
  dishDesc: string; // done
  dishAvailSize: DishAvailSize[];
  dishTotalPrice: number;
  dishOn: boolean; // done
  DishImage: string;
  dishOptions: DishOption[];
  dishStats: DishStat[];
  dishCal: string;
  dishAvailableFrom: string;
  dishAvailTill: string;
  dishAlc: boolean;
  dishPrice1: number;
}
export interface DishAvailSize {
  id: string;
  price: string;
  size: string;
}
export interface DishStat {
  stat_name: string;
  stat: string | boolean;
}
export interface DishOption {
  id: string;
  title: string;
  required: boolean;
  toggle: boolean;
  optionItems: DishOptionItem[];
}
export interface OrderItem extends DishDetails {
  dishCount: number;
}

export interface DishOptionItem {
  name: string;
  price: number; // in cents
  count: number;
  enabled: boolean;
  id: string;
}
export interface Cuisine {
  cuisId: number;
  cuisName: string;
}

export interface Business {
  uid: string;
}

