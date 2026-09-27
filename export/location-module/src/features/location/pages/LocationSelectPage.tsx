import { useEffect, useState } from "react";
import type { KeyboardEvent } from "react";
import { ArrowLeft, Loader2, MapPin, Search, X } from "lucide-react";
import { Link, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { DEFAULT_RETURN_TO, RETURN_TO_PATHS } from "../config";
import { LOCATION_SYSTEM_TEXT, type LocationLocale } from "../strings";
import { AutoFitMarquee } from "../components/AutoFitMarquee";
import { useKeyboardTopInset } from "../hooks/useKeyboardTopInset";
import { searchAddress, type AddressSearchResult } from "../lib/addressSearch";
import { getAddressFromCoords } from "../lib/geocoding";
import { describeGeolocationError, getBrowserPosition, type GeoCoords } from "../lib/geolocation";
import {
  readRecentLocations,
  recentLocationCoords,
  saveAutoLocation,
  saveManualLocation,
  saveRecentLocation,
  type RecentLocation,
} from "../lib/locationStorage";

const MIN_QUERY_LENGTH = 2;
const SEARCH_DEBOUNCE_MS = 500;

function resolveReturnTo(stateReturnTo: unknown, queryReturnTo: string | null): string {
  if (typeof stateReturnTo === "string" && RETURN_TO_PATHS.has(stateReturnTo)) {
    return stateReturnTo;
  }
  if (queryReturnTo && RETURN_TO_PATHS.has(queryReturnTo)) {
    return queryReturnTo;
  }
  return DEFAULT_RETURN_TO;
}

/** Card 클릭 영역을 키보드(Enter/Space)로도 활성화할 수 있게 한다 */
const activateOnKey = (handler: () => void) => (event: KeyboardEvent<HTMLDivElement>) => {
  if (event.key !== "Enter" && event.key !== " ") return;
  event.preventDefault();
  handler();
};

type LocationCardProps = {
  title: string;
  subtitle?: string;
  caption?: string;
  onSelect: () => void;
};

function LocationCard({ title, subtitle, caption, onSelect }: LocationCardProps) {
  return (
    <Card
      className="p-4 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={activateOnKey(onSelect)}
    >
      <div className="flex items-center">
        <MapPin className="w-4 h-4 mr-3 text-muted-foreground flex-shrink-0" />
        <div className="flex-1 min-w-0">
          <AutoFitMarquee text={title} textClassName="font-medium" />
        </div>
      </div>
      {(subtitle || caption) && (
        <div className="pl-7">
          {subtitle && (
            <AutoFitMarquee
              as="p"
              text={subtitle}
              textClassName="text-muted-foreground"
              fontSizeClasses={["text-sm", "text-xs"]}
            />
          )}
          {caption && (
            <AutoFitMarquee
              as="p"
              text={caption}
              className="mt-1"
              textClassName="text-muted-foreground"
              fontSizeClasses={["text-xs"]}
            />
          )}
        </div>
      )}
    </Card>
  );
}

type LocationSelectPageProps = {
  /** 주소 검색·역지오코딩 언어 (화면 문구는 원본과 같이 한국어) */
  locale?: LocationLocale;
};

export default function LocationSelectPage({ locale = "ko" }: LocationSelectPageProps) {
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const returnTo = resolveReturnTo(
    (location.state as { returnTo?: unknown } | null)?.returnTo,
    searchParams.get("returnTo"),
  );
  const { toast } = useToast();

  const [searchQuery, setSearchQuery] = useState("");
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<AddressSearchResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isLocating, setIsLocating] = useState(false);
  const [recentLocations, setRecentLocations] = useState<RecentLocation[]>(readRecentLocations);
  const headerTopInset = useKeyboardTopInset(searchFocused);

  const isSearchMode = searchQuery.trim().length >= MIN_QUERY_LENGTH;

  useEffect(() => {
    if (!isSearchMode) {
      setSearchResults([]);
      return;
    }

    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      setIsSearching(true);
      try {
        const results = await searchAddress(searchQuery, locale);
        if (!cancelled) setSearchResults(results);
      } catch (error) {
        if (cancelled) return;
        toast({
          title: "검색 실패",
          description: error instanceof Error ? error.message : "주소 검색 중 오류가 발생했습니다.",
          variant: "destructive",
        });
      } finally {
        if (!cancelled) setIsSearching(false);
      }
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [searchQuery, isSearchMode, locale, toast]);

  /** 직접 고른 위치로 저장 → 이후 진입 시 GPS로 덮어쓰지 않는다 */
  const selectLocation = (name: string, address: string, coords: GeoCoords | null) => {
    saveManualLocation(name, coords);
    if (address) {
      setRecentLocations(saveRecentLocation({ name, address, ...coords }));
    }
    navigate(returnTo);
  };

  const handleSearchResultSelect = (result: AddressSearchResult) => {
    selectLocation(
      result.placeName || result.address,
      result.roadAddress || result.address,
      { latitude: result.latitude, longitude: result.longitude },
    );
  };

  const handleCurrentLocation = async () => {
    setIsLocating(true);
    try {
      const coords = await getBrowserPosition();
      const address =
        (await getAddressFromCoords(coords.latitude, coords.longitude, locale)) ??
        LOCATION_SYSTEM_TEXT.currentLocationName;
      saveAutoLocation(address, coords);
      navigate(returnTo);
    } catch (error) {
      toast({
        title: "위치 가져오기 실패",
        description: describeGeolocationError(error),
        variant: "destructive",
      });
    } finally {
      setIsLocating(false);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <header
        className="sticky top-0 z-40 bg-card border-b border-border"
        style={headerTopInset > 0 ? { transform: `translateY(${headerTopInset}px)` } : undefined}
      >
        <div className="max-w-md mx-auto px-4 py-4 flex items-center gap-4">
          <Button variant="ghost" size="icon" className="rounded-full" asChild>
            <Link to={returnTo} aria-label="뒤로 가기">
              <ArrowLeft className="w-5 h-5" />
            </Link>
          </Button>
          <h1 className="text-xl font-bold flex-1">위치 설정</h1>
        </div>
      </header>

      <main className="max-w-md mx-auto px-4 py-6">
        <div className="mb-6 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground" />
          <Input
            placeholder="주소 검색"
            inputMode="search"
            enterKeyHint="search"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            onFocus={() => setSearchFocused(true)}
            onBlur={() => setSearchFocused(false)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) event.currentTarget.blur();
            }}
            className={cn("pl-10 h-12 rounded-xl", searchQuery && "pr-10")}
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-muted-foreground hover:text-foreground transition-colors"
              aria-label="검색어 지우기"
            >
              <X className="w-5 h-5" />
            </button>
          )}
        </div>

        <div className="mb-6">
          <Button
            variant="outline"
            className="w-full justify-start h-14 rounded-xl border-primary/50 hover:bg-background hover:text-foreground"
            onClick={handleCurrentLocation}
            disabled={isLocating}
          >
            {isLocating ? (
              <Loader2 className="w-5 h-5 mr-3 text-primary animate-spin" />
            ) : (
              <MapPin className="w-5 h-5 mr-3 text-primary" />
            )}
            <span className="font-medium">
              {isLocating ? "위치 가져오는 중..." : "현재 위치로 설정"}
            </span>
          </Button>
        </div>

        {isSearchMode && (
          <section className="mb-6">
            <h2 className="text-lg font-bold mb-4">
              검색 결과
              {isSearching && <Loader2 className="w-4 h-4 ml-2 inline animate-spin" />}
            </h2>
            {!isSearching && (
              <div className="space-y-2">
                {searchResults.length > 0 ? (
                  searchResults.map((result, index) => (
                    <LocationCard
                      key={`${result.placeName}-${index}`}
                      title={result.placeName}
                      subtitle={result.roadAddress || result.address}
                      caption={result.category}
                      onSelect={() => handleSearchResultSelect(result)}
                    />
                  ))
                ) : (
                  <p className="text-sm text-muted-foreground text-center py-8">
                    검색 결과가 없습니다.
                  </p>
                )}
              </div>
            )}
          </section>
        )}

        {!isSearchMode && recentLocations.length > 0 && (
          <section>
            <h2 className="text-lg font-bold mb-4">최근 위치</h2>
            <div className="space-y-2">
              {recentLocations.map((recent, index) => (
                <LocationCard
                  key={`${recent.name}-${index}`}
                  title={recent.name}
                  subtitle={recent.address !== recent.name ? recent.address : undefined}
                  onSelect={() =>
                    selectLocation(recent.name, recent.address, recentLocationCoords(recent))
                  }
                />
              ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}
