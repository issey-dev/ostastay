<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
<!-- END:nextjs-agent-rules -->

<!-- BEGIN:ui-components-standard -->
# App Standard Components

When building forms or pages that require dropdowns or selects, use the standard custom component `SearchableSelect` located in `src/components/ui/searchable-select.tsx` if there are many options that would benefit from search/filtering. 
Do not implement standard `Select` for long lists (e.g., Guests, Rooms). 

Usage Example:
```tsx
import { SearchableSelect } from "@/components/ui/searchable-select"

<SearchableSelect
  value={value}
  onChange={(v) => setValue(v)}
  placeholder="Select Item..."
  options={items.map(item => ({ label: item.name, value: item.id }))}
/>
```
<!-- END:ui-components-standard -->

<!-- BEGIN:date-picker-standard -->
# Date Pickers
- Always use `@/components/ui/date-picker` for single dates. It natively supports year/month dropdowns.
- Always use `@/components/ui/date-range-picker` for date ranges (e.g., check-in and check-out periods).
<!-- END:date-picker-standard -->
