import { getMarketById, handleApiError } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ marketId: string }> }) {
  try {
    return await getMarketById(request, await context.params);
  } catch (error) {
    return handleApiError(error);
  }
}
