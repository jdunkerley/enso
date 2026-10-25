# Stores

This folder contains stores: `createContextStore` pairs of a `provideXxx()` and
a `useXxx()`. The GUI does not use Pinia.

All stores MUST be at the top level - so either `./stores/myStore.ts`, or
`./stores/myStore/index.ts`.

Each store MAY have dependencies specific to itself, which MUST NOT be at the
top level - so `./stores/myStore/myDependency.ts`.
