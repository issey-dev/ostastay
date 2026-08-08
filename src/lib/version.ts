import packageJson from "../../package.json"

// Single source of truth for the version shown in the app chrome — always the
// number that was actually built, never a value that can drift from package.json.
export const APP_VERSION = packageJson.version
