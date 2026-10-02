import { readFileSync } from "node:fs";

const tag = process.env.RELEASE_TAG;
if (!tag || !/^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.test(tag)) {
  throw new Error("RELEASE_TAG must be a canonical v-prefixed SemVer tag.");
}

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));
const packageLock = JSON.parse(readFileSync("package-lock.json", "utf8"));
const versions = {
  packageJson: packageJson.version,
  packageLock: packageLock.version,
};
const expectedVersion = tag.slice(1);
const mismatches = Object.entries(versions).filter(([, version]) => version !== expectedVersion);
if (mismatches.length > 0) {
  throw new Error(`Release version mismatch for ${tag}: ${mismatches.map(([file, version]) => `${file}=${version ?? "missing"}`).join(", ")}`);
}

console.log(`Release versions synchronized for ${tag}.`);
