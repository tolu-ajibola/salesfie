import { createServer, type Server, type ServerResponse } from "node:http";
import { config } from "../config.js";
import { getAuthUrl, exchangeCodeAndStore } from "../integrations/google.js";

/**
 * Tiny HTTP server that drives the per-BD Google OAuth handshake. Two routes:
 *   GET /oauth/google/start?email=<bd>   -> 302 redirect to Google consent
 *   GET /oauth/google/callback?code=&state=<bd> -> exchange + store tokens
 *
 * The redirect URI registered with Google must point at /oauth/google/callback
 * on this host (http://localhost:3000/oauth/google/callback in development).
 */
export function startOAuthServer(port = config.port): Server {
  const server = createServer(async (req, res) => {
    const u = new URL(req.url ?? "/", `http://localhost:${port}`);
    try {
      if (u.pathname === "/oauth/google/start") {
        const email = u.searchParams.get("email");
        if (!email) return send(res, 400, "Missing ?email=");
        res.writeHead(302, { Location: getAuthUrl(email) });
        return res.end();
      }
      if (u.pathname === "/oauth/google/callback") {
        const code = u.searchParams.get("code");
        const email = u.searchParams.get("state");
        const error = u.searchParams.get("error");
        if (error) return send(res, 400, `Google returned an error: ${error}`);
        if (!code || !email) return send(res, 400, "Missing code/state in callback.");
        await exchangeCodeAndStore(code, email);
        return send(res, 200, `Connected Google Calendar for ${email}. You can close this tab.`);
      }
      send(res, 404, "Not found");
    } catch (err) {
      send(res, 500, `Error: ${(err as Error).message}`);
    }
  });
  server.listen(port);
  return server;
}

function send(res: ServerResponse, status: number, body: string): void {
  res.writeHead(status, { "content-type": "text/plain; charset=utf-8" });
  res.end(body);
}
