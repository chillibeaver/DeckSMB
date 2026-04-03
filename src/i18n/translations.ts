import enUS from "./locales/en-US.json";
import zhCN from "./locales/zh-CN.json";

type TranslationData = typeof enUS;

const resources: Record<string, TranslationData> = {
  "en-US": enUS,
  "zh-CN": zhCN,
};

let currentLanguage = "en-US";

export function loadTranslations(): void {
  try {
    const steamLang = navigator.language || "en-US";
    if (steamLang.startsWith("zh")) {
      currentLanguage = "zh-CN";
    } else {
      currentLanguage = "en-US";
    }
  } catch {
    currentLanguage = "en-US";
  }
}


export function t(key: string, params?: Record<string, string>): string {
  const keys = key.split(".");
  let value: unknown = resources[currentLanguage];

  for (const k of keys) {
    if (value && typeof value === "object") {
      value = (value as Record<string, unknown>)[k];
    } else {
      value = undefined;
      break;
    }
  }

  // Fallback to en
  if (typeof value !== "string") {
    value = resources["en-US"];
    for (const k of keys) {
      if (value && typeof value === "object") {
        value = (value as Record<string, unknown>)[k];
      } else {
        value = undefined;
        break;
      }
    }
  }

  if (typeof value !== "string") {
    return key;
  }

  let result = value;
  if (params) {
    for (const [pKey, pVal] of Object.entries(params)) {
      result = result.replace(new RegExp(`\\{\\{${pKey}\\}\\}`, "g"), pVal);
    }
  }
  return result;
}
