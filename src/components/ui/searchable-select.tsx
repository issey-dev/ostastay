import * as React from "react"
import { Check, ChevronsUpDown, Search } from "@/components/icons"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"

export interface SearchableSelectOption {
  label: string
  value: string
  /** Optional heading this option sits under. Consecutive options sharing a group render
   *  beneath one sticky header — pass options already sorted by group. */
  group?: string
}

/** Lists longer than this get a search box; shorter ones are a plain pick-list. */
export const SEARCHABLE_THRESHOLD = 8

interface SearchableSelectProps {
  options: SearchableSelectOption[]
  value: string
  onChange: (value: string) => void
  placeholder?: string
  searchPlaceholder?: string
  emptyText?: string
  className?: string
  disabled?: boolean
  required?: boolean
  /** Force the search box on or off. Default: shown only above SEARCHABLE_THRESHOLD
   *  options — a search box over two or three choices is just clutter. */
  searchable?: boolean
}

export function SearchableSelect({
  options,
  value,
  onChange,
  placeholder = "Select an option...",
  searchPlaceholder = "Search...",
  emptyText = "No results found.",
  className,
  disabled = false,
  required = false,
  searchable,
}: SearchableSelectProps) {
  const showSearch = searchable ?? options.length > SEARCHABLE_THRESHOLD
  const [open, setOpen] = React.useState(false)
  const [search, setSearch] = React.useState("")
  // Keyboard cursor within the filtered list (ArrowUp/ArrowDown/Enter).
  const [active, setActive] = React.useState(0)
  const listRef = React.useRef<HTMLDivElement>(null)
  const searchRef = React.useRef<HTMLInputElement>(null)
  const listId = React.useId()

  const filteredOptions = React.useMemo(() => {
    if (!search) return options
    const lowerSearch = search.toLowerCase()
    return options.filter(option =>
      option.label.toLowerCase().includes(lowerSearch)
    )
  }, [options, search])

  const selectedOption = options.find((option) => option.value === value)

  React.useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" })
  }, [active, open])

  const choose = (option: SearchableSelectOption) => {
    onChange(option.value)
    setOpen(false)
    setSearch("")
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault()
      setActive((i) => Math.min(i + 1, filteredOptions.length - 1))
    } else if (e.key === "ArrowUp") {
      e.preventDefault()
      setActive((i) => Math.max(i - 1, 0))
    } else if (e.key === "Enter") {
      e.preventDefault()
      const option = filteredOptions[active]
      if (option) choose(option)
    }
  }

  return (
    <Popover open={open} onOpenChange={(newOpen) => {
      setOpen(newOpen)
      setSearch("")
      // Opening puts the cursor on the current value, so Enter without moving is a
      // no-op and the list opens scrolled to where the user already is.
      if (newOpen) setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    }}>
      <div className="relative w-full">
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            role="combobox"
            aria-expanded={open}
            aria-controls={listId}
            disabled={disabled}
            className={cn(
              "w-full justify-between font-normal",
              !selectedOption && "text-muted-foreground",
              className
            )}
          >
            <span className="truncate">{selectedOption ? selectedOption.label : placeholder}</span>
            <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>

        {/* Hidden input for HTML required validation */}
        {required && (
          <input
            type="text"
            value={value}
            onChange={() => {}}
            required
            className="absolute bottom-0 left-1/2 -translate-x-1/2 opacity-0 w-1 h-1 pointer-events-none"
            tabIndex={-1}
          />
        )}
      </div>

      {/* --anchor-width is base-ui's trigger width, so the list is exactly as wide as
          the field it drops from (never narrower than a readable minimum). */}
      <PopoverContent
        className="w-(--anchor-width) min-w-48 gap-0 overflow-hidden p-0"
        align="start"
        // Focus the search box, or — with no search box — the list itself, so arrows
        // and Enter work straight away. (The popup manages focus; autoFocus is ignored.)
        initialFocus={showSearch ? searchRef : listRef}
      >
        {showSearch && (
        <div className="flex items-center gap-2 border-b border-border px-2.5">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            placeholder={searchPlaceholder}
            value={search}
            onChange={(e) => {
              setSearch(e.target.value)
              setActive(0)
            }}
            onKeyDown={onKeyDown}
            role="searchbox"
            aria-controls={listId}
            className="h-9 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        )}
        {/* Without a search box the list itself takes focus, so arrows/Enter still work. */}
        <div
          ref={listRef}
          id={listId}
          role="listbox"
          tabIndex={showSearch ? undefined : 0}
          onKeyDown={showSearch ? undefined : onKeyDown}
          className="max-h-[300px] overflow-y-auto p-1 outline-none"
        >
          {filteredOptions.length === 0 ? (
            <div className="py-6 text-center text-sm text-muted-foreground">
              {emptyText}
            </div>
          ) : (
            filteredOptions.map((option, index) => (
              <React.Fragment key={option.value}>
                {option.group && option.group !== filteredOptions[index - 1]?.group && (
                  <div className="sticky top-0 z-10 bg-popover px-2 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                    {option.group}
                  </div>
                )}
                <div
                  role="option"
                  aria-selected={value === option.value}
                  data-index={index}
                  className={cn(
                    "relative flex cursor-pointer select-none items-center gap-2 rounded-md py-1.5 pl-2 pr-8 text-sm outline-none",
                    index === active && "bg-accent text-accent-foreground",
                    value === option.value && "font-medium"
                  )}
                  onMouseMove={() => setActive(index)}
                  onClick={() => choose(option)}
                >
                  <span className="truncate">{option.label}</span>
                  {value === option.value && (
                    <Check className="absolute right-2 h-4 w-4" />
                  )}
                </div>
              </React.Fragment>
            ))
          )}
        </div>
      </PopoverContent>
    </Popover>
  )
}
