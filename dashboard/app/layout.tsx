import "./globals.css";
import type { Metadata } from "next";
import Sidebar from "@/components/Sidebar";

export const metadata: Metadata = { title: "Laptop Activity Monitor", description: "Local screen-time and system monitor" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <main className="flex-1 min-w-0 p-4 md:p-8 max-w-[1500px]">{children}</main>
        </div>
      </body>
    </html>
  );
}
