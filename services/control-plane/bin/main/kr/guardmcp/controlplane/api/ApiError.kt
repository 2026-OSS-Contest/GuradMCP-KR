package kr.guardmcp.controlplane.api

import kr.guardmcp.controlplane.domain.ApprovalAlreadyDecidedException
import kr.guardmcp.controlplane.domain.ApprovalNotFoundException
import org.springframework.http.HttpStatus
import org.springframework.http.ResponseEntity
import org.springframework.http.converter.HttpMessageNotReadableException
import org.springframework.web.bind.annotation.ExceptionHandler
import org.springframework.web.bind.annotation.RestControllerAdvice

/** Standardized error body: a stable reason code plus a human-readable message. */
data class ApiError(
    val code: String,
    val message: String,
    val details: Map<String, String> = emptyMap(),
)

class ApiException(
    val status: HttpStatus,
    val code: String,
    override val message: String,
    val details: Map<String, String> = emptyMap(),
) : RuntimeException(message)

@RestControllerAdvice
class ApiExceptionHandler {
    @ExceptionHandler(ApiException::class)
    fun handleApi(exception: ApiException): ResponseEntity<ApiError> =
        ResponseEntity.status(exception.status).body(ApiError(exception.code, exception.message, exception.details))

    @ExceptionHandler(ApprovalNotFoundException::class)
    fun handleApprovalNotFound(exception: ApprovalNotFoundException): ResponseEntity<ApiError> =
        ResponseEntity.status(HttpStatus.NOT_FOUND)
            .body(ApiError("approval_not_found", exception.message ?: "approval not found"))

    @ExceptionHandler(ApprovalAlreadyDecidedException::class)
    fun handleApprovalAlreadyDecided(exception: ApprovalAlreadyDecidedException): ResponseEntity<ApiError> =
        ResponseEntity.status(HttpStatus.CONFLICT).body(
            ApiError(
                code = "approval_already_decided",
                message = exception.message ?: "approval already decided",
                details = mapOf("status" to exception.approval.status.wire),
            ),
        )

    @ExceptionHandler(HttpMessageNotReadableException::class)
    fun handleUnreadable(exception: HttpMessageNotReadableException): ResponseEntity<ApiError> =
        ResponseEntity.status(HttpStatus.BAD_REQUEST)
            .body(ApiError("invalid_request_body", "Request body is missing or malformed"))
}
