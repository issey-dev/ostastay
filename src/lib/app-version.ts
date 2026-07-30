import pkg from "../../package.json"

// Single source of truth for the version shown in the UI: package.json, which is
// what the release tag (vX.Y.Z) is cut from. Server-only — read it in a server
// component and pass the string down rather than importing it into client code.
export const APP_VERSION = pkg.version
