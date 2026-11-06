import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import { cn } from "@/lib/utils";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "Leash — owner",
  description: "Spending limits for AI agents that pay: post-quantum keys, World ID approvals, USDT on Whitechain.",
  manifest: "/manifest.webmanifest",
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#0a0a0a" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark", sans.variable, mono.variable)}>
      <body className="min-h-dvh font-sans antialiased">
        {children}
        <Toaster position="top-center" theme="dark" richColors={false} />
      </body>
    </html>
  );
}
