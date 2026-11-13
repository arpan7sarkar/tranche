import type { Metadata, Viewport } from "next";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tranche | Clear milestones. Confident payments.",
  description:
    "Turn client briefs into AI plans, verify milestone deliveries, and manage PayPal payments with human approval. Built for freelancers and small agencies.",
  applicationName: "Tranche",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "rgb(250, 249, 246)" },
    { media: "(prefers-color-scheme: dark)", color: "rgb(12, 16, 20)" },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full">
      <body className="min-h-full">
        {children}
        <Toaster position="bottom-right" />
      </body>
    </html>
  );
}
