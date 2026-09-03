import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DEFAULT_APP_SETTINGS, normalizeAppSettings } from "@/shared";
import { apiFetch } from "@/lib/api";

const settingsKeys = {
  all: ["appSettings"],
};

async function fetchSettings() {
  try {
    const data = await apiFetch("/api/settings");
    return normalizeAppSettings(data);
  } catch {
    return normalizeAppSettings(DEFAULT_APP_SETTINGS);
  }
}

async function updateSettings(updates) {
  const data = await apiFetch("/api/settings", {
    method: "PUT",
    body: JSON.stringify(updates),
  });
  return normalizeAppSettings(data);
}

export function useAppSettingsQuery() {
  return useQuery({
    queryKey: settingsKeys.all,
    queryFn: fetchSettings,
    staleTime: Infinity,
    placeholderData: DEFAULT_APP_SETTINGS,
  });
}

export function useUpdateAppSettingsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: updateSettings,
    onSuccess: (data) => {
      queryClient.setQueryData(settingsKeys.all, data);
    },
  });
}
