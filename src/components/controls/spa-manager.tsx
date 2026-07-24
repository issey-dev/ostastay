"use client"

// Thin composition wrapper for the Controls > Spa tab. Holds just enough shared state
// to let SpaTreatmentsManager's category dropdown refresh immediately after a category
// is added/edited in SpaCategoriesManager, without the two managers needing to share a
// full store — same "lift only what's shared" approach the rest of Controls uses.

import { useEffect, useState } from "react"
import { SpaCategoriesManager, type SpaTreatmentCategoryDto } from "@/components/controls/spa-categories-manager"
import { SpaTreatmentsManager } from "@/components/controls/spa-treatments-manager"
import { useProperty } from "@/components/providers/property-provider"

export function SpaCatalogManager() {
  const { currentProperty } = useProperty()
  const propertyId = currentProperty?.id ?? ""
  const [categories, setCategories] = useState<SpaTreatmentCategoryDto[]>([])
  const [refreshKey, setRefreshKey] = useState(0)

  const fetchCategories = () => {
    if (!propertyId) return
    fetch(`/api/spa/treatment-categories?propertyId=${propertyId}`)
      .then((r) => r.json())
      .then((data) => { if (Array.isArray(data)) setCategories(data) })
  }

  useEffect(() => {
    fetchCategories()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [propertyId])

  return (
    <div className="space-y-6">
      <SpaCategoriesManager onChanged={() => { fetchCategories(); setRefreshKey((k) => k + 1) }} />
      <div className="border-t pt-6">
        <SpaTreatmentsManager categories={categories} refreshKey={refreshKey} />
      </div>
    </div>
  )
}
