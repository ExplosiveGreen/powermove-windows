export function triggerAlignment(): void;
/** Returns false when the platform/volume cannot perform this operation. */
export function cloneFile(source: string, destination: string): Promise<boolean>;
export function swapFiles(source: string, destination: string): Promise<boolean>;
export function installFile(source: string, destination: string): Promise<boolean>;
export function fullSync(fd: number): Promise<boolean>;

export function fontFamilies(): string[] | null;

export function cloudFileState(path: string, download?: boolean): Promise<'local' | 'icloud' | 'cloud' | 'missing' | 'unknown'>;
