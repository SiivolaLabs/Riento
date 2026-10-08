import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const rootDir = resolve(scriptDir, "..");
const outputDirectory = resolve(rootDir, "public/legal");
const pageSources = [
  ["index.html", "index.html"],
  ["ACCOUNT_DELETION.html", "docs/ACCOUNT_DELETION.html"],
  ["COMMUNITY_GUIDELINES.html", "docs/COMMUNITY_GUIDELINES.html"],
  ["PRIVACY_POLICY.html", "docs/PRIVACY_POLICY.html"],
  ["SUPPORT.html", "docs/SUPPORT.html"],
  ["TERMS.html", "docs/TERMS.html"]
] as const;

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});

async function main() {
  const pages = await Promise.all(pageSources.map(async ([name, sourcePath]) => {
    const source = await readFile(resolve(rootDir, sourcePath), "utf8");
    return [name, name === "index.html" ? source.replaceAll('href="./docs/', 'href="./') : source] as const;
  }));

  if (process.argv.includes("--check-live")) {
    await checkLivePages(pages);
    console.log("Live legal pages match the release source files.");
    return;
  }

  if (process.argv.includes("--check")) {
    const stalePage = await firstStalePage(pages);

    if (stalePage) {
      throw new Error("Hosted legal pages are stale. Run npm run legal:pages:sync.");
    }

    console.log("Hosted legal pages match their source HTML files.");
    return;
  }

  await mkdir(outputDirectory, { recursive: true });
  await Promise.all(pages.map(([name, contents]) => writeFile(resolve(outputDirectory, name), contents)));
  console.log(`Wrote ${pages.length} hosted legal pages to ${outputDirectory}`);
}

async function checkLivePages(pages: ReadonlyArray<readonly [string, string]>) {
  const baseUrl = (process.env.EXPO_PUBLIC_LEGAL_BASE_URL ?? "https://riento.expo.app/legal").replace(/\/$/, "");

  for (const [name, contents] of pages) {
    const response = await fetch(`${baseUrl}/${name}`, {
      cache: "no-store",
      headers: { "Cache-Control": "no-cache" }
    });

    if (!response.ok) {
      throw new Error(`Live legal page ${name} returned HTTP ${response.status}.`);
    }

    if (await response.text() !== contents) {
      throw new Error(`Live legal page ${name} does not match the release source. Deploy the hosted pages before rollout.`);
    }
  }
}

async function firstStalePage(pages: ReadonlyArray<readonly [string, string]>) {
  for (const [name, contents] of pages) {
    if (await readFile(resolve(outputDirectory, name), "utf8").catch(() => "") !== contents) {
      return name;
    }
  }

  return null;
}
