// Served in place of challenges.cloudflare.com/turnstile/v0/api.js: issues a token at once.
window.turnstile = {
  render(el, o) {
    setTimeout(() => o.callback("e2e-token"), 0);
    return "w1";
  },
  reset() {},
  remove() {},
};
