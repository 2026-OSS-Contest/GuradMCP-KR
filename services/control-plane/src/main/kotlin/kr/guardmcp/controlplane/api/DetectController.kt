package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.DetectionPreview
import kr.guardmcp.controlplane.domain.DetectionPreviewService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RequestParam
import org.springframework.web.bind.annotation.RestController

data class DetectPreviewRequest(val text: String)

@RestController
@RequestMapping("/api/v1")
class DetectController(private val previewService: DetectionPreviewService) {
    /**
     * fix-api.md §3: `direction` rides as a query parameter, matching how the console already
     * sends it (`apps/console/lib/api/client.ts`'s `previewDetection`) — the body only ever
     * carries `text`. `null`/absent keeps the pre-existing (direction-agnostic) behavior.
     */
    @PostMapping("/detect/preview")
    fun preview(
        @RequestBody request: DetectPreviewRequest,
        @RequestParam(required = false) direction: String?,
    ): DetectionPreview {
        if (request.text.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_preview_text", "text must not be blank")
        }
        if (direction != null && direction !in VALID_DIRECTIONS) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_direction", "direction must be one of $VALID_DIRECTIONS")
        }
        return previewService.preview(request.text, direction)
    }

    private companion object {
        val VALID_DIRECTIONS = setOf("request", "response")
    }
}
