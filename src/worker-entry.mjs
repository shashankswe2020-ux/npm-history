import { createWorkerHandler } from "./worker.js";
import { createNpmClient } from "./npm-client.js";

export default {
  fetch(request, environment, context) {
    return createWorkerHandler(createNpmClient())(
      request,
      {
        ...environment,
        ASSETS: {
          fetch: async () => new Response("Not found", { status: 404 }),
        },
      },
      context,
      caches.default,
    );
  },
};
