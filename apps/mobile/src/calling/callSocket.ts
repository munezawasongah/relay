import type { ClientToCallServerEvents, ServerToCallClientEvents } from "@relay/shared";
import { io, type Socket } from "socket.io-client";
import { CALL_SIGNALING_BASE_URL } from "../config";

export type CallSocket = Socket<ServerToCallClientEvents, ClientToCallServerEvents>;

/** One connection per signed-in session, owned by CallContext — same
 *  reasoning as messaging/socket.ts's connectSocket, just talking to
 *  call-signaling-service instead. Kept as its own socket.io connection
 *  (not multiplexed onto the messaging one) since it's a genuinely
 *  separate service/process. */
export function connectCallSocket(token: string): CallSocket {
  return io(CALL_SIGNALING_BASE_URL, {
    auth: { token },
    transports: ["websocket"],
  });
}
