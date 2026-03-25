// Local type stubs for playwright-core.
// The actual package is installed on Railway via: npm install playwright-core
// These stubs prevent TypeScript errors in environments where playwright isn't installed.

declare module 'playwright-core' {
  export interface Browser {
    isConnected(): boolean;
    newContext(options?: BrowserContextOptions): Promise<BrowserContext>;
    close(): Promise<void>;
    on(event: 'disconnected', listener: () => void): this;
  }

  export interface BrowserContext {
    newPage(): Promise<Page>;
    close(): Promise<void>;
  }

  export interface Page {
    goto(url: string, options?: { waitUntil?: string; timeout?: number }): Promise<unknown>;
    click(selector: string, options?: { timeout?: number }): Promise<void>;
    fill(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
    selectOption(selector: string, value: string, options?: { timeout?: number }): Promise<void>;
    waitForSelector(selector: string, options?: { timeout?: number }): Promise<unknown>;
    waitForTimeout(ms: number): Promise<void>;
    waitForNavigation(options?: { timeout?: number }): Promise<void>;
    textContent(selector: string): Promise<string | null>;
    content(): Promise<string>;
    screenshot(options?: { fullPage?: boolean }): Promise<Buffer>;
    context(): BrowserContext;
  }

  export interface BrowserContextOptions {
    userAgent?: string;
    viewport?: { width: number; height: number };
    locale?: string;
    timezoneId?: string;
  }

  export interface LaunchOptions {
    headless?: boolean;
    args?: string[];
  }

  export interface BrowserType {
    launch(options?: LaunchOptions): Promise<Browser>;
  }

  export const chromium: BrowserType;
}
