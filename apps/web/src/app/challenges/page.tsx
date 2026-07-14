import { ChallengeDirectory } from "@/components/home-match-board";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function ChallengesPage() {
  return (
    <main className="page directory-page">
      <ChallengeDirectory />
    </main>
  );
}
