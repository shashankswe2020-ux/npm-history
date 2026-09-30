import { build } from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
await rm(new URL("../dist/", import.meta.url), {
  recursive: true,
  force: true,
});
await mkdir(new URL("../dist/public/", import.meta.url), { recursive: true });
await build({
  absWorkingDir: root,
  entryPoints: ["src/server.ts"],
  outdir: "dist",
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  target: "node22",
});
await build({
  absWorkingDir: root,
  entryPoints: ["web/app.ts"],
  outdir: "dist/public",
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2022",
  loader: { ".woff2": "file" },
  assetNames: "fonts/[name]-[hash]",
  publicPath: "/",
});
for (const name of ["index.html", "favicon.svg"])
  await cp(
    new URL(`../web/${name}`, import.meta.url),
    new URL(`../dist/public/${name}`, import.meta.url),
  );
