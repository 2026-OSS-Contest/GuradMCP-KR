const verdicts = [
  { icon: "✓", label: "허용 / Allow", className: "allow" },
  { icon: "!", label: "경고 / Warn", className: "warn" },
  { icon: "?", label: "승인 필요 / Require approval", className: "approval" },
  { icon: "×", label: "차단 / Block", className: "block" }
];

export default function Home() {
  return (
    <main>
      <header><p className="eyebrow">GUARDMCP-KR</p><h1>Every tool call, inspected.</h1><p>MCP 요청과 응답을 한국형 개인정보 정책으로 보호합니다.</p></header>
      <section aria-labelledby="status-heading">
        <h2 id="status-heading">보호 상태 / Protection status</h2>
        <div className="status"><span aria-hidden="true">●</span><strong>게이트웨이 보호 중</strong><small>Gateway active</small></div>
        <div className="verdicts">{verdicts.map((item) => <div className={item.className} key={item.label}><b aria-hidden="true">{item.icon}</b>{item.label}</div>)}</div>
      </section>
      <section aria-labelledby="policy-heading">
        <h2 id="policy-heading">정책 / Policies</h2>
        <div className="empty-state">
          <h3>아직 정책이 없습니다 / No policies yet</h3>
          <p>정책 작성 가이드의 예제를 복사해 첫 정책을 만들고, validation과 benchmark로 안전하게 확인하세요.</p>
          <p>Copy an example from the Policy Authoring Guide to create your first policy, then verify it safely with validation and the benchmark.</p>
          <a href="https://github.com/2026-OSS-Contest/GuradMCP-KR/blob/main/docs/policy-guide/README.md">정책 작성 가이드 열기 / Open Policy Authoring Guide</a>
          <a href="https://github.com/2026-OSS-Contest/GuradMCP-KR/tree/main/policy-packs/default">기본 정책팩 예제 보기 / View default policy-pack examples</a>
          <small>코드를 작성하지 않아도 YAML 정책으로 기여할 수 있습니다. / You can contribute a YAML policy without writing application code.</small>
        </div>
      </section>
    </main>
  );
}
