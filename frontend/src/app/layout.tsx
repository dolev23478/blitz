import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Kafka Stream Analytics & Keyword Filter Monitor',
  description: 'Real-time telemetry and channel analytics for Kafka stream ingestion and keyword filter evaluation.',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased selection:bg-emerald-500/30 selection:text-emerald-200">
        {children}
      </body>
    </html>
  );
}
