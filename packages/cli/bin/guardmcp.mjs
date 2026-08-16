#!/usr/bin/env node
// Loads the TS sources directly through tsx's runtime API rather than a
// compiled dist. packages/cli reaches into attack-lab/ (no package.json, no
// build step of its own) the same way scripts/*.ts and attack-lab/*.ts do, so
// this package has no dist either — see docs/cli/README.md.
import { register } from "tsx/esm/api";

register();
await import("../src/index.ts");
