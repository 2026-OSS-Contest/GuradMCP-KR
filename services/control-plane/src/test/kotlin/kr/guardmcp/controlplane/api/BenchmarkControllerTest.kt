package kr.guardmcp.controlplane.api

import org.junit.jupiter.api.Assertions.assertEquals
import org.junit.jupiter.api.Assertions.assertTrue
import org.junit.jupiter.api.Test

private const val FIXTURES = "src/test/resources/fixtures"
private const val MISSING = "$FIXTURES/does-not-exist.json"

class BenchmarkControllerTest {
    @Test
    fun `serves the report file's raw bytes verbatim`() {
        val controller = BenchmarkController("$FIXTURES/benchmark-report.json", MISSING)

        val response = controller.report()

        assertEquals(200, response.statusCode.value())
        assertTrue(response.body!!.contains("\"passed\": true"))
    }

    @Test
    fun `answers 404, not an empty 200, when no report is on file yet`() {
        val controller = BenchmarkController(MISSING, MISSING)

        val exception = org.junit.jupiter.api.assertThrows<ApiException> { controller.report() }

        assertEquals("benchmark_report_not_found", exception.code)
    }

    @Test
    fun `serves the samples file's raw bytes verbatim`() {
        val controller = BenchmarkController(MISSING, "$FIXTURES/benchmark-samples.json")

        val response = controller.samples()

        assertEquals(200, response.statusCode.value())
        assertTrue(response.body!!.contains("\"group\": \"pii\""))
    }

    @Test
    fun `answers 404, not an empty 200, when no samples file is on file yet`() {
        val controller = BenchmarkController(MISSING, MISSING)

        val exception = org.junit.jupiter.api.assertThrows<ApiException> { controller.samples() }

        assertEquals("benchmark_samples_not_found", exception.code)
    }
}
