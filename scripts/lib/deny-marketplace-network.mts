const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
  if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)) throw new Error("NETWORK_GUARD: pengujian wajib memasang mock sebelum mengakses layanan eksternal.");
  return originalFetch(input, init);
};
