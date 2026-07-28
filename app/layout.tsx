import type { Metadata } from "next";
import "./globals.css";

const title = "カラーレシピ｜絵の具を混ぜて、描いて、彩る";
const description =
  "赤・青・黄・白・水を実際の絵の具のように混ぜ、配合を保存して、おえかきやぬりえに使える創作アプリです。";

function resolveMetadataBase() {
  const configured = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (configured) {
    try {
      const url = new URL(configured);
      if (
        (url.protocol === "http:" || url.protocol === "https:") &&
        !url.username &&
        !url.password
      ) {
        return url;
      }
    } catch {
      // A malformed public URL must not make the application fail to render.
    }
  }
  return new URL("http://localhost:3000");
}

export const metadata: Metadata = {
  metadataBase: resolveMetadataBase(),
  title,
  description,
  openGraph: {
    title,
    description,
    type: "website",
    locale: "ja_JP",
    images: [
      {
        url: "/og.png",
        width: 1730,
        height: 909,
        alt: "絵の具を混ぜて、描いて、彩る「カラーレシピ」",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title,
    description,
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
