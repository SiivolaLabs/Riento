import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

const sourcePath = path.resolve("node_modules/@react-native-google-signin/google-signin/ios/RNGoogleSignin.mm");
const packagePath = path.resolve("node_modules/@react-native-google-signin/google-signin/package.json");
const source = await readFile(sourcePath, "utf8");
const packageJson = JSON.parse(await readFile(packagePath, "utf8"));
const oldCall = "[GIDSignIn.sharedInstance signInWithPresentingViewController:presentingViewController hint:hint additionalScopes:scopes completion:";
const newCall = "[GIDSignIn.sharedInstance signInWithPresentingViewController:presentingViewController hint:hint additionalScopes:scopes nonce:options[@\"nonce\"] completion:";
const oldCallCount = source.split(oldCall).length - 1;
const newCallCount = source.split(newCall).length - 1;

if (packageJson.version !== "16.1.2") {
  throw new Error(`Review the Google Sign-In nonce patch before using version ${packageJson.version}.`);
}

if (newCallCount === 1 && oldCallCount === 0) {
  process.exit(0);
}

if (oldCallCount !== 1 || newCallCount !== 0) {
  throw new Error("The Google Sign-In iOS implementation changed; review the nonce patch before building.");
}

await writeFile(sourcePath, source.replace(oldCall, newCall));
