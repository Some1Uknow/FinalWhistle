import { handleApiError, settleMarket } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, context: { params: Promise<{ marketId: string }> }) {
  try {
    return await settleMarket(request, await context.params);
  } catch (error) {
    return handleApiError(error);
  }
}
