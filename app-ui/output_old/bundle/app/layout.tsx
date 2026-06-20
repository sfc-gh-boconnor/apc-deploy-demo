import type { Metadata } from "next"
import "./globals.css"

export const metadata: Metadata = {
  title: "AI Product Costing",
  description: "Real-time product cost variance analysis powered by SAP BDC Connect + Snowflake Cortex AI",
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
