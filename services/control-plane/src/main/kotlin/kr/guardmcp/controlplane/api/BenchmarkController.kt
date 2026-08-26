package kr.guardmcp.controlplane.api

import org.springframework.beans.factory.annotation.Value
import org.springframework.http.HttpStatus
import org.springframework.http.MediaType
import org.springframework.http.ResponseEntity
import org.springframework.web.bind.annotation.GetMapping
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController
import java.nio.file.Files
import java.nio.file.Path

/**
 * fix-api.md §7 (SCR-601 탐지 벤치마크): `attack-lab/benchmark/run.ts` already computes and
 * writes the full report (and, alongside it, the per-sample verdicts `collectBenchmarkSamples`
 * produces) — these two endpoints read and serve those files verbatim, exactly as the doc's own
 * proposal describes ("계산할 필요 없습니다... 그 산출물을 읽어 서빙"). The console's
 * `BenchmarkReport`/`BenchmarkSamplesResponse` types (`apps/console/lib/api/types.ts`) match
 * `run.ts`'s output field for field; extra fields the report carries but the console doesn't
 * model (e.g. `dryRunObservations`, `koreanInjection`) pass through and are ignored on that side.
 *
 * `GUARDMCP_BENCHMARK_REPORT`/`GUARDMCP_BENCHMARK_SAMPLES` are the exact env vars `run.ts` itself
 * reads for its two output paths, so a deployment that overrides one side's path overrides both.
 *
 * Deliberately serves each file's raw bytes rather than parsing it into Kotlin data classes and
 * re-serializing: neither file has a schema this service owns or validates, and a byte-for-byte
 * pass-through can never drift from what `run.ts` actually wrote (a number's formatting, a field
 * neither side has modeled yet).
 */
@RestController
@RequestMapping("/api/v1")
class BenchmarkController(
    @Value("\${GUARDMCP_BENCHMARK_REPORT:reports/benchmark.json}") private val reportPath: String,
    @Value("\${GUARDMCP_BENCHMARK_SAMPLES:reports/benchmark-samples.json}") private val samplesPath: String,
) {
    @GetMapping("/benchmark/report", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun report(): ResponseEntity<String> = serveFile(reportPath, "benchmark_report_not_found", "npm run bench")

    @GetMapping("/benchmark/samples", produces = [MediaType.APPLICATION_JSON_VALUE])
    fun samples(): ResponseEntity<String> = serveFile(samplesPath, "benchmark_samples_not_found", "npm run bench")

    private fun serveFile(path: String, notFoundCode: String, howToProduce: String): ResponseEntity<String> {
        val file = Path.of(path)
        if (!Files.isRegularFile(file)) {
            throw ApiException(HttpStatus.NOT_FOUND, notFoundCode, "no file on file at $path — run `$howToProduce` or mount one there")
        }
        return ResponseEntity.ok(Files.readString(file))
    }
}
