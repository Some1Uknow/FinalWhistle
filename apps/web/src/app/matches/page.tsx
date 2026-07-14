import { MatchDirectory } from "@/components/home-match-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function MatchesPage() {
  return (
    <main className="page directory-page">
      <MatchDirectory />
    </main>
  );
}
