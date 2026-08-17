import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });
const staticAssetPath = (name: string) => `${process.env.NEXT_PUBLIC_BASE_PATH?.replace(/\/$/, "") ?? ""}/${name}`;

export const metadata: Metadata = {
  title: "BeadCraftr | Fuse bead pattern maker",
  description: "Turn an image into a local, printable fuse bead pattern and materials list.",
  icons: { icon: staticAssetPath("favicon.svg"), shortcut: staticAssetPath("favicon.svg") },
  openGraph: {
    title: "BeadCraftr | Fuse bead pattern maker",
    description: "Make the picture. Count every bead.",
    images: [{ url: staticAssetPath("og.png"), width: 1728, height: 909, alt: "BeadCraftr fuse bead pattern maker" }],
  },
  twitter: { card: "summary_large_image", title: "BeadCraftr", description: "Make the picture. Count every bead.", images: [staticAssetPath("og.png")] },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body></html>;
}
