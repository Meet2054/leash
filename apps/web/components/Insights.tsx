"use client";
import { Stats } from "@/components/Stats";
import { PqLedger } from "@/components/PqLedger";
import { PageTitle } from "@/components/leash/kit";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

/** Figma "Insights · Savings" / "Insights · Post-quantum": page title + segmented control. */
const seg =
  "h-[44px] rounded-full text-[14px] font-normal tracking-[-0.005em] text-addr data-active:text-[16px] data-active:font-semibold data-active:tracking-[-0.01em] data-active:text-ink data-active:shadow-[0_8px_28px_rgb(18_26_64/0.08)]";

export function Insights() {
  return (
    <div className="space-y-3.5">
      <PageTitle title="Insights" subtitle="What Leash saves you, counted from real payments." />
      <Tabs defaultValue="savings" className="gap-3.5">
        <TabsList className="w-full bg-surface p-1 group-data-horizontal/tabs:h-[52px]">
          <TabsTrigger value="savings" className={seg}>
            Savings
          </TabsTrigger>
          <TabsTrigger value="pq" className={seg}>
            Post-quantum
          </TabsTrigger>
        </TabsList>
        <TabsContent value="savings">
          <Stats />
        </TabsContent>
        <TabsContent value="pq">
          <PqLedger />
        </TabsContent>
      </Tabs>
    </div>
  );
}
