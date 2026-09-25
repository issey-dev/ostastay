// One way to turn a failed fetch into a sentence for a toast (DESKTOP_PLAN L2 — there were
// four local helpers). Prefers the server's `error` text; never shows raw JSON or a stack.
//
//   if (!res.ok) return toast.error(await apiError(res, "Couldn't save the room."))
export async function apiError(res: Response, fallback = "Something went wrong. Try again."): Promise<string> {
  try {
    const data = await res.clone().json()
    const msg = typeof data?.error === "string" ? data.error : typeof data?.message === "string" ? data.message : null
    return msg && msg.length < 400 ? msg : fallback
  } catch {
    return fallback
  }
}
