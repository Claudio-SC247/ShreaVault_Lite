import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ShareVault Lite",
  description: "MVP para compartir archivos con enlaces privados temporales."
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}

