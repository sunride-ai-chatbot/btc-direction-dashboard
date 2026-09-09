// Thin re-export layer over Phosphor Icons (the icon set the UI/UX Pro Max design
// system recommends) so call sites keep using our own semantic names/sizes instead of
// depending on Phosphor's naming directly, and swapping icon sets later stays a one-file change.
import { WarningIcon, ArrowSquareOutIcon, CaretDownIcon, TrayIcon, PlugIcon } from '@phosphor-icons/react';

type IconProps = { className?: string };

export function IconWarning({ className = 'h-4 w-4' }: IconProps) {
  return <WarningIcon weight="bold" className={className} aria-hidden="true" />;
}

export function IconExternalLink({ className = 'h-3.5 w-3.5' }: IconProps) {
  return <ArrowSquareOutIcon weight="bold" className={className} aria-hidden="true" />;
}

export function IconChevronDown({ className = 'h-3.5 w-3.5' }: IconProps) {
  return <CaretDownIcon weight="bold" className={className} aria-hidden="true" />;
}

export function IconInbox({ className = 'h-8 w-8' }: IconProps) {
  return <TrayIcon weight="light" className={className} aria-hidden="true" />;
}

export function IconPlug({ className = 'h-8 w-8' }: IconProps) {
  return <PlugIcon weight="light" className={className} aria-hidden="true" />;
}
