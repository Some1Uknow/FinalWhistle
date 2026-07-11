import { handleApiError, health } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await health();
  } catch (error) {
    return handleApiError(error);
  }
}
