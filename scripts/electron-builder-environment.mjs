// Prepares signing-related environment variables for electron-builder.
import { join } from "node:path";

const signingVariables = [
  "CSC_LINK",
  "CSC_KEY_PASSWORD",
  "CSC_NAME",
  "WIN_CSC_LINK",
  "WIN_CSC_KEY_PASSWORD",
  "APPLE_ID",
  "APPLE_APP_SPECIFIC_PASSWORD",
  "APPLE_TEAM_ID",
];

export function prepareElectronBuilderEnvironment(environment, platform = process.platform) {
  const prepared = { ...environment };
  for (const variable of signingVariables) {
    if (!prepared[variable]) delete prepared[variable];
  }

  const hasSigningCredentials = Boolean(prepared.CSC_LINK || prepared.CSC_NAME || prepared.WIN_CSC_LINK);
  if (!hasSigningCredentials && !prepared.CSC_IDENTITY_AUTO_DISCOVERY) {
    prepared.CSC_IDENTITY_AUTO_DISCOVERY = "false";
  }
  if (platform === "win32" && !prepared.PATH && prepared.Path) {
    prepared.PATH = prepared.Path;
  }
  return prepared;
}

export function electronBuilderInvocation(root, args) {
  return {
    command: process.execPath,
    args: [join(root, "node_modules", "electron-builder", "cli.js"), ...args],
  };
}
