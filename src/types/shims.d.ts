declare module 'smiles-drawer';
declare module 'katex/contrib/mhchem';

declare module '*.svelte' {
  import type { Component } from 'svelte';
  const component: Component<any>;
  export default component;
}
