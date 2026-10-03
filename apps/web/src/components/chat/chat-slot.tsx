import { getChatSettings } from "@/lib/directus/queries";
import { serverEnv } from "@/lib/env";

import { ChatLauncher } from "./chat-launcher";

const MAX_SUGGESTIONS = 4;

// No launcher unless Chris switched chat on in Directus and Turnstile is configured.
export async function ChatSlot() {
  const settings = await getChatSettings();
  const { turnstileSiteKey, publicApiUrl } = serverEnv();
  if (!settings?.enabled || !turnstileSiteKey) return null;
  return (
    <ChatLauncher
      apiUrl={publicApiUrl}
      siteKey={turnstileSiteKey}
      suggestions={settings.suggested_questions.slice(0, MAX_SUGGESTIONS)}
    />
  );
}
