"use client"

import { useState } from "react"

/** A code sample with a copy button. `lang` is only a label. */
export function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [copied, setCopied] = useState(false)
  const text = code.replace(/^\n/, "").replace(/\s+$/, "")
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard unavailable (http, permissions) — the text is still selectable.
    }
  }
  return (
    <div className="docs-code">
      <div className="docs-code-head">
        <span>{lang ?? ""}</span>
        <button type="button" className="docs-code-copy" onClick={copy}>{copied ? "Copied" : "Copy"}</button>
      </div>
      <pre><code>{text}</code></pre>
    </div>
  )
}
