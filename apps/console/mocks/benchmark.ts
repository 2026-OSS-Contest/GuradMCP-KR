// SCR-601 Benchmark fixtures (GMCP-61).
//
// Not written by hand: `benchmark-data.json` is the output of `npm run bench` on this repo,
// paired with the four datasets under `attack-lab/datasets/` that the run measured. Every number
// the screen shows is one the runner actually produced, so the demo cannot claim a result the
// project cannot reproduce — the screen prints the command beside it for exactly that reason.
//
// Regenerate with:
//   npm run bench -- --output <file>   then rebuild this file from it and the datasets.

import data from "./benchmark-data.json";
import type { BenchmarkReport, BenchmarkSample } from "@/lib/api/types";

export const benchmarkReport = data.report as unknown as BenchmarkReport;
export const benchmarkSamples = data.samples as unknown as BenchmarkSample[];
