export function GET(): Response {
  return Response.json({ status: "UP", service: "console" });
}
