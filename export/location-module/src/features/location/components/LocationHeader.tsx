import { Loader2, MapPin, RefreshCw } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { LOCATION_PAGE_PATH } from "../config";
import { headerCopy, type LocationLocale } from "../strings";
import type { CurrentLocation } from "../hooks/useCurrentLocation";
import { useTranslatedAddressLine } from "../hooks/useTranslatedAddressLine";
import { AutoFitMarquee } from "./AutoFitMarquee";

type LocationHeaderProps = {
  location: CurrentLocation;
  /** 위치 선택 후 돌아올 경로. config.ts의 RETURN_TO_PATHS에 등록되어 있어야 한다. */
  returnTo: string;
  locale?: LocationLocale;
  /** 모바일 키보드가 화면을 밀어 올린 만큼 헤더를 내린다 (useKeyboardTopInset 값) */
  topOffset?: number;
  className?: string;
};

const OUTLINE_BUTTON_CLASS =
  "h-12 rounded-xl border border-primary bg-card text-foreground transition-colors hover:bg-card hover:text-foreground";

export function LocationHeader({
  location,
  returnTo,
  locale = "ko",
  topOffset = 0,
  className,
}: LocationHeaderProps) {
  const navigate = useNavigate();
  const copy = headerCopy(locale);
  const addressLine = useTranslatedAddressLine(location.address ?? "", locale);
  const isLoading = location.status === "loading";

  const headerText = isLoading
    ? copy.checking
    : location.status === "failed" || !location.address
      ? copy.fetchFailed
      : `${location.isManual ? copy.manualLabel : copy.currentLabel}: ${addressLine}`;

  return (
    <header
      className={cn(
        "sticky top-0 z-40 bg-card border-b border-border/50 backdrop-blur-sm bg-opacity-95",
        className,
      )}
      style={topOffset > 0 ? { transform: `translateY(${topOffset}px)` } : undefined}
    >
      <div className="max-w-md mx-auto px-4 py-3">
        <div className="flex items-center gap-2 w-full">
          <Button
            variant="outline"
            className={cn("group min-w-0 flex-1 justify-start overflow-hidden", OUTLINE_BUTTON_CLASS)}
            disabled={isLoading}
            onClick={() => navigate(LOCATION_PAGE_PATH, { state: { returnTo } })}
          >
            <div className="flex w-full min-w-0 items-center overflow-hidden">
              {isLoading ? (
                <Loader2 className="w-5 h-5 mr-2 shrink-0 text-primary animate-spin" />
              ) : (
                <MapPin className="w-5 h-5 mr-2 shrink-0 text-primary group-hover:text-white transition-colors" />
              )}
              <AutoFitMarquee
                text={headerText}
                className="flex-1"
                textClassName="text-left font-medium !leading-6"
                fontSizeClasses={["text-sm", "text-xs"]}
              />
            </div>
          </Button>
          <Button
            variant="outline"
            size="icon"
            className={cn("w-12", OUTLINE_BUTTON_CLASS)}
            disabled={isLoading}
            onClick={location.refresh}
            aria-label={copy.refreshAria}
          >
            <RefreshCw className={cn("w-4 h-4", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>
    </header>
  );
}
