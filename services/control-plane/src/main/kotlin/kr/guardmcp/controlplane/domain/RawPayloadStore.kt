package kr.guardmcp.controlplane.domain

import org.springframework.beans.factory.annotation.Value
import org.springframework.jdbc.core.JdbcTemplate
import org.springframework.stereotype.Component
import java.security.SecureRandom
import java.sql.PreparedStatement
import java.sql.Timestamp
import java.time.Instant
import java.util.Base64
import java.util.UUID
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/**
 * Application-level AES-256-GCM encryption for `raw_payload.payload_encrypted` (GMCP-84 §2/§5.2:
 * KMS key management is out of scope, so the key is a single env-provided secret, not rotated
 * automatically). Ciphertext is stored as `iv (12 bytes) || GCM output` -- GCM's own auth tag is
 * already appended by [Cipher], so no separate MAC bookkeeping is needed.
 *
 * A blank/unconfigured key ([isConfigured] false) makes raw-payload storage a no-op everywhere
 * it is attempted ([RawPayloadStore.insert] simply returns `null`), the same fail-closed shape
 * [kr.guardmcp.controlplane.api.AuditEventController]'s operator-token check already uses: an
 * operator can flip `rawPayloadStorageEnabled` on in Settings, but nothing is actually written
 * to disk unless this deployment also configured an encryption key out of band.
 */
@Component
class RawPayloadCrypto(
    @Value("\${security.raw-payload-encryption-key:}") encodedKey: String,
    @Value("\${security.raw-payload-encryption-key-version:v1}") val keyVersion: String,
) {
    private val secretKey: SecretKeySpec? = encodedKey.takeIf(String::isNotBlank)?.let {
        val decoded = Base64.getDecoder().decode(it)
        require(decoded.size == KEY_SIZE_BYTES) {
            "security.raw-payload-encryption-key must decode to $KEY_SIZE_BYTES bytes (AES-256), was ${decoded.size}"
        }
        SecretKeySpec(decoded, "AES")
    }

    val isConfigured: Boolean get() = secretKey != null

    fun encrypt(plaintext: String): ByteArray {
        val key = requireNotNull(secretKey) { "raw payload encryption key is not configured" }
        val iv = ByteArray(IV_SIZE_BYTES).also { SecureRandom().nextBytes(it) }
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        return iv + cipher.doFinal(plaintext.toByteArray(Charsets.UTF_8))
    }

    fun decrypt(payload: ByteArray): String {
        val key = requireNotNull(secretKey) { "raw payload encryption key is not configured" }
        val iv = payload.copyOfRange(0, IV_SIZE_BYTES)
        val ciphertext = payload.copyOfRange(IV_SIZE_BYTES, payload.size)
        val cipher = Cipher.getInstance(TRANSFORMATION)
        cipher.init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(GCM_TAG_BITS, iv))
        return String(cipher.doFinal(ciphertext), Charsets.UTF_8)
    }

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val KEY_SIZE_BYTES = 32
        const val IV_SIZE_BYTES = 12
        const val GCM_TAG_BITS = 128
    }
}

/**
 * `raw_payload` (GMCP-84 §5.2). The only writer is [kr.guardmcp.controlplane.domain
 * .GuardEventRepository.insert] -- it alone knows the `guard_event` row this must FK to already
 * exists -- and the only reader is [kr.guardmcp.controlplane.api.AuditEventController.reveal].
 */
@Component
class RawPayloadStore(private val jdbcTemplate: JdbcTemplate, private val crypto: RawPayloadCrypto) {
    val isConfigured: Boolean get() = crypto.isConfigured

    /** Encrypts and stores [plaintext], returning the new row's id, or `null` if no encryption
     *  key is configured -- storage is skipped rather than failing the whole ingest request. */
    fun insert(eventId: UUID, plaintext: String): UUID? {
        if (!crypto.isConfigured) return null
        val id = UUID.randomUUID()
        val encrypted = crypto.encrypt(plaintext)
        jdbcTemplate.update({ connection ->
            val statement: PreparedStatement = connection.prepareStatement(INSERT_SQL)
            statement.setObject(1, id)
            statement.setObject(2, eventId)
            statement.setBytes(3, encrypted)
            statement.setString(4, crypto.keyVersion)
            statement.setTimestamp(5, Timestamp.from(Instant.now()))
            statement
        })
        return id
    }

    /** `null` if the key configured now cannot decrypt what's stored (e.g. rotated away) or the
     *  row is gone -- the caller (reveal) treats that the same as "not stored". */
    fun decrypt(rawPayloadId: UUID): String? {
        if (!crypto.isConfigured) return null
        val encrypted = jdbcTemplate.query(SELECT_SQL, { rs, _ -> rs.getBytes("payload_encrypted") }, rawPayloadId)
            .firstOrNull() ?: return null
        return runCatching { crypto.decrypt(encrypted) }.getOrNull()
    }

    private companion object {
        const val INSERT_SQL = """
            INSERT INTO raw_payload (raw_payload_id, event_id, payload_encrypted, encryption_key_version, created_at)
            VALUES (?, ?, ?, ?, ?)
        """
        const val SELECT_SQL = "SELECT payload_encrypted FROM raw_payload WHERE raw_payload_id = ?"
    }
}
