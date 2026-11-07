import * as z from "zod"

// Client-safe half of announcements: the form and the route validate with the same schema.

/** Shared by the form (live validation) and the route (the real check). */
export const announcementSchema = z.object({
  title: z.string().trim().min(3, "Give it a title of at least 3 characters").max(80, "Keep the title to 80 characters or fewer"),
  body: z.string().trim().max(500, "Keep the message to 500 characters or fewer").optional().or(z.literal("")),
  /** "ALL" = every property; otherwise one property's id. */
  audience: z.string().min(1, "Choose who it is for"),
})
export type AnnouncementInput = z.infer<typeof announcementSchema>

export type AnnouncementRow = {
  id: string
  title: string
  body: string | null
  propertyName: string | null
  createdAt: string
  recipients: number
  read: number
}

