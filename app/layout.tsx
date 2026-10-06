import type { Metadata } from 'next';
import { Shell } from '@/components/shell';
import './globals.css';
import './table.css';
export const metadata: Metadata = {
  title: 'Splendor Lab · Strategy, tested.',
  description:
    'A strategy laboratory for vanilla Splendor. Build a bot, study its decisions, and evaluate it with an independent chess clock.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
