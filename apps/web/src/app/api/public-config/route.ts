import { handleApiError, publicConfig } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return await publicConfig();
  } catch (error) {
    return handleApiError(error);
  }
}
