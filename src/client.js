// Thin wrapper around the Kronan Public API.
// Docs: https://api.kronan.is/api/v1/schema/swagger-ui/

const BASE_URL = "https://api.kronan.is/api/v1";

// Rate limit is 200 requests / 200 seconds per user = 1 req/sec average.
// 600ms was actually TOO fast (that's ~1.67 req/sec, over the limit) —
// 1100ms keeps us safely under it even accounting for jitter.
const MIN_DELAY_MS = 1100;
const MAX_RETRIES = 5;

let lastRequestAt = 0;

async function throttle() {
  const wait = lastRequestAt + MIN_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

function backoffMs(attempt) {
  // 2s, 4s, 8s, 16s, 32s
  return 2000 * 2 ** attempt;
}

export function makeClient(accessToken) {
  if (!accessToken) {
    throw new Error(
      "Vantar KRONAN_ACCESS_TOKEN. Sjá README.md fyrir hvernig á að búa hann til."
    );
  }

  async function request(path, { method = "GET", body } = {}, attempt = 0) {
    await throttle();

    let res;
    try {
      res = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `AccessToken ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: body ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      // Transient network hiccup (DNS, reset, timeout) — retry with backoff
      // instead of losing everything collected so far.
      if (attempt >= MAX_RETRIES) throw networkErr;
      console.log(`  net villa á ${path} (tilraun ${attempt + 1}), reyni aftur...`);
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      return request(path, { method, body }, attempt + 1);
    }

    if (res.status === 429 || res.status >= 500) {
      if (attempt >= MAX_RETRIES) {
        const text = await res.text().catch(() => "");
        throw new Error(`${method} ${path} -> ${res.status} eftir ${MAX_RETRIES} tilraunir: ${text}`);
      }
      console.log(`  ${res.status} á ${path} (tilraun ${attempt + 1}), bíð og reyni aftur...`);
      await new Promise((r) => setTimeout(r, backoffMs(attempt)));
      return request(path, { method, body }, attempt + 1);
    }

    if (!res.ok) {
      // Non-retryable client error (401/403/404/etc) — fail loudly with the
      // actual response body so it's obvious what went wrong.
      const text = await res.text().catch(() => "");
      throw new Error(`${method} ${path} -> ${res.status}: ${text}`);
    }

    return res.json();
  }

  return {
    getCategories: () => request("/categories/"),
    getCategoryProducts: (slug, page = 1) =>
      request(`/categories/${encodeURIComponent(slug)}/products/?page=${page}`),
    // Max 100 SKUs per call (enforced by the API).
    batchLookup: (skus) => request("/products/batch/", { method: "POST", body: { skus } }),
  };
}
