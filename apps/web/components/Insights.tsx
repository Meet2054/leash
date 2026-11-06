"use client";
// Placeholder: replaced by the Figma Insights screens (Savings / Post-quantum).
import { Stats } from "@/components/Stats";
import { PqLedger } from "@/components/PqLedger";
import { PageTitle } from "@/components/leash/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

export function Insights() {
  return (
    <div className="space-y-4">
      <PageTitle title="Insights" subtitle="What Leash saves you, counted from real payments." />
      <Tabs defaultValue="savings" className="space-y-3">
        <TabsList className="w-full">
          <TabsTrigger value="savings">Savings</TabsTrigger>
          <TabsTrigger value="pq">Post-quantum</TabsTrigger>
        </TabsList>
        <TabsContent value="savings"><Stats /></TabsContent>
        <TabsContent value="pq"><PqLedger /></TabsContent>
      </Tabs>
    </div>
  );
}
