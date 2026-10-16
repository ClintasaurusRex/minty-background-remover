import type { ReactNode, SVGProps } from 'react'
import type { ToolId } from '../../editor/types'

type IconProps = SVGProps<SVGSVGElement>

function Icon({ children, ...props }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...props}
    >
      {children}
    </svg>
  )
}

export function LogoIcon(props: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" {...props}>
      <path d="M8 24c0-9 6-15 16-16 0 10-6 16-15 16" fill="currentColor" />
      <path
        d="M9 23 19 13"
        stroke="var(--color-surface)"
        strokeWidth={2}
        strokeLinecap="round"
      />
    </svg>
  )
}

export function OpenIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" />
    </Icon>
  )
}

export function UndoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M9 14 4 9l5-5" />
      <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
    </Icon>
  )
}

export function RedoIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m15 14 5-5-5-5" />
      <path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13" />
    </Icon>
  )
}

export function ExportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 4v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M5 20h14" />
    </Icon>
  )
}

export function MagicWandIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m4 20 11-11" />
      <path d="m13 7 2-2 4 4-2 2" />
      <path d="M8 3v3M6.5 4.5h3M19 14v3M17.5 15.5h3" />
    </Icon>
  )
}

export function CropIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 2v14a2 2 0 0 0 2 2h14" />
      <path d="M18 22V8a2 2 0 0 0-2-2H2" />
    </Icon>
  )
}

export function ReplaceColorIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3s-6 6.5-6 11a6 6 0 0 0 12 0c0-4.5-6-11-6-11Z" />
      <path d="M9 15a3 3 0 0 0 3 3" />
    </Icon>
  )
}

export function AutoTrimIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
      <rect x="8" y="8" width="8" height="8" rx="1" />
    </Icon>
  )
}

export function ZoomInIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function ZoomOutIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M5 12h14" />
    </Icon>
  )
}

export function FitIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5" />
    </Icon>
  )
}

export function ImageIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="4" width="18" height="16" rx="2" />
      <circle cx="9" cy="10" r="1.75" />
      <path d="m21 16-5-5-9 9" />
    </Icon>
  )
}

export function ToolIcon({ toolId, ...props }: IconProps & { toolId: ToolId }) {
  switch (toolId) {
    case 'magic-wand':
      return <MagicWandIcon {...props} />
    case 'crop':
      return <CropIcon {...props} />
    case 'replace-color':
      return <ReplaceColorIcon {...props} />
    case 'auto-trim':
      return <AutoTrimIcon {...props} />
  }
}
