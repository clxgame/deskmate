/** Adapt the pinned host entry at build time; upstream files stay untouched. */
export function transformWorkbenchRouting(source: string, routeModule: string): string {
  let output = source.replaceAll("\r\n", "\n");
  function replace(before: string, after: string): void {
    if (!output.includes(before)) throw new Error("Pinned workbench bridge changed; routing adaptation requires review");
    output = output.replaceAll(before, after);
  }
  replace('import { base64Encode }', `import { createSessionOwnershipRouter, sessionRoute, sessionTargetFromUrl } from ${JSON.stringify(routeModule)}\nimport { base64Encode }`);
  replace('`/server/${base64Encode("sidecar")}/session/${connection.sessionId}`', 'sessionRoute({ directory: connection.directory ?? "", sessionId: connection.sessionId })');
  replace('`/server/${base64Encode("sidecar")}/session/${sessionId}`', 'sessionRoute(event.payload)');
  replace('listen<string>("workbench://handoff"', 'listen<{ directory: string; sessionId: string }>("workbench://handoff"');
  replace('sessionIdFromUrl(initialUrl)', 'JSON.stringify(sessionTargetFromUrl(initialUrl))');
  replace('sessionIdFromUrl(url)', 'JSON.stringify(sessionTargetFromUrl(url))');
  replace(`syncWorkbenchOwnership = (url) => {
      routedSessionId = JSON.stringify(sessionTargetFromUrl(url))
      reconcileOwnership()
    }`, `syncWorkbenchOwnership = createSessionOwnershipRouter(
      (sessionId) => bridge.core.invoke("workbench_resolve_session", { sessionId }),
      (target) => { routedSessionId = JSON.stringify(target); reconcileOwnership() },
      (error) => console.error("workbench ownership resolution failed", error),
    )`);
  for (const value of ["previous", "next"]) {
    replace(`{ sessionId: ${value} }`, `{ ...JSON.parse(${value}) }`);
  }
  replace('"workbench_heartbeat", { sessionId }', '"workbench_heartbeat", { ...JSON.parse(sessionId) }');
  replace('"workbench_release_session", { sessionId }', '"workbench_release_session", { ...JSON.parse(sessionId) }');
  replace('{ sessionId: decodeURIComponent(sessionId) }', '{ sessionId: decodeURIComponent(sessionId), directory: url.searchParams.get("directory") ?? request.headers.get("x-opencode-directory") ?? connection.directory }');
  replace('source: "workbench",', 'source: "workbench",\n            directory: session.directory,');
  replace('document.addEventListener("visibilitychange", reconcileOwnership)', `const unlistenShown = bridge.event.listen("workbench://shown", reconcileOwnership)
    document.addEventListener("visibilitychange", reconcileOwnership)`);
  replace('window.clearInterval(heartbeat)', `window.clearInterval(heartbeat)
      void unlistenShown.then((unlisten) => unlisten()).catch((error) => console.error("workbench shown listener cleanup failed", error))`);
  return output;
}

