import type { ClientToServerEvents, ServerToClientEvents } from "@relay/shared";
import { io, type Socket } from "socket.io-client";
import { MESSAGING_BASE_URL } from "../config";

export type RelaySocket = Socket<ServerToClientEvents, ClientToServerEvents>;

/** One connection per signed-in session, owned by MessagingContext — screens
 *  reach it via useMessaging().socket rather than each opening their own.
 *  Matches messaging-service's handshake auth (services/messaging-service/
 *  src/index.ts's io.use(...)): the JWT goes in `auth.token`, not a header,
 *  since the WebSocket upgrade happens before any per-request header would
 *  normally be read. */
export function connectSocket(token: string): RelaySocket {
  return io(MESSAGING_BASE_URL, {
    auth: { token },
    transports: ["websocket"],
  });
}
