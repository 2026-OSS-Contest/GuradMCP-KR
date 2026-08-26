package kr.guardmcp.controlplane.domain

/**
 * A test-only stand-in for what the Gateway actually pushes via `POST /policies/sync`
 * (fix-api.md §1) — mirrors `policy-packs/default` and `policy-packs/korean-pii` as they exist
 * on disk today (ids, priorities, actions, severities, `match.direction`), so tests exercise
 * [PolicyStore] the same way production does instead of relying on a hardcoded seed inside it.
 */
object PolicyFixtures {
    val packs: List<PolicySyncPackInput> = listOf(
        PolicySyncPackInput("default", "default", "Baseline protection for risky files, secrets, and prompt injection", enabled = true),
        PolicySyncPackInput("korean-pii", "korean-pii", "Korean PII masking and external-disclosure controls", enabled = true),
    )

    val policies: List<PolicySyncPolicyInput> = listOf(
        PolicySyncPolicyInput(
            id = "block_env_file_read", packId = "default", priority = 100, action = "block", severity = "critical",
            description = "Block reads of credential-bearing files", direction = "request",
            sourcePath = "policy-packs/default/policies/block-env-file-read.yaml", sourceYaml = "id: block_env_file_read\n",
        ),
        PolicySyncPolicyInput(
            id = "block_untrusted_injection_response", packId = "default", priority = 120, action = "block", severity = "critical",
            description = "Block high-risk prompt injection returned by an untrusted MCP server", direction = "response",
            sourcePath = "policy-packs/default/policies/block-injection-response.yaml", sourceYaml = "id: block_untrusted_injection_response\n",
        ),
        PolicySyncPolicyInput(
            id = "warn_injection_request", packId = "default", priority = 130, action = "warn", severity = "medium",
            description = "Warn on prompt-injection wording in tool arguments instead of blocking it", direction = "request",
            sourcePath = "policy-packs/default/policies/warn-injection-request.yaml", sourceYaml = "id: warn_injection_request\n",
        ),
        PolicySyncPolicyInput(
            id = "approve_external_email_with_secret", packId = "default", priority = 200, action = "require_approval", severity = "high",
            description = "Require human approval before sending sensitive data outside the organization", direction = "request",
            sourcePath = "policy-packs/default/policies/require-approval-external-secret-email.yaml", sourceYaml = "id: approve_external_email_with_secret\n",
        ),
        PolicySyncPolicyInput(
            id = "require_approval_untrusted_high_risk_tool", packId = "default", priority = 210, action = "require_approval", severity = "high",
            description = "신뢰 등급이 untrusted인 서버로 향하는 고위험 Tool 호출은 사람 승인을 거친다", direction = "request",
            sourcePath = "policy-packs/default/policies/require-approval-untrusted-high-risk-tool.yaml", sourceYaml = "id: require_approval_untrusted_high_risk_tool\n",
        ),
        PolicySyncPolicyInput(
            id = "mask_secret_response", packId = "default", priority = 310, action = "mask_then_allow", severity = "high",
            description = "Mask credentials detected in MCP tool responses", direction = "response",
            sourcePath = "policy-packs/default/policies/mask-secret-response.yaml", sourceYaml = "id: mask_secret_response\n",
        ),
        PolicySyncPolicyInput(
            id = "approve_external_email_with_korean_pii", packId = "korean-pii", priority = 180, action = "require_approval", severity = "high",
            description = "Require approval before emailing Korean PII outside the organization", direction = "request",
            sourcePath = "policy-packs/korean-pii/policies/require-approval-external-pii-email.yaml", sourceYaml = "id: approve_external_email_with_korean_pii\n",
        ),
        PolicySyncPolicyInput(
            id = "mask_korean_pii_response", packId = "korean-pii", priority = 300, action = "mask_then_allow", severity = "high",
            description = "Mask Korean PII detected in MCP tool responses", direction = "response",
            sourcePath = "policy-packs/korean-pii/policies/mask-korean-pii-response.yaml", sourceYaml = "id: mask_korean_pii_response\n",
        ),
        PolicySyncPolicyInput(
            id = "require_approval_bulk_pii_response", packId = "korean-pii", priority = 320, action = "require_approval", severity = "critical",
            description = "Hold a tool response that discloses personal data in bulk for human approval", direction = "response",
            sourcePath = "policy-packs/korean-pii/policies/require-approval-bulk-pii-response.yaml", sourceYaml = "id: require_approval_bulk_pii_response\n",
        ),
    )

    /** Populates [store] the same way a Gateway boot/hot-reload sync would. */
    fun syncInto(store: PolicyStore) {
        store.sync(packs, policies)
    }

    /** Wire-shaped body for the HTTP integration tests' `POST /api/v1/policies/sync`. */
    fun syncRequestBody(): Map<String, Any?> = mapOf(
        "packs" to packs.map { mapOf("packId" to it.packId, "name" to it.name, "description" to it.description, "enabled" to it.enabled) },
        "policies" to policies.map {
            mapOf(
                "id" to it.id, "packId" to it.packId, "priority" to it.priority, "action" to it.action, "severity" to it.severity,
                "description" to it.description, "direction" to it.direction, "enabled" to true,
                "sourcePath" to it.sourcePath, "sourceYaml" to it.sourceYaml,
            )
        },
    )
}
