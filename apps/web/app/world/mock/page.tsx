"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { Pill, Section } from "@/components/leash/kit";

function MockWorld() {
  const id = useSearchParams().get("attempt") ?? "";
  const [done, setDone] = useState<string>();
  const decide = async (decision: "approve" | "deny") => {
    try {
      const r = await api<{ status: string }>(`/api/world/mock/${id}`, { decision });
      setDone(r.status);
    } catch (e) {
      setDone(e instanceof Error ? e.message : String(e));
    }
  };
  return (
    <main className="mx-auto max-w-sm space-y-4 px-4 py-10">
      <Section title="Verify you're human" description="Stand-in for the World ID app (offline demo). Approving mints a signed ID token that Leash validates like a real World token. Fake identity.">
        <Pill tone="warn">MOCKED World ID</Pill>
        {!done ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" size="lg" onClick={() => decide("deny")}>
              Deny
            </Button>
            <Button size="lg" onClick={() => decide("approve")}>
              Approve
            </Button>
          </div>
        ) : (
          <div className="text-[0.9rem] font-medium">{done === "APPROVED" ? "✓ Verified. Return to Leash." : done === "DENIED" ? "✕ Cancelled. Nothing will be signed." : done}</div>
        )}
        <div className="font-mono text-[0.7rem] text-muted-foreground">attempt {id}</div>
      </Section>
    </main>
  );
}

export default function Page() {
  return (
    <Suspense>
      <MockWorld />
    </Suspense>
  );
}
