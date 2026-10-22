declare const PANJI_BUILD_ID: string;
export const release = { version: '0.2.2', build: typeof PANJI_BUILD_ID === 'string' ? PANJI_BUILD_ID : 'dev' };
export const releaseLabel = `${release.version} · ${release.build}`;
