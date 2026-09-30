import { createServer } from "node:http";
import { addDays, AppError, DAY_MS, toSeries } from "../src/history.js";
import { createHandler } from "../src/app.js";

const server = createServer(
  createHandler(
    {
      async history(query) {
        if (query.packages.includes("missing-package"))
          throw new AppError(
            404,
            "PACKAGE_NOT_FOUND",
            "npm has no download history for missing-package.",
          );
        return {
          start: query.start,
          end: query.end,
          mode: query.mode,
          generatedAt: new Date().toISOString(),
          series: query.packages.map((name, seriesIndex) =>
            toSeries(
              name,
              Array.from(
                {
                  length:
                    (Date.parse(query.end) - Date.parse(query.start)) / DAY_MS +
                    1,
                },
                (_, index) => ({
                  day: addDays(query.start, index),
                  downloads:
                    name === "zero-package"
                      ? 0
                      : 20 +
                        Math.floor(index / 8) * (seriesIndex + 1) +
                        (index % 7),
                }),
              ),
              query.mode,
            ),
          ),
        };
      },
    },
    new URL("../dist/public/", import.meta.url),
  ),
);
server.listen(14318, "127.0.0.1");
