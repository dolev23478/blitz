import './globals.css';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Blitz Front Page',
  description: 'Live filtered posts stream',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
