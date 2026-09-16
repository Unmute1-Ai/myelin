import type { ReactNode } from "react";
import "./styles.css";

export const metadata = { title: "U1 NeuroSignal", description: "Longitudinal clinician review prototype" };

export default function RootLayout({ children }: { children: ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
