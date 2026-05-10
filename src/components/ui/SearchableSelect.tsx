import * as React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { useIsMobile } from "@/hooks/use-mobile";

interface SearchableSelectProps {
  value: string;
  onValueChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  items: Array<{ value: string; label: string; [key: string]: any }>;
  filterKey?: string;
  disabled?: boolean;
  className?: string;
  maxHeight?: string; // Add maxHeight prop for better control
}

export const SearchableSelect = React.forwardRef<
  HTMLButtonElement,
  SearchableSelectProps
>(
  (
    {
      value,
      onValueChange,
      placeholder = "Select an option",
      searchPlaceholder = "Search...",
      items,
      filterKey = "label",
      disabled,
      className,
      maxHeight = "h-60",
    },
    ref
  ) => {
    const [open, setOpen] = React.useState(false);
    const [searchTerm, setSearchTerm] = React.useState("");
    const isMobile = useIsMobile();
    const searchInputRef = React.useRef<HTMLInputElement>(null);

    // Filter items based on search term
    const filteredItems = React.useMemo(() => {
      if (!searchTerm) return items;
      
      return items.filter((item) =>
        item[filterKey].toLowerCase().includes(searchTerm.toLowerCase())
      );
    }, [items, searchTerm, filterKey]);

    // Focus search input when popover opens on mobile
    React.useEffect(() => {
      if (open && isMobile && searchInputRef.current) {
        // Delay to ensure popover is rendered
        const timer = setTimeout(() => {
          searchInputRef.current?.focus();
        }, 100);
        
        return () => clearTimeout(timer);
      }
    }, [open, isMobile]);

    // Clear search when closing
    React.useEffect(() => {
      if (!open) {
        setSearchTerm("");
      }
    }, [open]);

    // Get the display label for the selected value
    const getDisplayLabel = React.useMemo(() => {
      if (!value) return placeholder;
      const selectedItem = items.find((item) => item.value === value);
      return selectedItem ? selectedItem[filterKey] : placeholder;
    }, [value, items, filterKey, placeholder]);

    return (
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={ref}
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className={cn("w-full justify-between", className)}
            disabled={disabled}
          >
            <span className="truncate">
              {getDisplayLabel}
            </span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent 
          className="w-full p-0" 
          align="start"
          onOpenAutoFocus={(e) => {
            // Prevent default focus behavior on mobile
            if (isMobile) {
              e.preventDefault();
            }
          }}
          onCloseAutoFocus={(e) => {
            // Prevent default focus behavior on mobile
            if (isMobile) {
              e.preventDefault();
            }
          }}
        >
          <div className="p-2 border-b">
            <div className="relative">
              <Search className="absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder={searchPlaceholder}
                className="pl-8 h-9"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onTouchEnd={(e) => {
                  e.stopPropagation();
                  // Ensure focus on touch
                  e.currentTarget.focus();
                }}
                onKeyDown={(e) => {
                  // Prevent Enter key from closing the popover
                  if (e.key === "Enter") {
                    e.preventDefault();
                    e.stopPropagation();
                  }
                }}
              />
            </div>
          </div>
          <ScrollArea className={maxHeight}>
            {filteredItems.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">
                No items found
              </div>
            ) : (
              <div className="py-1">
                {filteredItems.map((item) => (
                  <Button
                    key={item.value}
                    variant="ghost"
                    className={cn(
                      "w-full justify-between h-10 px-2 text-left",
                      value === item.value && "bg-accent"
                    )}
                    onClick={() => {
                      onValueChange(item.value);
                      setOpen(false);
                    }}
                  >
                    <span className="truncate">{item[filterKey]}</span>
                    {value === item.value && (
                      <Check className="h-4 w-4 opacity-100" />
                    )}
                  </Button>
                ))}
              </div>
            )}
          </ScrollArea>
        </PopoverContent>
      </Popover>
    );
  }
);

SearchableSelect.displayName = "SearchableSelect";