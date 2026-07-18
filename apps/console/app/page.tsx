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
          <p>아직 사용자 정책이 없습니다. 첫 정책을 작성해 보호 범위를 확장하세요.</p>
          <p>No custom policies yet. Create your first policy to expand protection.</p>
          <a href="https://github.com/2026-OSS-Contest/GuradMCP-KR/blob/main/docs/policy-guide/README.md">정책 작성 가이드 / Policy authoring guide</a>
        </div>
      </section>
    </main>
  );
}
