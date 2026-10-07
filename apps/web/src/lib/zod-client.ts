import { z } from "zod";

// Client-side zod would probe for eval with Function(""), which the nonce CSP reports as a
// violation in every browser. The JIT needs eval anyway, so turn it off. z.config is global, so
// this also disables the JIT for server-side parses in the same process (negligible cost).
z.config({ jitless: true });

export { z };
