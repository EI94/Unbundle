"use client"

import { usePathname } from "next/navigation"
import { useTheme } from "next-themes"
import { Toaster as Sonner, type ToasterProps } from "sonner"
import { CircleCheckIcon, InfoIcon, TriangleAlertIcon, OctagonXIcon, Loader2Icon } from "lucide-react"
import { toasterTheme } from "@/components/theme/theme-config"

const Toaster = ({ ...props }: ToasterProps) => {
  // Sul dashboard il tema della pagina (chiaro o scuro); altrove "system", come prima. La regione dei
  // toast si chiama «Avvisi», per non confondersi con la campanella («Notifiche»).
  const { resolvedTheme } = useTheme()
  const pathname = usePathname()

  return (
    <Sonner
      theme={toasterTheme(resolvedTheme, pathname)}
      className="toaster group"
      containerAriaLabel="Avvisi"
      icons={{
        success: (
          <CircleCheckIcon className="size-4" />
        ),
        info: (
          <InfoIcon className="size-4" />
        ),
        warning: (
          <TriangleAlertIcon className="size-4" />
        ),
        error: (
          <OctagonXIcon className="size-4" />
        ),
        loading: (
          <Loader2Icon className="size-4 animate-spin" />
        ),
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      toastOptions={{
        classNames: {
          toast: "cn-toast",
        },
      }}
      {...props}
    />
  )
}

export { Toaster }
