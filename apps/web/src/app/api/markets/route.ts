import { createMarket, handleApiError, listMarkets } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await listMarkets(request);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: Request) {
  try {
    return await createMarket(request);
  } catch (error) {
    return handleApiError(error);
  }
}
