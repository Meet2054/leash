"use client";
import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { api } from "@/lib/client/api";

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
    <main className="mx-auto max-w-sm p-6 space-y-4">
      <div className="card space-y-3 text-center">
        <div className="pill mx-auto" style={{ color: "var(--color-warn)" }}>MOCKED World ID — offline demo issuer</div>
        <h1 className="text-lg font-bold">Verify you&apos;re human</h1>
        <p className="text-sm muted">Stand-in for the World App approval screen. Approving mints a signed ID token (fresh auth_time, proof of personhood) that the Leash backend validates like a real World token. Fake identity: do not rely on it in production.</p>
        {!done ? (
          <div className="flex gap-2 justify-center">
            <button className="btn btn-primary" onClick={() => decide("approve")}>Approve</button>
            <button className="btn btn-danger" onClick={() => decide("deny")}>Deny connection</button>
          </div>
        ) : (
          <div className="font-semibold">{done === "APPROVED" ? "✓ Verified. Return to Leash." : done === "DENIED" ? "✕ Cancelled. Nothing will be signed." : done}</div>
        )}
        <div className="mono muted">attempt {id}</div>
      </div>
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
