import { createServer } from "node:http";
import { createHandler } from "./app.js";
import { createNpmClient } from "./npm-client.js";

const port = Number(process.env.PORT ?? 4317);
const host = process.env.HOST ?? "127.0.0.1";
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT must be an integer from 1 to 65535.");
const server = createServer(
  { headersTimeout: 10_000, requestTimeout: 15_000, maxHeaderSize: 8192 },
  createHandler(createNpmClient(), new URL("./public/", import.meta.url)),
);
server.maxConnections = 100;
server.setTimeout(55_000);
server.listen(port, host, () =>
  console.log(`npm-history: http://${host}:${port}`),
);
for (const signal of ["SIGINT", "SIGTERM"] as const)
  process.once(signal, () => {
    server.close();
    setTimeout(() => server.closeAllConnections(), 5_000).unref();
  });
