import type { CSSProperties } from 'react';

const paths: Record<string, string> = {
  today: 'M3 10.5 12 3l9 7.5M5 9v11h14V9M9 20v-7h6v7',
  profile: 'M20 21v-2a7 7 0 0 0-14 0v2M13 3a4 4 0 1 0 0 8 4 4 0 0 0 0-8',
  plan: 'M8 3v4m8-4v4M4 7h16M5 5h14a1 1 0 0 1 1 1v14H4V6a1 1 0 0 1 1-1M8 11h3m3 0h2m-8 4h3m3 0h2',
  training: 'm13 3-8 11h7l-1 7 8-11h-7l1-7Z',
  report: 'M5 3h10l4 4v14H5V3Zm9 0v5h5M8 12h8m-8 4h5',
  knowledge: 'M4 5h6a3 3 0 0 1 3 3v13a4 4 0 0 0-3-2H4V5Zm16 0h-4a3 3 0 0 0-3 3v13a4 4 0 0 1 3-2h4V5Z',
  account: 'M4 20h16M5 17V7l7-4 7 4v10M9 17v-5h6v5',
  arrow: 'M4 12h16m-6-6 6 6-6 6',
  chevron: 'm9 5 7 7-7 7',
  check: 'm5 12 4 4L19 6',
  close: 'm6 6 12 12M6 18 18 6',
  clock: 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm0 4v5l4 2',
  spark: 'm12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7L12 3Z',
  settings: 'M4 7h16M4 17h16M8 4v6m8 4v6',
  link: 'm10 13 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0',
  alert: 'M12 3 2 20h20L12 3Zm0 6v5m0 3h.01',
  download: 'M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5',
  trash: 'M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7m4-7v7',
  edit: 'm15 4 5 5M4 20l1-6L16 3l5 5L10 19l-6 1Z',
  message: 'M4 4h16v13H9l-5 4V4Z',
  mountain: 'm2 20 7-12 4 7 3-5 6 10H2Zm5-8 2 2 2-2',
  history: 'M3 11a9 9 0 1 1 3 7M3 4v7h7M12 7v5l4 2',
  leaf: 'M20 3c-11-1-17 4-15 11s13 6 15-11ZM4 21 15 10',
  play: 'm8 4 13 8-13 8V4Z',
  shield: 'M12 3 3 7v5c0 5 9 9 9 9s9-4 9-9V7l-9-4Zm-4 9 3 3 5-6',
  refresh: 'M20 9a8 8 0 0 0-14-4L3 8m0-5v5h5m-4 7a8 8 0 0 0 14 4l3-3m0 5v-5h-5',
};
export function Icon({ name, size = 20, style, className = '' }: { name: string; size?: number; style?: CSSProperties; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" style={style} className={className}><path d={paths[name] ?? paths.spark} /></svg>;
}

export function Brand({ compact = false }: { compact?: boolean }) {
  return <div className="brand"><svg width="38" height="38" viewBox="0 0 64 64" aria-hidden="true"><rect width="64" height="64" rx="18" fill="#153b33"/><path d="m12 46 19-31 20 31H39L31 31 22 46Z" fill="#dce8a4"/><circle cx="42" cy="16" r="4" fill="#dd9561"/></svg>{!compact && <div><strong>Climb<span>AI</span></strong><small>训练计划原型</small></div>}</div>;
}

export function ClimbingArt() {
  return <svg className="climbing-art" viewBox="0 0 440 390" role="img" aria-label="抽象攀岩者沿着岩点向上攀爬的插画">
    <defs><pattern id="wall-grid" width="42" height="42" patternUnits="userSpaceOnUse"><circle cx="21" cy="21" r="1.2" fill="#7f9c8b" opacity=".25" /></pattern></defs>
    <path d="M68 40 330 12l56 70-18 260-280 31L38 268Z" fill="#294d42"/>
    <path d="m68 40 262-28-57 123L38 268Z" fill="#365b4d"/>
    <path d="m273 135 113-53-18 260-141-80Z" fill="#214439"/>
    <path d="M68 40 330 12l56 70-18 260-280 31L38 268Z" fill="url(#wall-grid)"/>
    <path d="m147 306 33-99 80-31 14-80" fill="none" stroke="#afc9ac" strokeWidth="2" strokeDasharray="4 9" opacity=".55"/>
    <g fill="#c8dca2"><path d="m266 81 17 3 5 14-10 9-17-5-5-10Z"/><path d="m157 207 17-9 14 6 1 13-16 7-16-5Z"/><path d="m142 303 14-7 12 5-3 13-18 4-10-7Z"/><path d="m253 165 17 2 7 11-12 9-15-8Z"/></g>
    <g fill="#d29368"><path d="m82 107 13-8 16 8-3 14-17 1Z"/><path d="m314 246 17-5 13 13-13 10-18-3Z"/><path d="m220 329 13-6 16 6-4 11-22 2Z"/><path d="m160 67 16-4 12 11-18 8-15-8Z"/></g>
    <g fill="#738a73"><path d="m99 239 13-5 12 8-8 14-18-3Z"/><path d="m317 142 15-5 12 13-14 6Z"/><path d="m205 110 9-6 14 8-4 11-17 1Z"/></g>
    <path d="m193 192 36-32 25 15" stroke="#ecd4ac" strokeWidth="13" fill="none" strokeLinecap="round"/>
    <path d="m209 167 36-34 26-37" stroke="#ecd4ac" strokeWidth="12" fill="none" strokeLinecap="round"/>
    <path d="m208 170 1 65-23 29" stroke="#becfa6" strokeWidth="29" fill="none" strokeLinecap="round"/>
    <path d="m210 231 29 38 29 9M191 233l-36 32-8 38" stroke="#162e28" strokeWidth="18" fill="none" strokeLinecap="round"/>
    <path d="m145 302 14 2M268 279l12-3" stroke="#e1bd91" strokeWidth="10" strokeLinecap="round"/>
    <circle cx="204" cy="146" r="17" fill="#ecd4ac"/><path d="M188 145c-8-20 24-27 29-10l-6 8-7-6-16 8Z" fill="#152c25"/>
    <circle cx="356" cy="52" r="22" fill="#d5e4b6" opacity=".15"/>
    <path d="m352 46 4 12 4-12" fill="none" stroke="#d5e4b6" strokeWidth="1.5"/>
    <text x="85" y="350" fill="#bccfb9" fontSize="10" letterSpacing="3">ONE MOVE AT A TIME</text>
  </svg>;
}
