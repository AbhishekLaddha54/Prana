export const dynamic = "force-dynamic";

// Intentionally database-free: the demo keeps all state in memory, so this
// stays up on Vercel (serverless, no DB) as well as in local sandboxes.
export async function GET() {
  return Response.json({ ok: true });
}
