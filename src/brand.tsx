import { useSettings } from './db';

/**
 * Offizielles Logo: Datei `src/assets/multivac_logo.png` (transparent, auf Inhalt zugeschnitten).
 * Ist sie vorhanden, wird sie automatisch in App, Kunden-PDF und PowerPoint verwendet.
 * Ein in den Einstellungen hochgeladenes Logo hat Vorrang. Ohne Datei erscheint die Text-Wortmarke.
 */
const bundled = Object.values(import.meta.glob('./assets/multivac_logo.png', { eager: true, query: '?url', import: 'default' }))[0] as string | undefined;
/** Helle Variante für den Dunkelmodus (gleiche Datei, nur umgefärbt) */
const bundledDark = Object.values(import.meta.glob('./assets/multivac_logo_dark.png', { eager: true, query: '?url', import: 'default' }))[0] as string | undefined;

export function useLogoUrl(): string | undefined {
  const s = useSettings();
  return s.logoDataUrl || bundled;
}

export function Logo({ height = 28, className = '' }: { height?: number; className?: string }) {
  const s = useSettings();
  const url = useLogoUrl();
  if (s.logoDataUrl) return <img className={'logo-img custom ' + className} src={s.logoDataUrl} alt={s.companyName || 'Logo'} style={{ height }} />;
  if (url) return (
    <picture>
      {bundledDark && <source srcSet={bundledDark} media="(prefers-color-scheme: dark)" />}
      <img className={'logo-img ' + (bundledDark ? '' : 'custom ') + className} src={url} alt={s.companyName || 'Logo'} style={{ height }} />
    </picture>
  );
  return <span className={'wordmark ' + className} style={{ fontSize: height * 0.62 }}>{s.companyName || 'TechDesk'}</span>;
}

/** Logo als Data-URL für PDF/PowerPoint */
export async function logoDataUrl(settingsLogo?: string): Promise<string | undefined> {
  if (settingsLogo) return settingsLogo;
  if (!bundled) return undefined;
  const blob = await (await fetch(bundled)).blob();
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result)); r.readAsDataURL(blob); });
}
