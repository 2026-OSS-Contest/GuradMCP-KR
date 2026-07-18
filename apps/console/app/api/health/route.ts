export async function GET(): Promise<Response> {
  const dependencies = [process.env.GATEWAY_URL, process.env.CONTROL_PLANE_URL]
    .filter((value): value is string => Boolean(value));
  const checks = await Promise.all(dependencies.map(async (baseUrl) => {
    const path = baseUrl.includes("control-plane") || baseUrl.endsWith(":8080") ? "/actuator/health" : "/health";
    try {
      const response = await fetch(`${baseUrl}${path}`, { cache: "no-store", signal: AbortSignal.timeout(1_500) });
      return { url: baseUrl, up: response.ok };
    } catch {
      return { url: baseUrl, up: false };
    }
  }));
  const up = checks.every(({ up: dependencyUp }) => dependencyUp);
  return Response.json({ status: up ? "UP" : "DOWN", service: "console", dependencies: checks }, { status: up ? 200 : 503 });
}
