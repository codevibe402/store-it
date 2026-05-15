import type { Metadata } from "next";
import "./globals.css";
import { Geist } from "next/font/google";
import { cn } from "@/lib/utils";
import SessionProviderWrapper from '@/app/sessionprovidewrapper/page';

import Providers from "@/components/ui/providers";

import { Toaster } from "sonner";


const geist = Geist({subsets:['latin'],variable:'--font-sans'});

export const metadata: Metadata = {
  title: "Your App Name",
  description: "Your description",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("font-sans", geist.variable)}>
      <body> <SessionProviderWrapper>
  <Providers>
    {children}
     <Toaster richColors position="top-right" />
  </Providers>
</SessionProviderWrapper>
      </body>
    </html>
  );
}
