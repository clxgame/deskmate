import { afterEach, expect, mock, test } from "bun:test";
import { waitFor } from "@testing-library/react";
import { createServer, type ServerResponse } from "node:http";
import { isNativeHistoryEvent, subscribeNativeHistoryEvents } from "./nativeHistoryEvents";

const disposals: Array<() => void> = [];
afterEach(() => { for (const dispose of disposals.splice(0)) dispose(); });

function event(type: string, directory = "C:/project") {
  return { directory, payload: { type, properties: { sessionID: "session" } } };
}

test("recognizes native lifecycle envelopes across projects and rejects unrelated data", () => {
  // Given / When: native global envelopes from multiple projects reach the boundary.
  const recognized = ["session.created", "session.updated", "session.deleted", "session.status"].map(type => isNativeHistoryEvent(event(type, "C:/other")));
  // Then: only history lifecycle changes invalidate the catalog.
  expect(recognized).toEqual([true, true, true, true]);
  for (const value of [event("message.part.delta"), event("server.heartbeat"), null, { type: "session.created" }, { payload: { type: "session.updated" } }]) expect(isNativeHistoryEvent(value)).toBe(false);
});

function streamServer() {
  let writer: ServerResponse | undefined;
  let requests = 0;
  const server = createServer((request, response) => {
    response.setHeader("Access-Control-Allow-Origin", "*");
    response.setHeader("Access-Control-Allow-Headers", "Authorization");
    if (request.method === "OPTIONS") { response.end(); return; }
    requests += 1;
    expect(request.url).toBe("/global/event");
    expect(request.headers.authorization).toBe("Basic synthetic");
    response.setHeader("Content-Type", "text/event-stream");
    response.flushHeaders();
    writer = response;
    response.write(": connected\r\n\r\n");
  });
  const ready = new Promise<string>(resolve => server.listen(0, "127.0.0.1", () => {
    const address = server.address();
    if (address && typeof address === "object") resolve(`http://127.0.0.1:${address.port}`);
  }));
  disposals.push(() => { writer?.end(); server.closeAllConnections(); server.close(); });
  return {
    bootstrap: async () => ({ base: await ready, headers: { Authorization: "Basic synthetic" } }),
    send: (value: unknown) => writer?.write(`data: ${JSON.stringify(value)}\r\n\r\n`),
    requests: () => requests,
    disconnect: () => writer?.end(),
  };
}
test("a lifecycle burst refreshes once and unsubscribe cancels pending refresh", async () => {
  // Given: a real authenticated HTTP stream has connected and reconciled once.
  const server = streamServer();
  const changed = mock(() => {});
  const stop = subscribeNativeHistoryEvents(changed, server.bootstrap);
  disposals.push(stop);
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  // When: several native changes arrive together.
  server.send(event("session.created"));
  server.send(event("session.updated"));
  server.send(event("session.status"));
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2));
  server.send(event("message.part.delta"));
  server.send(event("session.deleted"));
  stop();
  // Then: stopping cancels queued changes and releases the stream.
  await new Promise(resolve => setTimeout(resolve, 220));
  expect(changed).toHaveBeenCalledTimes(2);
  expect(server.requests()).toBe(1);
});

test("an offline sidecar never clears cached history and stopping cancels reconnect", async () => {
  // Given: bootstrap is unavailable; the existing catalog remains owned by its caller.
  const changed = mock(() => {});
  const bootstrap = mock(async () => { throw new TypeError("offline"); });
  const stop = subscribeNativeHistoryEvents(changed, bootstrap);
  disposals.push(stop);
  await waitFor(() => expect(bootstrap).toHaveBeenCalledTimes(1));
  // When: the organizer closes while reconnect is pending.
  stop();
  // Then: no refresh or reconnect occurs after disposal.
  await new Promise(resolve => setTimeout(resolve, 550));
  expect(changed).not.toHaveBeenCalled();
  expect(bootstrap).toHaveBeenCalledTimes(1);
});




test("reconnection reconciles changes missed while disconnected", async () => {
  // Given: a connected native event stream has reconciled the initial catalog.
  const server = streamServer();
  const changed = mock(() => {});
  const stop = subscribeNativeHistoryEvents(changed, server.bootstrap);
  disposals.push(stop);
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1));
  // When: the sidecar disconnects and the subscription reconnects.
  server.disconnect();
  // Then: reconnect triggers a fresh catalog even without a new lifecycle event.
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(2), { timeout: 2000 });
  expect(server.requests()).toBe(2);
});

test("a string bootstrap rejection is retried without discarding the catalog", async () => {
  // Given: the desktop bridge reports a temporary sidecar error as a string.
  const server = streamServer();
  let attempts = 0;
  const bootstrap = async () => {
    if (++attempts === 1) return Promise.reject("sidecar offline");
    return server.bootstrap();
  };
  const changed = mock(() => {});
  // When: the subscription encounters that bridge error.
  const stop = subscribeNativeHistoryEvents(changed, bootstrap);
  disposals.push(stop);
  // Then: recovery refreshes once using the authenticated native stream.
  await waitFor(() => expect(changed).toHaveBeenCalledTimes(1), { timeout: 2000 });
  expect(attempts).toBe(2);
});
