import type { Metadata } from 'next';
import { DesignProvider } from './context/DesignContext';
import './globals.css';

export const metadata: Metadata = {
  title: 'FurnishAR — Furnish before you move in',
  description: 'AI-generated furniture layouts in 3D with real IKEA products.',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-slate-900 font-sans text-white antialiased">
        <DesignProvider>{children}</DesignProvider>
      </body>
    </html>
  );
}
