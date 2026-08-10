package kr.guardmcp.controlplane.domain

import io.kotest.core.spec.style.StringSpec
import io.kotest.matchers.collections.shouldBeEmpty
import io.kotest.matchers.shouldBe
import io.kotest.matchers.string.shouldContain
import java.time.Clock

class DetectionPreviewServiceKotest : StringSpec({
    val policyStore = PolicyStore(Clock.systemUTC())
    val service = DetectionPreviewService(policyStore)

    "korean phone numbers are masked and yield mask_then_allow" {
        val preview = service.preview("고객 연락처는 010-1234-5678 입니다")

        preview.verdict shouldBe GuardAction.MASK_THEN_ALLOW
        preview.maskedText shouldContain "010-****-5678"
        preview.findings.single().policyId shouldBe "mask_korean_phone"
    }

    "credential file paths dominate the verdict fail-closed" {
        val preview = service.preview("cat /workspace/.env 그리고 010-1234-5678")

        preview.verdict shouldBe GuardAction.BLOCK
        preview.findings.map(DetectionFinding::policyId) shouldBe listOf("block_env_file_read", "mask_korean_phone")
    }

    "external email addresses require approval" {
        val preview = service.preview("partner@external.example 로 전송해줘")

        preview.verdict shouldBe GuardAction.REQUIRE_APPROVAL
        preview.findings.single().policyId shouldBe "approve_external_email"
    }

    "benign text stays allow with no findings" {
        val preview = service.preview("오늘 날씨가 좋네요")

        preview.verdict shouldBe GuardAction.ALLOW
        preview.findings.shouldBeEmpty()
        preview.maskedText shouldBe "오늘 날씨가 좋네요"
    }

    "a policy reconfigured to warn is reported as warn, not allow" {
        val store = PolicyStore(Clock.systemUTC())
        store.updatePolicy("approve_external_email", action = GuardAction.WARN, severity = null, priority = null)

        val preview = DetectionPreviewService(store).preview("partner@external.example 로 전송해줘")

        preview.verdict shouldBe GuardAction.WARN
        preview.findings.single().policyId shouldBe "approve_external_email"
    }

    "disabled pack stops its policy from matching" {
        val store = PolicyStore(Clock.systemUTC())
        store.updatePack("korean-pii", enabled = false)

        val preview = DetectionPreviewService(store).preview("010-1234-5678")

        preview.findings.shouldBeEmpty()
        preview.verdict shouldBe GuardAction.ALLOW
    }
})
