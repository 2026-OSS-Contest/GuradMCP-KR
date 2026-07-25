package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.DetectionPreview
import kr.guardmcp.controlplane.domain.DetectionPreviewService
import org.springframework.http.HttpStatus
import org.springframework.web.bind.annotation.PostMapping
import org.springframework.web.bind.annotation.RequestBody
import org.springframework.web.bind.annotation.RequestMapping
import org.springframework.web.bind.annotation.RestController

data class DetectPreviewRequest(val text: String)

@RestController
@RequestMapping("/api/v1")
class DetectController(private val previewService: DetectionPreviewService) {
    @PostMapping("/detect/preview")
    fun preview(@RequestBody request: DetectPreviewRequest): DetectionPreview {
        if (request.text.isBlank()) {
            throw ApiException(HttpStatus.BAD_REQUEST, "invalid_preview_text", "text must not be blank")
        }
        return previewService.preview(request.text)
    }
}
