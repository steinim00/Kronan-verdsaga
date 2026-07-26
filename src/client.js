// Thin wrapper around the Kronan Public API.
// Docs: https://api.kronan.is/api/v1/schema/swagger-ui/

const BASE_URL = "https://api.kronan.is/api/v1";

// Rate limit is 200 requests / 200 seconds per user (~1 req/sec).
// We wait a bit longer than that between calls to stay safely under it.
const MIN_DELAY_MS = 600;

let lastRequestAt = 0;

async function throttle() {
  const wait = lastRequestAt + MIN_DELAY_MS - Date.now();
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastRequestAt = Date.now();
}

export function makeClient(accessToken) {
  if (!accessToken) {
    throw new Error(
      "Vantar KRONAN_ACCESS_TOKEN. Sjá README.md fyrir hvernig á að búa hann til."
    );
  }

  async function request(path, { method = "GET", body } = {}) {
    await throttle();
    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers: {
        Authorization: `AccessToken ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: body ? JSON.stringify(body) : undefined,
    });

    if (res.status === 429) {
      // Back off and retry once if we somehow hit the rate limit.
      await new Promise((r) => setTimeout(r, 5000));
      return request(path, { method, body });
    }

    if (!res.ok) {
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
