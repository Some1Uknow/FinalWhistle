import { fixtureMarkets, handleApiError } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ fixtureId: string }> }) {
  try {
    return await fixtureMarkets(request, await context.params);
  } catch (error) {
    return handleApiError(error);
  }
}
