/**
 * CJS stub for `@react-pdf/renderer` under Jest.
 *
 * `@react-pdf/renderer@4` (and its `@react-pdf/primitives` dependency) ships pure ESM; the unit
 * Jest config (`^.+\.ts$` transform, node_modules ignored) cannot parse it, so importing
 * `InvoiceDocumentService` throws "Cannot use import statement outside a module" — same defect
 * class as `@nestjs/schedule`, same fix: redirect only Jest to this stub via `moduleNameMapper`.
 * Production builds (nest build / tsc) use the real package.
 *
 * Every unit test that reaches `InvoiceDocumentService` mocks it at the service boundary (it
 * never asserts on real PDF bytes), so these only need to exist and not throw — `React.createElement`
 * never invokes a component to build the element tree, and nothing here calls `renderToBuffer` for
 * real under test.
 */

const noopComponent = (): null => null;

export const Document = noopComponent;
export const Page = noopComponent;
export const View = noopComponent;
export const Text = noopComponent;
export const Image = noopComponent;

export const StyleSheet = {
  create: <T>(styles: T): T => styles,
};

export function renderToBuffer(): Promise<Buffer> {
  return Promise.resolve(Buffer.from('stub-pdf'));
}
