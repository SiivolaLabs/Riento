import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { get } from "node:https";

const shouldFetch = process.env.RIENTO_FETCH_ACRCLOUD_ANDROID_SDK === "1";
const repoCommit = "ff9701991ea03c4b6a11540f598951007a158e4a";
const repoBase = `https://raw.githubusercontent.com/acrcloud/ACRCloudUniversalSDK/${repoCommit}/libs`;
const outputBase = resolve("modules/mesta-acrcloud/android/libs");

const files = [
  ["acrcloud-universal-sdk-1.3.33.jar", "acrcloud-universal-sdk-1.3.33.jar"],
  ["arm64-v8a/libACRCloudUniversalEngine.so", "arm64-v8a/libACRCloudUniversalEngine.so"],
  ["armeabi-v7a/libACRCloudUniversalEngine.so", "armeabi-v7a/libACRCloudUniversalEngine.so"],
  ["x86/libACRCloudUniversalEngine.so", "x86/libACRCloudUniversalEngine.so"],
  ["x86_64/libACRCloudUniversalEngine.so", "x86_64/libACRCloudUniversalEngine.so"]
];

if (!shouldFetch) {
  console.log("Skipping ACRCloud Android SDK fetch. Set RIENTO_FETCH_ACRCLOUD_ANDROID_SDK=1 to enable it for Android recognition builds.");
  process.exit(0);
}

for (const [sourcePath, outputPath] of files) {
  const targetPath = resolve(outputBase, outputPath);

  if (existsSync(targetPath)) {
    console.log(`ACRCloud SDK file already exists: ${outputPath}`);
    continue;
  }

  mkdirSync(dirname(targetPath), { recursive: true });
  await downloadFile(`${repoBase}/${sourcePath}`, targetPath);
  console.log(`Downloaded ACRCloud SDK file: ${outputPath}`);
}

function downloadFile(url, targetPath) {
  return new Promise((resolveDownload, rejectDownload) => {
    const request = get(url, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        rejectDownload(new Error(`Failed to download ${url}: HTTP ${response.statusCode}`));
        return;
      }

      const output = createWriteStream(targetPath, { mode: 0o600 });
      response.pipe(output);
      output.on("finish", () => {
        output.close(resolveDownload);
      });
      output.on("error", rejectDownload);
    });

    request.on("error", rejectDownload);
    request.setTimeout(60_000, () => {
      request.destroy(new Error(`Timed out downloading ${url}`));
    });
  });
}
