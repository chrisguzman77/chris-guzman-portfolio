// Kept apart from lib/contact so client code can check an address without pulling in zod.
export const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
