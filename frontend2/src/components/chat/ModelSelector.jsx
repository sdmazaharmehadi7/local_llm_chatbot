import { providersClient } from "@/lib/providersClient";
import { CACHE_DURATIONS } from "@/shared";
import { Menu, MenuButton, MenuItems, MenuItem } from "@headlessui/react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, Loader2 } from "lucide-react";
import ProviderLogo from "@/components/ui/ProviderLogo";
import { MOCK_MODELS } from "@/lib/api";

const VARIANTS = {
  text: {
    queryKey: ["models", "text"],
    buttonClass:
      "bg-theme-surface hover:bg-theme-surface-strong border-theme-border hover:border-theme-primary/50",
    activeItemClass: "bg-theme-surface-strong",
    badgeClass: "bg-theme-blue/20 text-theme-blue",
    emptyWrapClass: "",
    emptyTextClass: "",
  },
  image: {
    queryKey: ["models", "image"],
    buttonClass: "bg-theme-pink/10 border-theme-pink/30 hover:border-theme-pink",
    activeItemClass: "bg-theme-pink/20",
    badgeClass: "bg-theme-pink/20 text-theme-pink",
    emptyWrapClass: "bg-theme-pink/10 border-theme-pink/30",
    emptyTextClass: "text-theme-pink",
  },
};

const ModelSelector = ({
  type = "text",
  currentModel,
  onModelChange,
  isSwitching = false,
  switchingModelId = null,
}) => {
  const variant = VARIANTS[type];

  const { data, isLoading } = useQuery({
    queryKey: variant.queryKey,
    queryFn: () => providersClient.getEnabledModelsByType(type),
    staleTime: CACHE_DURATIONS.IMAGE_MODELS,
  });

  const models =
    data?.models && data.models.length > 0
      ? data.models
      : type === "image"
        ? []
        : MOCK_MODELS;

  const currentModelData =
    models.find((m) => m.model_id === currentModel || m.id === currentModel) ||
    models.find((m) => m.is_default) ||
    models[0];
  const currentProviderId =
    currentModelData?.provider_name || currentModelData?.provider?.toLowerCase();

  if (isLoading && models.length === 0) {
    return (
      <div className="bg-theme-surface rounded-xl px-3 py-2 text-sm">
        <span className="text-theme-text-muted">Loading models...</span>
      </div>
    );
  }

  if (type === "image" && (models.length === 0 || !currentModelData)) {
    return (
      <div className={`${variant.emptyWrapClass} rounded-xl border px-3 py-2 text-sm`}>
        <span className={variant.emptyTextClass}>
          No image models - add Replicate or OpenRouter
        </span>
      </div>
    );
  }

  if (!currentModelData) {
    return (
      <div className="bg-theme-surface rounded-xl px-3 py-2 text-sm">
        <span className="text-theme-text-muted">Loading...</span>
      </div>
    );
  }

  return (
    <Menu as="div" className="relative">
      <MenuButton
        disabled={isSwitching}
        className={`${variant.buttonClass} text-theme-text flex items-center gap-2 rounded-xl border px-3 py-2 text-sm font-semibold shadow-lg transition-all duration-200 ${
          isSwitching
            ? "cursor-wait opacity-90 border-theme-primary/40 bg-theme-surface-strong"
            : "hover:scale-105 active:scale-95 cursor-pointer"
        }`}>
        <span className="flex items-center gap-2">
          <ProviderLogo
            providerId={currentProviderId}
            displayName={currentModelData.provider_display_name}
            size="sm"
          />
          <span>{currentModelData.display_name}</span>

          {/* Model switching spinner state */}
          {isSwitching && (
            <span className="bg-theme-primary/10 text-theme-primary border border-theme-primary/20 flex items-center gap-1.5 rounded-lg px-2 py-0.5 text-xs font-medium animate-pulse">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Switching model...</span>
            </span>
          )}
        </span>
        <ChevronDown className="ui-open:rotate-180 h-4 w-4 transition-transform duration-200 opacity-70" />
      </MenuButton>

      <MenuItems className="bg-theme-surface border-theme-surface-strong animate-in fade-in zoom-in-95 absolute top-full left-0 z-50 mt-2 w-72 overflow-hidden rounded-xl border shadow-lg duration-100">
        <div className="max-h-96 overflow-y-auto p-1">
          {models.map((model) => {
            const providerId = model.provider_name || model.provider?.toLowerCase();
            const modelKey = model.model_id || model.id;
            const isActive = currentModel === modelKey;
            const isThisSwitching = isSwitching && switchingModelId === modelKey;

            return (
              <MenuItem
                key={model.id}
                as="button"
                disabled={isSwitching}
                onClick={() => onModelChange(modelKey)}
                className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm transition-colors ${
                  isActive
                    ? variant.activeItemClass
                    : "hover:bg-theme-surface-strong/50 data-[focus]:bg-theme-surface-strong/50"
                } ${isSwitching ? "cursor-wait opacity-70" : ""}`}>
                <div className="flex-1">
                  <div className="text-theme-text font-medium flex items-center gap-2">
                    <span>{model.display_name}</span>
                    {isThisSwitching && (
                      <Loader2 className="h-3 w-3 animate-spin text-theme-primary" />
                    )}
                  </div>
                  <div className="text-theme-text-muted flex items-center gap-1.5 text-xs">
                    <ProviderLogo
                      providerId={providerId}
                      displayName={model.provider_display_name}
                      size="xs"
                    />
                    <span>{model.description || model.provider_display_name}</span>
                  </div>
                </div>
                {model.is_default && (
                  <span
                    className={`${variant.badgeClass} rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase`}>
                    Default
                  </span>
                )}
              </MenuItem>
            );
          })}
        </div>
      </MenuItems>
    </Menu>
  );
};

export default ModelSelector;
