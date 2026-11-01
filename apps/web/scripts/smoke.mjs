/*
 * Render smoke test: the three scaffold routes must serve HTTP 200 and carry
 * their expected marker text. Run against a started server:
 *
 *   pnpm start &            # or: next start
 *   BASE_URL=http://localhost:3000 pnpm smoke
 */
const base = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");

const routes = [
  { path: "/", marker: "Learn the child" },
  { path: "/login", marker: "Welcome back" },
  { path: "/register", marker: "Create your account" },
];

let failed = false;
for (const { path, marker } of routes) {
  try {
    const res = await fetch(`${base}${path}`);
    const body = await res.text();
    const ok = res.ok && body.includes(marker);
    console.log(
      `${ok ? "PASS" : "FAIL"} ${path} -> ${res.status}${ok ? "" : ` (missing "${marker}")`}`,
    );
    if (!ok) failed = true;
  } catch (err) {
    console.log(`FAIL ${path} -> unreachable: ${err?.message ?? err}`);
    failed = true;
  }
}

process.exit(failed ? 1 : 0);
