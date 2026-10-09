export interface ChatConfig {
  model: string;
  apiKey: string;
  systemPrompt: string;
  parameters: string;
}
export const configKey = "wanaku-debugger-chat-settings";
export const rememberKey = "wanaku-debugger-chat-remember";
export const rememberApiKey = "wanaku-debugger-chat-remember-api-key";
export const defaults: ChatConfig = {
  model: "",
  apiKey: "",
  systemPrompt: "You are helpful assistant that can use tools.",
  parameters: "",
};
export function loadConfig(storage: Storage): ChatConfig {
  try {
    if (storage.getItem(rememberKey) !== "true") return { ...defaults };
    const saved: unknown = JSON.parse(storage.getItem(configKey) ?? "{}");
    const config = { ...defaults };
    if (saved && typeof saved === "object")
      for (const key of Object.keys(config) as (keyof ChatConfig)[]) {
        if (
          key in saved &&
          typeof (saved as Record<string, unknown>)[key] === "string"
        )
          config[key] = (saved as Record<string, string>)[key];
      }
    if (storage.getItem(rememberApiKey) !== "true") config.apiKey = "";
    return config;
  } catch {
    return { ...defaults };
  }
}
export function persistConfig(storage: Storage, config: ChatConfig) {
  if (storage.getItem(rememberKey) !== "true") {
    storage.removeItem(configKey);
    return;
  }
  storage.setItem(
    configKey,
    JSON.stringify({
      ...config,
      apiKey:
        storage.getItem(rememberApiKey) === "true" ? config.apiKey : undefined,
    }),
  );
}
