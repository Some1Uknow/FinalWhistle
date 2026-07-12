import { claimPayout, handleApiError } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request, { params }: { params: Promise<{ marketId: string }> }) {
  try {
    return await claimPayout(request, await params);
  } catch (error) {
    return handleApiError(error);
  }
}
