package kr.guardmcp.controlplane.api

import org.springframework.http.HttpStatus
import java.util.Base64

object Paging {
    data class Result<T>(val items: List<T>, val nextCursor: String?)

    fun <T> slice(list: List<T>, offset: Int, limit: Int): Result<T> {
        if (offset >= list.size) return Result(emptyList(), null)
        val end = (offset + limit).coerceAtMost(list.size)
        val next = if (end < list.size) CursorCodec.encode(end) else null
        return Result(list.subList(offset, end), next)
    }
}

/** Opaque pagination cursor: base64-encoded `{"offset":N}`, matching the documented API contract. */
object CursorCodec {
    private val OFFSET_PATTERN = Regex(""""offset"\s*:\s*(\d+)""")

    fun encode(offset: Int): String = Base64.getEncoder().encodeToString("{\"offset\":$offset}".toByteArray())

    fun decodeOffset(cursor: String): Int {
        val decoded = runCatching { String(Base64.getDecoder().decode(cursor)) }.getOrNull()
        val match = decoded?.let(OFFSET_PATTERN::find)
            ?: throw ApiException(HttpStatus.BAD_REQUEST, "invalid_cursor", "cursor is malformed")
        return match.groupValues[1].toInt()
    }
}
