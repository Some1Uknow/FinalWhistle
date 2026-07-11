import { fixtures, handleApiError } from "@/server/api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    return await fixtures(request);
  } catch (error) {
    return handleApiError(error);
  }
}
