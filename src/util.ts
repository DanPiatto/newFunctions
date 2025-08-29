import {Expo, ExpoPushMessage} from "expo-server-sdk";
const expo = new Expo();

/**
 * Send a push notification to a device
 * @param pushToken {String=} expo push token
 * @param message {String=} notification message
 */
export async function sendPushNotifications(
  pushTokens: string[],
  message: string
): Promise<{ success: boolean }> {
  const messages: ExpoPushMessage[] = [];
  const invalidTokens: string[] = [];

  for (const token of pushTokens) {
    if (!Expo.isExpoPushToken(token)) {
      console.error(`Push token ${token} is not a valid Expo push token`);
      invalidTokens.push(token); // Collect invalid tokens
      continue; // Skip invalid tokens
    }
    
    // Construct a message
    messages.push({
      to: token,
      sound: "default",
      body: message,
      data: { withSome: "data" },
    });
  }

  if (messages.length === 0) {
    return { success: false }; // No valid tokens to send to
  }

  const chunks = expo.chunkPushNotifications(messages);
  const tickets: any[] = []; // Adjust type as needed

  for (const chunk of chunks) {
    try {
      const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
      tickets.push(...ticketChunk);
    } catch (error) {
      console.error(error);
      return { success: false }; // Return false if there was an error sending notifications
    }
  }

  // Check for errors in the tickets
  const hasErrors = tickets.some(ticket => ticket.details && ticket.details.error);
  
  if (hasErrors) {
    console.error("Some notifications failed to send:", tickets);
    return { success: false }; // Return false if any ticket has an error
  }

  // Optionally log invalid tokens
  if (invalidTokens.length > 0) {
    console.warn("Invalid tokens:", invalidTokens);
  }

  return { success: true }; // All notifications sent successfully
}

