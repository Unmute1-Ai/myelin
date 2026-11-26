import type { Metadata } from "next";
import { SignRecognitionDemo } from "@/components/sign/sign-recognition-demo";

export const metadata: Metadata = {
  title: "Live sign recognition demo",
  description:
    "In-browser ASL fingerspelling demo: webcam hand tracking, a placeholder classifier, and honest session metrics. Nothing leaves your device.",
};

export default function SignRecognitionDemoPage() {
  return <SignRecognitionDemo />;
}
