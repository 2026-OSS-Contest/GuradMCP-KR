import { describe, expect, it } from "vitest";
import { toApproval, toApprovals } from "./approval-adapter";
import type { ApiApproval } from "./types";

/** The fields the control plane does model, so every case below varies only the opaque three. */
const BASE: ApiApproval = {
  id: "a1",
  sessionId: "s1",
  status: "pending",
  toolName: "send_email",
  arguments: { to: "partner@example.com" },
  riskReason: "외부 수신자에게 비밀값이 포함된 본문",
  policyId: "approve_external_email_with_secret",
  requestedAt: "2026-08-23T08:00:00Z",
  expiresAt: "2026-08-23T08:05:00Z",
  decision: null,
  decidedBy: null,
  decidedAt: null,
};

const well = (over: Partial<ApiApproval>): ApiApproval => ({ ...BASE, ...over });

describe("toApproval", () => {
  it("passes a well-formed card through unchanged", () => {
    const card = well({
      riskTags: [{ type: "SECRET", count: 1 }],
      threatScore: 72,
      maskPreview: {
        raw: [{ no: "1", parts: [{ text: "키는 " }, { sensitive: "sk_live_abc" }] }],
        masked: [{ no: "1", parts: [{ text: "키는 " }, { mask: "SECRET" }] }],
      },
    });
    const adapted = toApproval(card);
    expect(adapted.riskTags).toEqual([{ type: "SECRET", count: 1 }]);
    expect(adapted.threatScore).toBe(72);
    expect(adapted.maskPreview?.raw[0].parts[1]).toEqual({ sensitive: "sk_live_abc" });
    expect(adapted.maskPreview?.masked[0].parts[1]).toEqual({ mask: "SECRET" });
  });

  it("never throws on a shape the gateway never promised", () => {
    // `ApprovalStore` holds these as `Any?`, so any of this can arrive.
    const junk = well({ riskTags: "SECRET", threatScore: "high", maskPreview: 42 });
    expect(() => toApproval(junk)).not.toThrow();
    const adapted = toApproval(junk);
    expect(adapted.riskTags).toBeUndefined();
    expect(adapted.threatScore).toBeUndefined();
    expect(adapted.maskPreview).toBeUndefined();
  });

  it("keeps the decidable half of the card when the evidence is unusable", () => {
    const adapted = toApproval(well({ riskTags: null, maskPreview: null }));
    expect(adapted.toolName).toBe("send_email");
    expect(adapted.riskReason).toBe(BASE.riskReason);
    expect(adapted.expiresAt).toBe(BASE.expiresAt);
  });

  it("drops a malformed tag without losing the others", () => {
    const adapted = toApproval(
      well({ riskTags: [{ type: "SECRET", count: 1 }, { type: "INJECTION" }, null, { count: 3 }] }),
    );
    expect(adapted.riskTags).toEqual([{ type: "SECRET", count: 1 }]);
  });

  it("reports no tags rather than an empty chip row", () => {
    expect(toApproval(well({ riskTags: [] })).riskTags).toBeUndefined();
    expect(toApproval(well({ riskTags: [{ nope: true }] })).riskTags).toBeUndefined();
  });

  it("rejects a threat score outside the gauge it is drawn on", () => {
    expect(toApproval(well({ threatScore: 0 })).threatScore).toBe(0);
    expect(toApproval(well({ threatScore: 100 })).threatScore).toBe(100);
    expect(toApproval(well({ threatScore: 101 })).threatScore).toBeUndefined();
    expect(toApproval(well({ threatScore: -1 })).threatScore).toBeUndefined();
    expect(toApproval(well({ threatScore: Number.NaN })).threatScore).toBeUndefined();
  });

  it("voids the whole preview when one pane is missing", () => {
    // Half a comparison is not a comparison: the panel claims "this would go out, this would
    // replace it", and one side alone cannot support that.
    const oneSided = well({
      maskPreview: { raw: [{ no: "1", parts: [{ text: "a" }] }] },
    });
    expect(toApproval(oneSided).maskPreview).toBeUndefined();
  });

  it("voids the preview when a single line is malformed, rather than renumbering around it", () => {
    // The gutter numbers are how the two panes are read against each other, so silently
    // dropping line 2 would show a diff that never existed.
    const holed = well({
      maskPreview: {
        raw: [{ no: "1", parts: [{ text: "a" }] }, { no: 2, parts: [{ text: "b" }] }],
        masked: [{ no: "1", parts: [{ text: "a" }] }, { no: "2", parts: [{ text: "b" }] }],
      },
    });
    expect(toApproval(holed).maskPreview).toBeUndefined();
  });

  it("voids the preview when a part names no run the panes can draw", () => {
    const badPart = well({
      maskPreview: {
        raw: [{ no: "1", parts: [{ mask: "PHONE" }] }],
        masked: [{ no: "1", parts: [{ mask: "PHONE" }] }],
      },
    });
    // `mask` is a masked-pane run; the raw pane has to show the value itself, so this is not a
    // raw part and the preview cannot be trusted.
    expect(toApproval(badPart).maskPreview).toBeUndefined();
  });
});

describe("toApprovals", () => {
  it("narrows each card independently", () => {
    const [good, bad] = toApprovals([
      well({ id: "a1", riskTags: [{ type: "SECRET", count: 2 }] }),
      well({ id: "a2", riskTags: { type: "SECRET" } }),
    ]);
    expect(good.riskTags).toEqual([{ type: "SECRET", count: 2 }]);
    expect(bad.riskTags).toBeUndefined();
    expect(bad.id).toBe("a2");
  });
});
