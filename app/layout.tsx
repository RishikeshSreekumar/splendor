import type { Metadata } from 'next';
import { Fraunces, JetBrains_Mono, Plus_Jakarta_Sans } from 'next/font/google';
import { Shell } from '@/components/shell';
import './globals.css';
import './table.css';
/** Display serif for headings, scores and card points; a clear sans for everything else. */
const display = Fraunces({ subsets: ['latin'], variable: '--font-display', display: 'swap' });
const sans = Plus_Jakarta_Sans({ subsets: ['latin'], variable: '--font-sans', display: 'swap' });
const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-mono', display: 'swap' });
export const metadata: Metadata = {
  title: 'Splendor Lab · Strategy, tested.',
  description:
    'A strategy laboratory for vanilla Splendor. Build a bot, study its decisions, and evaluate it with an independent chess clock.',
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${sans.variable} ${mono.variable}`}>
      <body>
        <Shell>{children}</Shell>
      </body>
    </html>
  );
}
