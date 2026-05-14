// Cache Calc — Cloudflare Worker
// All calculations run client-side; the worker only serves static assets.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
