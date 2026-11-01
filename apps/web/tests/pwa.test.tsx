import { readFile } from "node:fs/promises";
import path from "node:path";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import manifestRoute from "@/app/manifest";
import { InstallPrompt } from "@/components/pwa/InstallPrompt";
import { OfflineState } from "@/components/pwa/OfflineState";
import { RegisterServiceWorker } from "@/components/pwa/RegisterServiceWorker";

/*
 * PWA gates (spec §6.14): the manifest is complete and points at real files,
 * the worker caches the shell but never learner data, registration is
 * production-only, the offline state is honest, and install works on
 * Chromium and iOS flows alike.
 */

type InstallPromptEvent = Event & {
  prompt: ReturnType<typeof vi.fn>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

function setNavigatorProperty(name: string, value: unknown) {
  Object.defineProperty(window.navigator, name, {
    configurable: true,
    value,
  });
}

// Files are read from the repo, not via import.meta.url — under vitest that
// is not a file:// URL. Vitest runs with the app root as the cwd.
const publicFile = (...parts: string[]) =>
  path.resolve(process.cwd(), "public", ...parts);

function setMatchMedia(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockReturnValue({ matches } as MediaQueryList),
  });
}

beforeEach(() => {
  setMatchMedia(false);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("web app manifest", () => {
  it("is standalone with the brand palette", () => {
    const manifest = manifestRoute();

    expect(manifest.name).toBe("PRIMER by Unmute1AI");
    expect(manifest.short_name).toBe("PRIMER");
    expect(manifest.display).toBe("standalone");
    expect(manifest.id).toBe("/");
    expect(manifest.start_url).toBe("/");
    // #5b21b6 is --color-primary, #f9f8ff is --color-background.
    expect(manifest.theme_color).toBe("#5b21b6");
    expect(manifest.background_color).toBe("#f9f8ff");
  });

  it("declares regular and maskable icons at 192 and 512", () => {
    const icons = manifestRoute().icons ?? [];

    const sizes = icons.map((icon) => icon.sizes);
    expect(sizes).toContain("192x192");
    expect(sizes).toContain("512x512");
    expect(icons.filter((icon) => icon.purpose === "maskable")).toHaveLength(2);
  });

  it("every manifest icon resolves to a real file — no ghost assets", async () => {
    for (const icon of manifestRoute().icons ?? []) {
      await expect(
        readFile(publicFile(...icon.src.split("/").filter(Boolean))),
      ).resolves.toBeTruthy();
    }
  });
});

describe("service worker", () => {
  const sw = () => readFile(publicFile("sw.js"), "utf8");

  it("precaches the shell: offline state, manifest, icons", async () => {
    const source = await sw();
    for (const asset of [
      "/offline.html",
      "/manifest.webmanifest",
      "/icons/icon-192.png",
      "/icons/icon-512.png",
      "/icons/maskable-192.png",
      "/icons/maskable-512.png",
    ]) {
      expect(source).toContain(`"${asset}"`);
    }
  });

  it("never caches learner data: pages are fresh-or-offline-state, cross-origin untouched", async () => {
    const source = await sw();

    // Cross-origin (the API service) passes through: network-only.
    expect(source).toMatch(/url\.origin !== self\.location\.origin\)\s*return/);
    // Navigations: network-first, falling back to the explicit offline state.
    expect(source).toMatch(/request\.mode === "navigate"/);
    expect(source).toMatch(/fetch\(request\)\.catch/);
    expect(source).toMatch(/caches\s*\.\s*match\("\/offline\.html"\)/);
    // Exactly one cache.put call site — the shell-asset branch. A second
    // would mean page or data caching, i.e. fabricated offline content.
    expect(source.match(/cache\.put\(/g)).toHaveLength(1);
  });

  it("registers /sw.js in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty("serviceWorker", { register });

    render(<RegisterServiceWorker />);

    expect(register).toHaveBeenCalledWith("/sw.js");
  });

  it("stays out of the way in development and without worker support", () => {
    vi.stubEnv("NODE_ENV", "development");
    const register = vi.fn().mockResolvedValue(undefined);
    setNavigatorProperty("serviceWorker", { register });
    const { unmount } = render(<RegisterServiceWorker />);
    expect(register).not.toHaveBeenCalled();
    unmount();

    delete (window.navigator as { serviceWorker?: unknown }).serviceWorker;
    vi.stubEnv("NODE_ENV", "production");
    expect(() => render(<RegisterServiceWorker />)).not.toThrow();
  });

  it("surfaces registration failure instead of swallowing it", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const register = vi.fn().mockRejectedValue(new Error("quota exceeded"));
    setNavigatorProperty("serviceWorker", { register });
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    render(<RegisterServiceWorker />);

    await waitFor(() =>
      expect(consoleError).toHaveBeenCalledWith(
        "[pwa] service worker registration failed:",
        expect.any(Error),
      ),
    );
    consoleError.mockRestore();
  });
});

describe("offline state", () => {
  function goOnline(online: boolean) {
    setNavigatorProperty("onLine", online);
  }

  it("shows an honest banner offline, clears it back online", () => {
    goOnline(true);
    const { container } = render(<OfflineState />);
    expect(container).toBeEmptyDOMElement();

    act(() => {
      goOnline(false);
      window.dispatchEvent(new Event("offline"));
    });
    const banner = screen.getByRole("status");
    expect(banner.textContent).toMatch(/you're offline/i);
    // The honesty commitment, in the learner's face: no stale or invented
    // progress while disconnected.
    expect(banner.textContent).toMatch(/stale or made-up progress/i);

    act(() => {
      goOnline(true);
      window.dispatchEvent(new Event("online"));
    });
    expect(container).toBeEmptyDOMElement();
  });

  it("detects a page loaded while already offline", () => {
    goOnline(false);
    render(<OfflineState />);
    expect(screen.getByRole("status").textContent).toMatch(
      /internet connection/i,
    );
  });
});

describe("install prompt", () => {
  function fireBeforeInstallPrompt(outcome: "accepted" | "dismissed") {
    const prompt = vi.fn().mockResolvedValue(undefined);
    const event = new Event("beforeinstallprompt") as InstallPromptEvent;
    Object.assign(event, {
      prompt,
      userChoice: Promise.resolve({ outcome }),
    });
    act(() => {
      window.dispatchEvent(event);
    });
    return event;
  }

  it("stays hidden once the app runs standalone", () => {
    setMatchMedia(true); // display-mode: standalone
    render(<InstallPrompt />);
    fireBeforeInstallPrompt("accepted");
    expect(screen.queryByText("Install PRIMER")).not.toBeInTheDocument();
  });

  it("renders nothing until the browser offers installation", () => {
    const { container } = render(<InstallPrompt />);
    expect(container).toBeEmptyDOMElement();
  });

  it("offers one-tap install on Chromium and hides after acceptance", async () => {
    const user = userEvent.setup();
    render(<InstallPrompt />);

    const event = fireBeforeInstallPrompt("accepted");
    const button = screen.getByRole("button", { name: "Install PRIMER" });

    await user.click(button);
    expect(event.prompt).toHaveBeenCalledTimes(1);

    await waitFor(() =>
      expect(screen.queryByRole("button")).not.toBeInTheDocument(),
    );
  });

  it("guides iOS learners through Add to Home Screen instead", () => {
    setNavigatorProperty(
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15",
    );
    render(<InstallPrompt />);

    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Install PRIMER" }),
    ).toBeNull();
  });
});
